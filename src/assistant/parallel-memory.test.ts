import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ThreeAgentStore,type AgentResult} from './three-agent-store.js';
import {ThreeAgentService,type ThreeAgentModels} from './three-agent-service.js';
import {AdaptiveExtractionLimit} from './adaptive-extraction.js';
import {streamEfficiency} from './stream-efficiency.js';
import {validateAgentEvidence} from './three-agent-evidence.js';

const row=(id:string,atMs:number)=>({id,atMs,frames:[id+'.png']});
const result=(id:string):AgentResult=>({facts:[{text:'visible evidence; identity uncertain',sourceIds:[id]}],summary:'independent evidence',sourceIds:[id]});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'parallel-memory-'));return {path:join(root,'state.sqlite'),cleanup:()=>rm(root,{recursive:true,force:true})};}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}

test('independent windows can finish out of order, but association waits for the causal prefix',async()=>{
 const f=await fixture();const store=new ThreeAgentStore(f.path,()=>10000);
 try{
  for(let i=0;i<8;i++)store.archive(row(String(i),i));
  const first=store.claimExtraction(true)!,second=store.claimExtraction(true)!;
  assert.notEqual(first.windowId,second.windowId);assert.equal(store.claimExtraction(true),null);
  store.saveExtraction(second.windowId,second.work,second.work.map(w=>({observationId:w.observationId,result:result(w.observationId)})));
  assert.equal(store.claimAssociation(),null);assert.equal(store.progress().extractedObservations,4);assert.equal(store.progress().extractionThroughAtMs,null);
  store.saveExtraction(first.windowId,first.work,first.work.map(w=>({observationId:w.observationId,result:result(w.observationId)})));
  const a=store.claimAssociation()!;assert.equal(a.windowId,first.windowId);assert.equal(store.claimAssociation(),null);
  for(const [i,w] of a.work.entries())store.commit(w,result(w.observationId),i,a.evidenceUntilMs);
  store.finishAssociation(a.windowId,a.work[0]!.token);
  assert.equal(store.claimAssociation()!.windowId,second.windowId);assert.equal(store.version(),4);
 }finally{store.close();await f.cleanup();}
});

test('restart reclaims expired extraction leases and fences the original worker',async()=>{
 const f=await fixture();let now=1000;let store=new ThreeAgentStore(f.path,()=>now);
 try{
  for(let i=0;i<4;i++)store.archive(row(String(i),i));const old=store.claimExtraction(true)!;
  store.close();now+=180001;store=new ThreeAgentStore(f.path,()=>now);const recovered=store.claimExtraction(true)!;
  assert.equal(recovered.windowId,old.windowId);
  assert.throws(()=>store.saveExtraction(old.windowId,old.work,old.work.map(w=>({observationId:w.observationId,result:result(w.observationId)}))),/lease/);
  store.saveExtraction(recovered.windowId,recovered.work,recovered.work.map(w=>({observationId:w.observationId,result:result(w.observationId)})));
  assert.equal(store.progress().extractedObservations,4);
 }finally{store.close();await f.cleanup();}
});

test('one persistent root cannot mix serial and parallel memory writers',async()=>{
 const f=await fixture();const store=new ThreeAgentStore(f.path);
 try{store.configureMemoryMode('parallel-v1');store.configureMemoryMode('parallel-v1');assert.throws(()=>store.configureMemoryMode('serial-v1'),/mode changed/);}
 finally{store.close();await f.cleanup();}
});

test('adaptive limit is bounded, cools down, and reduces concurrency on congestion',()=>{
 const limit=new AdaptiveExtractionLimit();assert.equal(limit.choose(4,1000,0,0),1);
 assert.equal(limit.choose(8,10000,0,10000),2);assert.equal(limit.choose(0,0,0,11000),2);
 limit.congested(12000);assert.equal(limit.choose(20,20000,0,13000),1);assert.equal(limit.choose(20,20000,0,43000),2);
});

test('interaction keeps a slot when current, association and both extractors are already running',async()=>{
 const {AgentSlots}=await import('./three-agent-service.js');const slots=new AgentSlots();const block=deferred();let background=0;
 const jobs=['current','memory','memory-extract','memory-extract'].map(role=>slots.run(role,async()=>{background++;await block.promise;}));
 await new Promise(r=>setImmediate(r));assert.equal(background,4);
 assert.equal(await slots.run('question',async()=>'answer'),'answer');block.resolve();await Promise.all(jobs);
});

