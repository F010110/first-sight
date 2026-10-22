import {test} from 'node:test';import assert from 'node:assert/strict';
import {FixedGroupSpatialAgent,fixedGroupPagePrompt} from './spatial-fixed-group-agent.js';
test('candidate recall gates VLM context but preserves whole membership checks within selected places',async()=>{
 let calls=0;const agent=new FixedGroupSpatialAgent({
  async selectCandidates(i){return {groupIds:i.groups.length?[i.groups[0]!.id]:[]};},
  async createScope(c){return {coherent:true,scope:{name:'area',definition:'visible region',boundaryRules:['boundary'],sourceIds:[c.id]}};},
  async checkPage(i){calls++;return {groupId:i.groupId,version:i.version,pageIndex:i.pageIndex,currentId:i.current.id,scopeMatch:'yes',reason:'specific layout',memberChecks:i.memberIds.map(id=>({id,relation:'compatible',evidence:'specific evidence'})),sourceIds:[i.current.id,...i.memberIds]};}
 });
 const a=await agent.observe({id:'a',atMs:1});assert.match(a.newScopeBasis!,/not-global/);
 await agent.observe({id:'b',atMs:2});const c=await agent.observe({id:'c',atMs:3});assert.equal(c.reviews[0]!.evaluation.checkedMemberIds.length,2);assert.equal(calls,2);
});
test('page prompt example tracks actual version and page rather than stale constants',()=>{assert.ok(fixedGroupPagePrompt(7,2).includes('"version":7,"pageIndex":2'));assert.ok(!fixedGroupPagePrompt(7,2).includes('"version":1,"pageIndex":0'));assert.throws(()=>fixedGroupPagePrompt(0,0),/Invalid/);});
test('online groups freeze their scope and compare every member, not just the neighbor',async()=>{
 let checks=0;const agent=new FixedGroupSpatialAgent({async createScope(c){return {coherent:true,scope:{name:'stable',definition:'fixed area',boundaryRules:['exclude other side'],sourceIds:[c.id]}};},async checkPage(i){checks+=i.memberIds.length;return {groupId:i.groupId,version:i.version,pageIndex:i.pageIndex,currentId:i.current.id,scopeMatch:i.current.id==='outside'?'no':'yes',reason:'layout comparison',memberChecks:i.memberIds.map(id=>({id,relation:i.current.id==='outside'?'conflict':'compatible',evidence:'boundary evidence'})),sourceIds:[i.current.id,...i.memberIds]};}});
 const first=await agent.observe({id:'a',atMs:1});await agent.observe({id:'b',atMs:2});await agent.observe({id:'c',atMs:3});const fourth=await agent.observe({id:'d',atMs:4});assert.equal(checks,6);assert.equal(first.placeId,fourth.placeId);assert.deepEqual(first.groups[0]!.scope,fourth.groups[0]!.scope);
 const outside=await agent.observe({id:'outside',atMs:5});assert.notEqual(outside.placeId,first.placeId);assert.equal(outside.groups[0]!.members.length,4);
});
test('uncertainty does not create a duplicate place, and provider failure does not advance memory',async()=>{
 let fail=false;const agent=new FixedGroupSpatialAgent({async createScope(c){return {coherent:true,scope:{name:'stable',definition:'fixed',boundaryRules:['boundary'],sourceIds:[c.id]}};},async checkPage(i){if(fail)throw Error('provider');return {groupId:i.groupId,version:i.version,pageIndex:i.pageIndex,currentId:i.current.id,scopeMatch:'uncertain',reason:'not enough view',memberChecks:i.memberIds.map(id=>({id,relation:'unobservable',evidence:'occluded'})),sourceIds:[i.current.id,...i.memberIds]};}});
 await agent.observe({id:'a',atMs:1});const b=await agent.observe({id:'b',atMs:2});assert.equal(b.placeId,null);assert.equal(agent.snapshot().length,1);
 fail=true;await assert.rejects(agent.observe({id:'c',atMs:3}),/provider/);assert.equal(agent.snapshot()[0]!.members.length,1);
});
test('optional independent perception receives no history and precedes scope and whole-group comparison',async()=>{
 const events:string[]=[];const agent=new FixedGroupSpatialAgent({
  async perceive(c){assert.deepEqual(Object.keys(c).sort(),['atMs','id']);events.push('perceive:'+c.id);return {currentFact:c.id};},
  async createScope(c,p){assert.deepEqual(p,{currentFact:c.id});events.push('scope:'+c.id);return {coherent:true,scope:{name:'fixed',definition:'visible area',boundaryRules:['other side excluded'],sourceIds:[c.id]}};},
  async checkPage(i){assert.deepEqual(i.perception,{currentFact:i.current.id});events.push('check:'+i.current.id);return {groupId:i.groupId,version:i.version,pageIndex:i.pageIndex,currentId:i.current.id,scopeMatch:'yes',reason:'same bounded area',memberChecks:i.memberIds.map(id=>({id,relation:'compatible',evidence:'specific boundary'})),sourceIds:[i.current.id,...i.memberIds]};}
 });
 await agent.observe({id:'a',atMs:1});await agent.observe({id:'b',atMs:2});assert.deepEqual(events,['perceive:a','scope:a','perceive:b','check:b']);
});
test('comparative disambiguation needs distinct instance support, never recency or two positive groups',async()=>{
 let reject=false;
 const agent=new FixedGroupSpatialAgent({
  async createScope(c){return {coherent:true,scope:{name:c.id,definition:'fixed visible region',boundaryRules:['exclude other side'],sourceIds:[c.id]}};},
  async checkPage(i){const different=i.current.id==='b';return {groupId:i.groupId,version:i.version,pageIndex:i.pageIndex,currentId:i.current.id,scopeMatch:different?'no':'yes',reason:'independent comparison',memberChecks:i.memberIds.map(id=>({id,relation:different?'conflict':'compatible',evidence:'specific layout'})),sourceIds:[i.current.id,...i.memberIds]};},
  async disambiguate(i){assert.equal(i.groups.length,2);return {selectedGroupId:i.groups[1]!.id,groupChecks:i.groups.map((g,n)=>({groupId:g.id,support:n===1||reject?'instance-supported':'shared-appearance-only',evidence:n===1?'same distinctive lockers and bench arrangement':'shared tile color alone'})),sourceIds:[i.current.id,...i.groups.flatMap(g=>g.members.map(m=>m.id))]};}
 });
 await agent.observe({id:'a',atMs:1});const second=await agent.observe({id:'b',atMs:2});const third=await agent.observe({id:'c',atMs:3});assert.equal(third.placeId,second.placeId);assert.equal(agent.snapshot()[0]!.members.length,1);
 reject=true;await assert.rejects(agent.observe({id:'d',atMs:4}),/arbitrary preference/);assert.equal(agent.snapshot()[1]!.members.length,2);
});
test('one supported candidate plus one uncertain competitor also receives comparative review',async()=>{
 let reviews=0;const agent=new FixedGroupSpatialAgent({
  async createScope(c){return {coherent:true,scope:{name:c.id,definition:'fixed',boundaryRules:['boundary'],sourceIds:[c.id]}};},
  async checkPage(i){const no=i.current.id==='b',uncertain=i.current.id==='return'&&i.scope.name==='a';return {groupId:i.groupId,version:i.version,pageIndex:i.pageIndex,currentId:i.current.id,scopeMatch:no?'no':uncertain?'uncertain':'yes',reason:'visible comparison',memberChecks:i.memberIds.map(id=>({id,relation:no?'conflict':uncertain?'unobservable':'compatible',evidence:'specific layout comparison'})),sourceIds:[i.current.id,...i.memberIds]};},
  async disambiguate(i){reviews++;return {selectedGroupId:i.groups[1]!.id,groupChecks:i.groups.map((g,n)=>({groupId:g.id,support:n?'instance-supported':'shared-appearance-only',evidence:'joint original comparison'})),sourceIds:[i.current.id,...i.groups.flatMap(g=>g.members.map(m=>m.id))]};}
 });
 await agent.observe({id:'a',atMs:1});const b=await agent.observe({id:'b',atMs:2});const r=await agent.observe({id:'return',atMs:3});assert.equal(reviews,1);assert.equal(r.placeId,b.placeId);
});
