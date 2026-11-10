import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createPiSpatialReasoner} from './pi-reasoner.js';
import {SpatialMemoryService} from './service.js';
import type {Observation,Assessment,BatchSegment,SpatialReasoner} from './contracts.js';

const usage={prompt_tokens:100,completion_tokens:20};
const facts=(row:Observation)=>({summary:'facts '+row.id,details:['visible '+row.id]});
const newPlace=(id:string,name:string):Assessment=>({location:{status:'new',placeId:null,name,reason:'current layout '+id,sourceIds:[id],regionChangeEvidence:['layout changed']},hypotheses:[],unresolved:[],relations:[]});

async function rows(dir:string,count=20):Promise<Observation[]>{
 const out:Observation[]=[];
 for(let i=0;i<count;i++){
  const id='b'+String(i).padStart(2,'0'),views=[];
  for(const direction of ['front','left','right']){const bytes=Buffer.from(id+direction),path=join(dir,id+'-'+direction+'.png');await writeFile(path,bytes);views.push({id,direction,path,sha256:createHash('sha256').update(bytes).digest('hex')});}
  out.push({id,atMs:i*2000,recordingId:'recording',views});
 }
 return out;
}

test('40s batch uses facts-first input and commits ordered segments atomically',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-batch-'));const key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';
 let service:SpatialMemoryService|undefined,calls=0,sawFactsOnly=false;
 try{
  const data=await rows(dir),perceptionCalls=new Set<string>();
  const request=async(input:any)=>{
   calls++;
   assert.equal((input.images??[]).length,0,'batch spatial input must not preload camera images');
   const rt=input.data.runtimeContext;
   assert.equal(rt.batch.observations.length,20);
   assert.ok(rt.batch.observations.every((o:any)=>o.facts&&o.facts.summary),'every observation needs independent facts');
   sawFactsOnly=true;
   const ids=rt.batch.observations.map((o:any)=>o.id);
   const segments:BatchSegment[]=[
    {observationIds:ids.slice(0,10),assessment:newPlace(ids[9],'place A')},
    {observationIds:ids.slice(10),assessment:newPlace(ids[19],'place B')}
   ];
   return {output:{tool:'memory_add',arguments:{segments}},usage};
  };
  const reasoner=await createPiSpatialReasoner(join(dir,'pi'),request,{judgmentDeadlineMs:60000,skillName:'spatial-memory-v2-batch'});
  service=await SpatialMemoryService.create(join(dir,'memory'),{async perceive(row){return facts(row);},async perceiveWindow(list){for(const row of list)perceptionCalls.add(row.id);return list.map(row=>({id:row.id,facts:facts(row)}));}},{reasoner,batchMs:40000,perceptionMs:6000,busyPolicy:'queue',maxPending:64});
  for(const row of data)await service.observe(row);
  const progress=await service.finishInput();
  assert.equal(calls,1,'one 40s batch is one spatial model call');
  assert.equal(sawFactsOnly,true);
  assert.equal(progress.spatialStates,2,'two segments are two durable windows');
  assert.equal(progress.places,2);
  assert.equal(progress.coveredObservations,20);
  assert.equal(progress.pending,0);
  assert.equal(progress.missingFacts,0);
  assert.equal(perceptionCalls.size,20,'fast perception still reads every observation');
  const first=service.snapshotAt(1,Number.MAX_SAFE_INTEGER).state,second=service.snapshotAt(2,Number.MAX_SAFE_INTEGER).state;
  assert.deepEqual(first.window!.observations.map(o=>o.id),data.slice(0,10).map(r=>r.id));
  assert.deepEqual(second.window!.observations.map(o=>o.id),data.slice(10).map(r=>r.id));
  assert.equal(first.window!.batch!.id,second.window!.batch!.id);
  assert.equal(first.window!.batch!.segmentIndex,0);assert.equal(second.window!.batch!.segmentIndex,1);
  assert.equal(first.availableAtMs,second.availableAtMs,'segments share one batch publication cutoff');
  const checkpoints=(await readFile(join(dir,'pi','pi-checkpoints.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
  assert.equal(checkpoints.length,2);
  assert.deepEqual(checkpoints[0].window.memberIds,data.slice(0,10).map(r=>r.id));
  assert.deepEqual(checkpoints[1].window.memberIds,data.slice(10).map(r=>r.id));
 }finally{await service?.close().catch(()=>{});if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(dir,{recursive:true,force:true});}
});

test('batch protocol rejects missing or out-of-order coverage before any durable commit',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-batch-coverage-'));const key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';
 let service:SpatialMemoryService|undefined,calls=0;
 try{
  const data=await rows(dir,9);
  const request=async(input:any)=>{
   calls++;
   const ids=input.data.runtimeContext.batch.observations.map((o:any)=>o.id);
   // First attempt omits the last observation; the tool must reject it and return the error.
   if(calls===1)return {output:{tool:'memory_add',arguments:{segments:[{observationIds:ids.slice(0,-1),assessment:newPlace(ids.at(-2)!,'partial')}]}},usage};
   return {output:{tool:'memory_add',arguments:{segments:[{observationIds:ids,assessment:newPlace(ids.at(-1)!,'complete')}]}},usage};
  };
  const reasoner=await createPiSpatialReasoner(join(dir,'pi'),request,{judgmentDeadlineMs:60000,skillName:'spatial-memory-v2-batch'});
  service=await SpatialMemoryService.create(join(dir,'memory'),{async perceive(row){return facts(row);},async perceiveWindow(list){return list.map(row=>({id:row.id,facts:facts(row)}));}},{reasoner,batchMs:40000,perceptionMs:6000,busyPolicy:'queue',maxPending:64});
  for(const row of data)await service.observe(row);
  const progress=await service.finishInput();
  assert.equal(calls,2,'the incomplete first attempt cost a retry, not a durable partial commit');
  assert.equal(progress.spatialStates,1);
  assert.equal(progress.coveredObservations,9);
  assert.equal(progress.pending,0);
 }finally{await service?.close().catch(()=>{});if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(dir,{recursive:true,force:true});}
});

test('a failed segment rolls back the whole batch and the retry judges the same source range',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-batch-rollback-'));
 let service:SpatialMemoryService|undefined;
 try{
  const data=await rows(dir,20);let rounds=0;
  const reasoner:SpatialReasoner={
   async judge(){throw Error('single-window judge must not be called in batch mode');},
   async judgeBatch(input){
    rounds++;const ids=input.rows.map(r=>r.id);
    if(rounds===1){
     const bad=newPlace(ids[19]!,'B');bad.location.status='known';bad.location.placeId='not-a-real-place';
     let failed=false;
     try{await input.commitSegments([{observationIds:ids.slice(0,10),assessment:newPlace(ids[9]!,'A')},{observationIds:ids.slice(10),assessment:bad}],{inspected:new Set(),delivered:new Set()});}catch{failed=true;}
     assert.equal(failed,true,'the first multi-segment commit must fail atomically');
    }
    const segments:BatchSegment[]=[{observationIds:ids.slice(0,10),assessment:newPlace(ids[9]!,'A')},{observationIds:ids.slice(10),assessment:newPlace(ids[19]!,'B')}];
    await input.commitSegments(segments,{inspected:new Set(),delivered:new Set()});return segments;
   },
   async close(){}
  };
  service=await SpatialMemoryService.create(join(dir,'memory'),{async perceive(row){return facts(row);},async perceiveWindow(list){return list.map(row=>({id:row.id,facts:facts(row)}));}},{reasoner,batchMs:40000,perceptionMs:6000,busyPolicy:'queue',maxPending:64});
  for(const row of data)await service.observe(row);
  const progress=await service.finishInput();
  assert.equal(rounds,1,'a tool-loop retry after rollback stays inside the same judgment');
  assert.equal(progress.spatialStates,2);
  assert.equal(progress.places,2);
  assert.equal(progress.coveredObservations,20);
 }finally{await service?.close().catch(()=>{});await rm(dir,{recursive:true,force:true});}
});

