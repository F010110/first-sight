import {test} from 'node:test';import assert from 'node:assert/strict';
import {boundedSpatialProtocol,SpatialOutputProtocolError} from './spatial-protocol-retry.js';
import {FixedGroupSpatialAgent} from './spatial-fixed-group-agent.js';
import {aliasedSpatialRequest} from './spatial-reference-aliases.js';
import {parsePlaceScope} from './spatial-place-contract.js';
test('scope validation identifies exact length failure without relaxing the original limit',()=>{
 const value={name:'place',definition:'x'.repeat(401),boundaryRules:['visible wall'],sourceIds:['a']};
 assert.throws(()=>parsePlaceScope(value,[{id:'a',atMs:0}]),/definition.*<=400.*actual=401/);
 assert.equal(parsePlaceScope({...value,definition:'x'.repeat(400)},[{id:'a',atMs:0}]).definition.length,400);
});
test('protocol retries carry the exact validation error, stop at three, and never retry provider errors',async()=>{
 let calls=0;
 const value=await boundedSpatialProtocol(3,async feedback=>{calls++;if(calls===1)return {};assert.match(feedback!,/missing sourceIds.*b/);return {ok:true};},raw=>{if(!(raw as any).ok)throw Error('missing sourceIds=[b]');return raw;});
 assert.deepEqual(value,{ok:true});assert.equal(calls,2);
 calls=0;await assert.rejects(boundedSpatialProtocol(3,async()=>{calls++;throw Error('budget exhausted');},v=>v),/budget/);assert.equal(calls,1);
 calls=0;await assert.rejects(boundedSpatialProtocol(3,async()=>{calls++;throw new SpatialOutputProtocolError('invalid JSON');},v=>v),/invalid JSON/);assert.equal(calls,3);
});
async function setup(disambiguate:NonNullable<ConstructorParameters<typeof FixedGroupSpatialAgent>[0]['disambiguate']>){
 const agent=new FixedGroupSpatialAgent({protocolAttempts:3,
  async createScope(c){return {coherent:true,scope:{name:c.id,definition:'visible bounded region',boundaryRules:['visible wall'],sourceIds:[c.id]}};},
  async checkPage(i){const no=i.current.id==='b';return {groupId:i.groupId,version:i.version,pageIndex:i.pageIndex,currentId:i.current.id,scopeMatch:no?'no':'yes',reason:'original comparison',memberChecks:i.memberIds.map(id=>({id,relation:no?'conflict':'compatible',evidence:'visible ground and boundary'})),sourceIds:[i.current.id,...i.memberIds]};},disambiguate});
 await agent.observe({id:'a',atMs:0});await agent.observe({id:'b',atMs:2000});return agent;
}
function resolution(i:any){return {selectedGroupId:i.groups[0].id,groupChecks:i.groups.map((g:any,n:number)=>({groupId:g.id,support:n?'conflict':'instance-supported',evidence:'specific original layout'})),sourceIds:[i.current.id,...i.groups.flatMap((g:any)=>g.members.map((m:any)=>m.id))]};}
test('missing competitor reference retries with same original candidates and does not silently append citations',async()=>{
 let calls=0;let first:any;
 const agent=await setup(async i=>{calls++;if(calls===1){first=structuredClone(i);const v=resolution(i);v.sourceIds=v.sourceIds.filter((id:string)=>id!=='b');return v;}assert.match(i.protocolFeedback!,/missing sourceIds=\["b"\]/);assert.deepEqual(i.groups,first.groups);return resolution(i);});
 const result=await agent.observe({id:'c',atMs:4000});assert.equal(calls,2);assert.equal(result.action,'join');assert.equal(result.groups[0]!.members.length,2);
});
test('persistent incomplete evidence stops atomically, with no fabricated unknown or membership',async()=>{
 let calls=0;const agent=await setup(async i=>{calls++;const v=resolution(i);v.sourceIds.pop();return v;});const before=agent.snapshot();
 await assert.rejects(agent.observe({id:'c',atMs:4000}),/missing sourceIds/);assert.equal(calls,3);assert.deepEqual(agent.snapshot(),before);
});
test('duplicate citations and conflicting positive choices remain invalid, not relaxed by repair',async()=>{
 for(const mode of ['duplicate','positive-conflict']){let calls=0;const agent=await setup(async i=>{calls++;const v=resolution(i);if(mode==='duplicate')v.sourceIds.push(v.sourceIds[0]);else v.groupChecks[1].support='instance-supported';return v;});
 await assert.rejects(agent.observe({id:'c',atMs:4000}),mode==='duplicate'?/duplicate references/:/arbitrary preference/);assert.equal(calls,3);assert.equal(agent.snapshot().reduce((s,g)=>s+g.members.length,0),2);}
});
test('feedback source IDs are re-aliased; unknown aliases can be repaired without exposing original IDs',async()=>{
 let calls=0;const request=aliasedSpatialRequest(async i=>{calls++;const data=i.data as any;if(calls===1)return {sourceIds:['S99']};assert.match(data.protocolFeedback,/sourceIds.*S1/);assert.ok(!data.protocolFeedback.includes('original-old-id'));return {sourceIds:['S0','S1']};});
 const input={phase:'identity' as const,prompt:'compare',data:{current:{id:'original-current-id',atMs:1}},images:[{id:'original-current-id',direction:'front',path:'not-read',sha256:'not-read'},{id:'original-old-id',direction:'front',path:'not-read',sha256:'not-read'}]};
 const result=await boundedSpatialProtocol(3,feedback=>request({...input,data:{...input.data,...feedback?{protocolFeedback:feedback+' required sourceIds original-old-id'}:{}}}),v=>v);
 assert.deepEqual(result,{sourceIds:['original-current-id','original-old-id']});assert.equal(calls,2);
});
