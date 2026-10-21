import {test} from 'node:test';import assert from 'node:assert/strict';
import {aliasedSpatialRequest} from './spatial-reference-aliases.js';
const image=(id:string)=>({id,direction:'front',path:'fixture.png',sha256:'fixture'});
test('short aliases bind exact originals without rewriting names, facts, image paths or hashes',async()=>{
 const current='hssd-102816051-0060',old='hssd-102816051-0008',group='runtime-uuid-123';
 const call=aliasedSpatialRequest(async input=>{
  const d=input.data as any;assert.equal(d.current.id,'S0');assert.equal(d.memberIds[0],'S1');assert.equal(d.groupId,'G0');assert.ok(!input.prompt.includes(current));assert.equal(input.images[1]!.path,'fixture.png');assert.equal(input.images[1]!.sha256,'fixture');
  assert.equal(input.metadata!.referenceBindings.find(b=>b.alias==='S1')!.originalId,old);
  return {currentId:d.current.id,groupId:d.groupId,name:'S0',reason:'S1 is a short reference, not an invented place',memberChecks:[{id:d.memberIds[0],relation:'compatible'}],sourceIds:[d.current.id,d.memberIds[0]]};
 });
 const result=await call({phase:'identity',prompt:`current ${current}`,data:{current:{id:current,atMs:2},groupId:group,memberIds:[old]},images:[image(current),image(old)]}) as any;
 assert.equal(result.currentId,current);assert.equal(result.groupId,group);assert.equal(result.memberChecks[0].id,old);assert.deepEqual(result.sourceIds,[current,old]);assert.equal(result.name,'S0');assert.match(result.reason,/short reference/);
});
test('unknown aliases and misspelled IDs fail, never fuzzy-correct or repair old artifacts',async()=>{
 for(const wrong of ['S99','hssd-10281651-0008']){
  const call=aliasedSpatialRequest(async()=>({sourceIds:[wrong]}));await assert.rejects(call({phase:'perception',prompt:'current',data:{current:{id:'real',atMs:1}},images:[image('real')]}),/Unknown model reference/);
 }
});
test('aliases are local, collision-safe and perception gains no historical data',async()=>{
 const call=aliasedSpatialRequest(async input=>{const d=input.data as any;assert.deepEqual(Object.keys(d),['current']);assert.notEqual(d.current.id,'S0');assert.equal(input.images[0]!.id,d.current.id);return {observationId:d.current.id,sourceIds:[d.current.id]};});
 assert.deepEqual(await call({phase:'perception',prompt:'S0',data:{current:{id:'S0',atMs:1}},images:[image('S0')]}),{observationId:'S0',sourceIds:['S0']});
});