test('fast perception runs bounded parallel buckets instead of one serial worker',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-batch-parallel-'));
 let service:SpatialMemoryService|undefined;
 try{
  const data=await rows(dir,20);let active=0,peak=0;
  const reasoner:SpatialReasoner={
   async judge(){throw Error('single-window judge must not be called in batch mode');},
   async judgeBatch(input){const ids=input.rows.map(r=>r.id);const segments:BatchSegment[]=[{observationIds:ids,assessment:newPlace(ids.at(-1)!,'A')}];await input.commitSegments(segments,{inspected:new Set(),delivered:new Set()});return segments;},
   async close(){}
  };
  service=await SpatialMemoryService.create(join(dir,'memory'),{async perceive(row){return facts(row);},async perceiveWindow(list){active++;peak=Math.max(peak,active);await new Promise<void>(resolve=>setTimeout(resolve,100));active--;return list.map(row=>({id:row.id,facts:facts(row)}));}},{reasoner,batchMs:40000,perceptionMs:6000,extractionConcurrency:3,busyPolicy:'queue',maxPending:64});
  for(const row of data)await service.observe(row);
  const progress=await service.finishInput();
  assert.ok(peak>=2,'independent 6s perception buckets can overlap');
  assert.ok(peak<=3,'concurrency stays bounded');
  assert.equal(progress.coveredObservations,20);
 }finally{await service?.close().catch(()=>{});await rm(dir,{recursive:true,force:true});}
});

