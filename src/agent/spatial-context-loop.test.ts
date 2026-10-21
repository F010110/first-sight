import {test} from 'node:test';import assert from 'node:assert/strict';
import {SpatialContextLoop,type SpatialLoopMemory,type SpatialLoopDecision,type SpatialLoopModel} from './spatial-context-loop.js';
const current={id:'current',atMs:10,frames:[]};
const assessment={observationId:'current',atMs:10,placeId:'new',reason:'visible current layout',sourceIds:['current']};
test('opt-in spatial comparison delivers causal original references before inference',async()=>{
 const old={observationId:'old',atMs:1,placeId:'p',reason:'old layout',sourceIds:['old']};let observed=false;
 const memory:SpatialLoopMemory={async writeObservation(){},async writeAssessment(){},async search(){return []},async inspect(ids){assert.deepEqual(ids,['old']);return [{id:'old',atMs:1,placeId:'p',reason:'old layout',images:[{mimeType:'image/png',data:'original'}]}];}};
 const loop=new SpatialContextLoop(memory,async input=>{observed=true;assert.ok(input.inspectedIds.includes('old'));assert.equal(input.evidenceImages[0]?.data,'original');assert.equal(input.context.retrieved[0]?.id,'old');assert.equal('images' in input.context.retrieved[0]!,false);return {assessment:{...assessment,placeId:'p',sourceIds:['current','old']},next:{kind:'finish'}};},2,()=>['old']);
 loop.context.observe({id:'old',atMs:1,frames:[]});loop.context.commit(old);
 assert.equal((await loop.run(current)).status,'observed');assert.equal(observed,true);
 memory.inspect=async()=>[{id:'old',atMs:10,placeId:'p',reason:'future',images:[{mimeType:'image/png',data:'future'}]}];
 const invalid=new SpatialContextLoop(memory,async()=>{throw Error('must not infer');},2,()=>['old']);invalid.context.observe({id:'old',atMs:1,frames:[]});invalid.context.commit(old);
 await assert.rejects(invalid.run(current),/automatic spatial reference evidence/);
});
test('every inference writes a spatial assessment; search/inspect feed the next context',async()=>{
 const writes:string[]=[],views:any[]=[];const old={id:'old',atMs:1,placeId:'p',reason:'historical layout'};
 const memory:SpatialLoopMemory={async writeObservation(){writes.push('observation')},async writeAssessment(){writes.push('assessment')},async search(){return [old]},async inspect(){return [old]}};
 const actions:SpatialLoopDecision['next'][]=[{kind:'search',query:'layout'},{kind:'inspect',ids:['old']},{kind:'answer',answer:'Matches inspected history',sourceIds:['current','old'],abstained:false}];
 const loop=new SpatialContextLoop(memory,async input=>{views.push(input);return {assessment,next:actions.shift()!}});
 const result=await loop.run(current,'Have I been here?');assert.equal(result.status,'answered');assert.deepEqual(writes,['observation','assessment','assessment','assessment']);assert.equal(views[0].context.location,null);assert.equal(views[1].context.location.placeId,'new');assert.equal(views[1].context.retrieved.length,0);assert.equal(views[2].context.retrieved[0].id,'old');
});
test('write failure cannot publish a judgment, uninspected answers cannot pass',async()=>{
 const memory:SpatialLoopMemory={async writeObservation(){},async writeAssessment(){throw Error('disk failure')},async search(){return []},async inspect(){return []}};
 const loop=new SpatialContextLoop(memory,async()=>({assessment,next:{kind:'finish'}}));await assert.rejects(loop.run(current),/disk failure/);assert.equal(loop.context.view().location,null);
 memory.writeAssessment=async()=>{};const invalid=new SpatialContextLoop(memory,async()=>({assessment,next:{kind:'answer',answer:'guess',sourceIds:['not-inspected'],abstained:false}}),2);assert.equal((await invalid.run(current,'where?')).status,'budget-exhausted');
});
test('retrieval loop is bounded and re-assesses space on each continuation',async()=>{
 let writes=0;const memory:SpatialLoopMemory={async writeObservation(){},async writeAssessment(){writes++},async search(){return []},async inspect(){return []}};
 const loop=new SpatialContextLoop(memory,async()=>({assessment,next:{kind:'search',query:'missing'}}),3);const result=await loop.run(current,'find?');assert.equal(result.status,'budget-exhausted');assert.equal(writes,3);
});
test('one window call judges every observation; answers and actions are dual written',async()=>{
 const persisted:unknown[]=[],judged:string[]=[];let calls=0;
 const memory:SpatialLoopMemory={async writeObservation(){},async writeOutput(_time,value){persisted.push(value)},async writeAssessment(a){judged.push(a.observationId)},async search(){return []},async inspect(){return []}};
 const observations=Array.from({length:4},(_,i)=>({id:'o'+i,atMs:i,frames:[]}));
 const loop=new SpatialContextLoop(memory,async input=>{calls++;assert.equal(input.observations.length,4);return {assessment,assessments:input.observations.map(o=>({observationId:o.id,atMs:o.atMs,placeId:'new-1',reason:'visible shared layout',sourceIds:[o.id]})),next:{kind:'answer',answer:'当前可确认的空间特征',sourceIds:['o3'],abstained:false}}});
 await loop.runWindow(observations,'当前如何？');assert.equal(calls,1);assert.deepEqual(judged,['o0','o1','o2','o3']);assert.equal(persisted.length,1);assert.deepEqual(loop.context.view().outputs[0]?.value,persisted[0]);
 const fresh=new SpatialContextLoop(memory,async()=>{throw Error('not called')});assert.equal(fresh.context.view().recent.length,0);assert.equal(fresh.context.view().outputs.length,0);
});
test('expired identity must be retrieved and inspected, never silently accepted',async()=>{
 const writes:string[]=[],outputs:any[]=[];let call=0;
 const memory:SpatialLoopMemory={async writeObservation(){},async writeOutput(_at,value){outputs.push(value)},async writeAssessment(a){writes.push(a.placeId??'unknown')},async search(query){assert.equal(query,'remembered-place');return [{id:'past',atMs:1,placeId:'remembered-place',reason:'past physical layout'}]},async inspect(){return [{id:'past',atMs:1,placeId:'remembered-place',reason:'past physical layout',images:[{mimeType:'image/png',data:'fixture'}]}]}};
 const loop=new SpatialContextLoop(memory,async input=>{call++;
  if(call===1)return {assessment:{...assessment,placeId:'remembered-place'},next:{kind:'finish'}};
  assert.ok(input.feedback?.includes('Spatial identity rejected'));
  if(call===2)return {assessment:{...assessment,placeId:null},next:{kind:'search',query:'remembered-place'}};
  if(call===3)return {assessment:{...assessment,placeId:null},next:{kind:'inspect',ids:['past']}};
  return {assessment:{...assessment,placeId:'remembered-place',sourceIds:['current','past']},next:{kind:'finish'}};
 },4);
 const result=await loop.run(current);assert.equal(result.status,'observed');assert.equal(call,4);assert.deepEqual(writes,['unknown','unknown','remembered-place']);assert.ok(outputs.some(o=>o.status==='rejected-spatial-identity'));
});
test('observation-only output may omit control action without inventing a user answer',async()=>{
 const outputs:unknown[]=[];const memory:SpatialLoopMemory={async writeObservation(){},async writeOutput(_t,v){outputs.push(v)},async writeAssessment(){},async search(){return []},async inspect(){return []}};
 const loop=new SpatialContextLoop(memory,async()=>({assessment} as any));const result=await loop.run(current);assert.equal(result.status,'observed');assert.equal(outputs.length,1);assert.equal((outputs[0] as any).decision.next,undefined);
 const questionLoop=new SpatialContextLoop(memory,async()=>({assessment} as any),1);assert.equal((await questionLoop.run(current,'question')).status,'budget-exhausted');
});
test('unsolicited answer is retained but not delivered as a user response',async()=>{
 const outputs:any[]=[];const memory:SpatialLoopMemory={async writeObservation(){},async writeOutput(_t,v){outputs.push(v)},async writeAssessment(){},async search(){return []},async inspect(){return []}};
 const loop=new SpatialContextLoop(memory,async()=>({assessment,next:{kind:'answer',answer:'当前位置是体育馆内部。',sourceIds:['current'],abstained:false}}));
 const result=await loop.run(current);assert.equal(result.status,'observed');assert.ok(!('answer' in result));assert.ok(outputs.some(o=>o.status==='unsolicited-answer-retained-not-delivered'));
 assert.ok(loop.context.view().outputs.some(o=>(o.value as any).status==='unsolicited-answer-retained-not-delivered'));
});
test('unknown control action gets bounded correction, no invented location or extra calls',async()=>{
 let calls=0,writes=0;const outputs:any[]=[];const memory:SpatialLoopMemory={async writeObservation(){},async writeOutput(_t,v){outputs.push(v)},async writeAssessment(){writes++},async search(){throw Error('Invalid action must not search')},async inspect(){throw Error('Invalid action must not inspect')}};
 const loop=new SpatialContextLoop(memory,async input=>{calls++;if(calls===1)return {assessment,next:{kind:'new-place',alias:'new-1'}} as any;assert.ok(input.feedback?.includes('Only finish/search/inspect/answer'));return {assessment,next:{kind:'finish'}}},2);
 assert.equal((await loop.run(current)).status,'observed');assert.equal(calls,2);assert.equal(writes,1);assert.ok(outputs.some(o=>o.status==='rejected-model-protocol'));assert.ok(outputs.some(o=>o.decision?.next?.kind==='new-place'));
 const bad=new SpatialContextLoop(memory,async()=>({assessment,next:{kind:'new-place'}} as any),2);assert.equal((await bad.run(current)).status,'budget-exhausted');assert.equal(writes,1);
});
test('public named-source requirement cannot be satisfied by a different current image',async()=>{
 let calls=0;const memory:SpatialLoopMemory={async writeObservation(){},async writeAssessment(){},async search(){return [{id:'past',atMs:1,placeId:null,reason:'past'}]},async inspect(){return [{id:'past',atMs:1,placeId:null,reason:'past'}]}};
 const loop=new SpatialContextLoop(memory,async input=>{calls++;assert.deepEqual(input.requiredEvidenceIds,['current','past']);const a={...assessment,placeId:null};if(calls===1)return {assessment:a,next:{kind:'answer',answer:'current only',sourceIds:['current'],abstained:false}};if(calls===2){assert.ok(input.feedback?.includes('PUBLIC question'));return {assessment:a,next:{kind:'search',query:'past'}};}assert.ok(input.feedback?.includes('Search completed'));if(calls===3)return {assessment:a,next:{kind:'inspect',ids:['past']}};return {assessment:a,next:{kind:'answer',answer:'current and past',sourceIds:['current','past'],abstained:false}};},4);
 const result=await loop.runWindow([current],'Compare named records',{requiredEvidenceIds:['current','past']});assert.equal(result.status,'answered');assert.equal(calls,4);if(result.status==='answered')assert.deepEqual(result.inspectedIds,['current','past']);
});
test('16-round research budget is accepted and remains bounded',async()=>{
 const memory:SpatialLoopMemory={async writeObservation(){},async writeAssessment(){},async search(){return []},async inspect(){return []}};
 let calls=0;const model:SpatialLoopModel=async()=>{calls++;return {assessment,next:{kind:'search',query:'unresolved'}};};
 const loop=new SpatialContextLoop(memory,model,16);const result=await loop.run(current);
 assert.equal(result.status,'budget-exhausted');assert.equal(calls,16);
 assert.throws(()=>new SpatialContextLoop(memory,model,33),/Invalid inference budget/);
});
test('explicit refusal cannot pass with a false abstention flag',async()=>{
 let calls=0;const memory:SpatialLoopMemory={async writeObservation(){},async writeAssessment(){},async search(){return []},async inspect(){return []}};
 const loop=new SpatialContextLoop(memory,async input=>{calls++;if(calls>1)assert.ok(input.feedback?.includes('abstained=true'));return {assessment,next:{kind:'answer',answer:'无法确定这个未知事实。',sourceIds:[],abstained:calls>1}};},2);
 const result=await loop.run(current,'unknown?');assert.equal(result.status,'answered');if(result.status==='answered'){assert.equal(result.abstained,true);assert.equal(result.answer,'无法确定这个未知事实。');}assert.equal(calls,2);
});