test('association recovery reuses stored extraction and rejects the old commit token',async()=>{
 const f=await fixture();let now=1000;let store=new ThreeAgentStore(f.path,()=>now);
 try{
  for(let i=0;i<4;i++)store.archive(row(String(i),i));const extract=store.claimExtraction(true)!;
  store.saveExtraction(extract.windowId,extract.work,extract.work.map(w=>({observationId:w.observationId,result:result(w.observationId)})));
  const old=store.claimAssociation()!;store.close();now+=180001;store=new ThreeAgentStore(f.path,()=>now);
  const recovered=store.claimAssociation()!;assert.equal(recovered.windowId,old.windowId);assert.equal(store.progress().extractedObservations,4);
  assert.throws(()=>store.commit(old.work[0]!,result(old.work[0]!.observationId),0,old.evidenceUntilMs),/lease/);
  for(const [i,w] of recovered.work.entries())store.commit(w,result(w.observationId),i,recovered.evidenceUntilMs);
  store.finishAssociation(recovered.windowId,recovered.work[0]!.token);assert.equal(store.version(),4);
 }finally{store.close();await f.cleanup();}
});

test('a slow first extraction does not prevent a second extraction, and ordered association sees latest memory',async()=>{
 const f=await fixture();let now=1000;const store=new ThreeAgentStore(f.path,()=>now);const block=deferred();let extractionCalls=0;const versions:number[]=[];
 const models:ThreeAgentModels={current:async r=>result(r.id),memory:async r=>result(r.id),question:async()=>({text:'unknown',source:'historical',sourceIds:[],abstained:true}),
  extractWindow:async rows=>{extractionCalls++;if(rows[0]!.id==='0')await block.promise;return rows.map(r=>({observationId:r.id,result:result(r.id)}));},
  associateWindow:async(_rows,extracted,context)=>{versions.push(context.version);return extracted;}};
 const service=new ThreeAgentService(store,models,undefined,()=>now);
 try{
  for(let i=0;i<8;i++){now=1000+i;await service.observe(row(String(i),now));}
  now=10000;await new Promise(r=>setTimeout(r,250));
  assert.equal(extractionCalls,2);assert.equal(store.progress().extractedObservations,4);assert.equal(store.version(),0);
  const question=await service.question('earlier',true);assert.equal(question.abstained,true);
  block.resolve();await service.finishInput();assert.deepEqual(versions,[0,4]);assert.equal(store.version(),8);
 }finally{block.resolve();await service.shutdown();await f.cleanup();}
});

test('failed association retains independent evidence for retrieval and does not create a completed watermark',async()=>{
 const f=await fixture();const store=new ThreeAgentStore(f.path,()=>1000);
 try{
  for(let i=0;i<4;i++)store.archive(row(String(i),i));const extracted=store.claimExtraction(true)!;
  store.saveExtraction(extracted.windowId,extracted.work,extracted.work.map(w=>({observationId:w.observationId,result:result(w.observationId)})));
  const associated=store.claimAssociation()!;for(const w of associated.work)store.fail(w,'injected association failure');store.finishAssociation(associated.windowId,associated.work[0]!.token);
  assert.equal(store.progress().extractedObservations,4);assert.equal(store.progress().completed,0);assert.equal(store.snapshot(100).completeness,'partial');
 }finally{store.close();await f.cleanup();}
});

test('malformed nested extraction is rejected, not repaired from sibling summary or fact citations',()=>{
 const malformed={observationId:'a',result:{facts:[{text:'room',sourceIds:['a'],memoryRefs:[]}]},summary:'room'};
 assert.throws(()=>validateAgentEvidence(malformed.result as unknown as AgentResult,['a']));
 const metrics=streamEfficiency([{atMs:1,kind:'extraction-failed',value:{id:'a',error:'missing top-level sourceIds'}}],true);
 assert.equal(metrics.failedTasks,1);assert.equal(metrics.throughputAssessment,'degraded-failures');
});
