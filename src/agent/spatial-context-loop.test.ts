import {test} from 'node:test';import assert from 'node:assert/strict';
import {SpatialContextLoop,type SpatialLoopMemory,type SpatialLoopDecision} from './spatial-context-loop.js';
const current={id:'current',atMs:10,frames:[]};
const assessment={observationId:'current',atMs:10,placeId:'new',reason:'visible current layout',sourceIds:['current']};
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
 memory.writeAssessment=async()=>{};const invalid=new SpatialContextLoop(memory,async()=>({assessment,next:{kind:'answer',answer:'guess',sourceIds:['not-inspected'],abstained:false}}));await assert.rejects(invalid.run(current,'where?'),/uninspected/);
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
