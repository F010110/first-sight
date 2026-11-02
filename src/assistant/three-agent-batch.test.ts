import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ThreeAgentStore,type AgentResult} from './three-agent-store.js';
import {ThreeAgentService,type ThreeAgentModels} from './three-agent-service.js';
import {streamEfficiency} from './stream-efficiency.js';

const row=(id:string,atMs:number,recordingId='one')=>({id,atMs,frames:[id+'.png'],recordingId});
const result=(id:string):AgentResult=>({facts:[{text:'visible scene',sourceIds:[id]}],summary:'scene; identity uncertain',sourceIds:[id]});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'three-agent-batch-'));return {path:join(root,'state.sqlite'),cleanup:()=>rm(root,{recursive:true,force:true})};}

test('memory waits for four observations or deadline; explicit end flushes short tail',async()=>{
 const f=await fixture();let now=0;const store=new ThreeAgentStore(f.path,()=>now);
 try{
  store.archive(row('a',0));assert.equal(store.memoryBatchReady(),false);now=5999;assert.equal(store.memoryBatchReady(),false);now=6000;assert.equal(store.memoryBatchReady(),true);
  const work=store.claimMemoryBatch();assert.equal(work.length,1);store.commit(work[0]!,result('a'),0);
  now=7000;store.archive(row('b',7000));assert.equal(store.memoryBatchReady(),false);assert.equal(store.claimMemoryBatch(6000,true).length,1);
 }finally{store.close();await f.cleanup();}
});

test('full batch shares a future-evidence fence, and gaps remain visible in watermark',async()=>{
 const f=await fixture();let now=0;const store=new ThreeAgentStore(f.path,()=>now);
 try{
  for(let i=0;i<4;i++){now=i*2000;store.archive(row(String(i),now));}
  const works=store.claimMemoryBatch();assert.equal(works.length,4);
  assert.equal(store.claimMemoryBatch().length,0);
  assert.throws(()=>store.commit(works[0]!,{...result('0'),sourceIds:['0','3']},0,6000),/Future within-window/);
  for(const [i,w] of works.entries())store.commit(w,result(w.observationId),i,6000);
  assert.equal(store.snapshot(2000).results.length,0);assert.equal(store.snapshot(2000).pendingMemory,2);
  assert.equal(store.snapshot(6000).results.length,4);assert.equal(store.progress().contiguousThroughAtMs,6000);
  assert.throws(()=>store.memoryEvidence('memory-v1',2000),/Future/);
 }finally{store.close();await f.cleanup();}
});

test('recording boundaries close windows instead of concatenating unrelated streams',async()=>{
 const f=await fixture();const store=new ThreeAgentStore(f.path,()=>1000);
 try{store.archive(row('a',0,'first'));store.archive(row('b',1,'second'));assert.equal(store.claimMemoryBatch().length,1);}
 finally{store.close();await f.cleanup();}
});

test('one bad batch observation does not discard valid neighbors or conceal the hole',async()=>{
 const f=await fixture();let now=1000;const store=new ThreeAgentStore(f.path,()=>now);let batchCalls=0;
 const models:ThreeAgentModels={current:async r=>result(r.id),memory:async()=>{throw Error('Single path must not run');},
  memoryWindow:async rows=>{batchCalls++;return rows.map(r=>r.id==='1'?{observationId:r.id,error:'injected bad citation'}:{observationId:r.id,result:result(r.id)});},
  question:async()=>({text:'unknown',source:'historical',sourceIds:[],abstained:true})};
 const service=new ThreeAgentService(store,models,undefined,()=>now);
 try{
  for(let i=0;i<4;i++){now=1000+i;await service.observe(row(String(i),now));}
  await service.finishInput();assert.equal(batchCalls,1);assert.equal(store.version(),3);
  assert.equal(store.progress().contiguousThroughAtMs,1000);assert.equal(store.progress().unfinished,1);
  assert.equal(streamEfficiency(store.efficiencyEvents(),false).catchUpMs,null);
 }finally{await service.shutdown();await f.cleanup();}
});

test('metrics distinguish throughput, source-to-commit latency and recovery; short replay cannot pass',()=>{
 const events=[{atMs:0,kind:'archive',value:{id:'a',sourceAtMs:0,archiveMs:1}},{atMs:2000,kind:'archive',value:{id:'b',sourceAtMs:2000,archiveMs:1}},
  {atMs:2000,kind:'batch-claimed',value:{ids:['a','b'],collectionSpanMs:2000,collectionAndQueueMs:2000}},
  {atMs:2000,kind:'source-ended',value:{unfinished:2}},
  {atMs:7000,kind:'memory-committed',value:{id:'a',sourceAtMs:0}},{atMs:7000,kind:'memory-committed',value:{id:'b',sourceAtMs:2000}},
  {atMs:7000,kind:'drain-finished',value:{unfinished:0}}];
 const metrics=streamEfficiency(events,true);assert.equal(metrics.observationEndToEndMs.max,7000);assert.equal(metrics.catchUpMs,5000);
 assert.equal(metrics.completedCoverage,1);assert.equal(metrics.throughputAssessment,'insufficient-evidence');
});

test('interaction timing includes planner and delivery, not only the answer model lane',()=>{
 const report=streamEfficiency([{atMs:8000,kind:'question-finished',value:{elapsedMs:3000}}],false,[{atMs:0,kind:'task-created',value:{id:'q'}},{atMs:8000,kind:'task-settled',value:{id:'q',status:'completed'}}]);
 assert.equal(report.questionModelLaneMs.p50,3000);assert.equal(report.interactionEndToEndMs.p50,8000);
});
