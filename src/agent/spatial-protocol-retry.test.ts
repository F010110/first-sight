import {test} from 'node:test';import assert from 'node:assert/strict';
import {FixedGroupSpatialAgent} from './spatial-fixed-group-agent.js';
import {boundedNetworkRetry} from './bounded-network-retry.js';
test('missing groupId gets bounded fresh original comparison, not filled in; conflict remains veto',async()=>{
 let calls=0;
 const agent=new FixedGroupSpatialAgent({protocolAttempts:3,
 async createScope(c){return {coherent:true,scope:{name:'area',definition:'fixed region',boundaryRules:['boundary'],sourceIds:[c.id]}};},
 async checkPage(i){calls++;assert.equal(!!i.protocolFeedback,calls>1);return {...calls===1?{}:{groupId:i.groupId},version:i.version,pageIndex:i.pageIndex,currentId:i.current.id,scopeMatch:'no',reason:'boundary conflict',memberChecks:i.memberIds.map(id=>({id,relation:'conflict',evidence:'visible boundary'})),sourceIds:[i.current.id,...i.memberIds]};}});
 const a=await agent.observe({id:'a',atMs:1});const b=await agent.observe({id:'b',atMs:2});assert.equal(calls,2);assert.notEqual(a.placeId,b.placeId);assert.equal(b.reviews[0]!.evaluation.verdict,'different');
});
test('three malformed pages stop without mutating memory',async()=>{
 let calls=0;const agent=new FixedGroupSpatialAgent({protocolAttempts:3,async createScope(c){return {coherent:true,scope:{name:'a',definition:'region',boundaryRules:['boundary'],sourceIds:[c.id]}};},async checkPage(){calls++;return {};}});
 await agent.observe({id:'a',atMs:1});await assert.rejects(agent.observe({id:'b',atMs:2}),/bounded attempts/);assert.equal(calls,3);assert.equal(agent.snapshot()[0]!.members.length,1);
});
test('timeouts retry three times, never indefinitely',async()=>{
 let calls=0;const retries:boolean[]=[];await assert.rejects(boundedNetworkRetry(async()=>{calls++;throw new DOMException('timeout','TimeoutError');},async(_e,_a,retry)=>{retries.push(retry);},3,0),/timeout/);assert.equal(calls,3);assert.deepEqual(retries,[true,true,false]);
});