test('batch mode can inspect more than three observations without exhausting the old single-window image budget',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-batch-inspect-'));const key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';
 let service:SpatialMemoryService|undefined,calls=0;
 try{
  const data=await rows(dir,9);
  const request=async(input:any)=>{
   calls++;
   const ids=input.data.runtimeContext.batch.observations.map((o:any)=>o.id);
   if(calls===1)return {output:{tool:'memory_inspect',arguments:{ids:ids.slice(0,5)}},usage};
   assert.equal(input.images.length,15,'five observations = fifteen original images');
   return {output:{tool:'memory_add',arguments:{segments:[{observationIds:ids,assessment:newPlace(ids.at(-1)!,'wide inspect')}]}},usage};
  };
  const reasoner=await createPiSpatialReasoner(join(dir,'pi'),request,{judgmentDeadlineMs:60000,skillName:'spatial-memory-v2-batch'});
  service=await SpatialMemoryService.create(join(dir,'memory'),{async perceive(row){return facts(row);},async perceiveWindow(list){return list.map(row=>({id:row.id,facts:facts(row)}));}},{reasoner,batchMs:40000,perceptionMs:6000,busyPolicy:'queue',maxPending:64});
  for(const row of data)await service.observe(row);
  const progress=await service.finishInput();
  assert.equal(calls,2);
  assert.equal(progress.coveredObservations,9);
  assert.equal(progress.spatialStates,1);
 }finally{await service?.close().catch(()=>{});if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(dir,{recursive:true,force:true});}
});

test('service-side batch stub sees facts, commits two segments and shares one publication time',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-batch-stub-'));
 let service:SpatialMemoryService|undefined;
 try{
  const data=await rows(dir,20);let batches=0;
  const reasoner:SpatialReasoner={
   async judge(){throw Error('single-window judge must not be called in batch mode');},
   async judgeBatch(input){batches++;assert.equal(input.rows.length,20);assert.equal(Object.keys(input.facts).length,20);assert.ok(Object.values(input.facts).every(Boolean));const ids=input.rows.map(r=>r.id);const local:Assessment={location:{status:'known',placeId:'batch:1',name:'B',reason:'continues earlier batch segment',sourceIds:[ids[19]!,ids[9]!]},hypotheses:[],unresolved:[],relations:[]};const segments:BatchSegment[]=[{observationIds:ids.slice(0,1),assessment:newPlace(ids[0]!,'A')},{observationIds:ids.slice(1,10),assessment:newPlace(ids[9]!,'B')},{observationIds:ids.slice(10),assessment:local}];await input.commitSegments(segments,{inspected:new Set(),delivered:new Set()});return segments;},
   async close(){}
  };
  service=await SpatialMemoryService.create(join(dir,'memory'),{async perceive(row){return facts(row);},async perceiveWindow(list){return list.map(row=>({id:row.id,facts:facts(row)}));}},{reasoner,batchMs:40000,perceptionMs:6000,busyPolicy:'queue',maxPending:64});
  for(const row of data)await service.observe(row);
  const progress=await service.finishInput();
  assert.equal(batches,1);assert.equal(progress.spatialStates,3);assert.equal(progress.places,2);assert.equal(progress.coveredObservations,20);
  const states=[1,2,3].map(v=>service!.snapshotAt(v,Number.MAX_SAFE_INTEGER).state);
  assert.deepEqual(states.map(s=>s.window!.observations.length),[1,9,10]);
  assert.equal(new Set(states.map(s=>s.availableAtMs)).size,1);
 }finally{await service?.close().catch(()=>{});await rm(dir,{recursive:true,force:true});}
});
