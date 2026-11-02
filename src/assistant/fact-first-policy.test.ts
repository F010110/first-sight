import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ThreeAgentStore,type AgentResult} from './three-agent-store.js';
import {ThreeAgentService,type ThreeAgentModels} from './three-agent-service.js';
import {finalizeObservationFacts,needsRelationshipReview} from './fact-first-policy.js';
import {AdaptiveExtractionLimit} from './adaptive-extraction.js';
import {validateAgentEvidence} from './three-agent-evidence.js';
const row=(id:string,atMs:number)=>({id,atMs,frames:[id+'.png']});
const result=(id:string):AgentResult=>({facts:[{text:'visible scene, identity unverified',sourceIds:[id]}],summary:'visible scene',sourceIds:[id]});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'fact-first-'));return {path:join(root,'state.sqlite'),cleanup:()=>rm(root,{recursive:true,force:true})};}

test('continuous ingestion does not start the immediate agent in on-demand mode',async()=>{
 const f=await fixture();const store=new ThreeAgentStore(f.path,()=>1000);let currentCalls=0;
 const models:ThreeAgentModels={current:async r=>{currentCalls++;return result(r.id);},memory:async r=>result(r.id),question:async()=>({text:'unknown',source:'historical',sourceIds:[],abstained:true})};
 const service=new ThreeAgentService(store,models,undefined,()=>1000,true,async r=>r,{continuousCurrent:false});
 try{
  await service.observe(row('a',900));await service.idle();assert.equal(currentCalls,0);
  service.requestCurrent();await service.idle();assert.equal(currentCalls,1);
  service.requestCurrent();await service.idle();assert.equal(currentCalls,1);
 }finally{await service.shutdown();await f.cleanup();}
});

test('fact finalization leaves facts untouched and relations unresolved',async()=>{
 const f=await fixture();const store=new ThreeAgentStore(f.path);
 try{
  const r=row('a',1);store.archive(r,false);const extracted=[{observationId:'a',result:result('a')}];const copy=structuredClone(extracted);
  const finalized=finalizeObservationFacts(store,[r],extracted,true);
  assert.strictEqual(finalized,extracted);assert.deepEqual(extracted,copy);assert.equal(store.reviewStatus().unresolvedWindows,1);
 }finally{store.close();await f.cleanup();}
});

test('relationship checks are question-and-evidence scoped, not every observation',async()=>{
 assert.equal(needsRelationshipReview('之前经过哪些环境？'),false);
 assert.equal(needsRelationshipReview('我来过同一间屋子吗？'),true);
 assert.equal(needsRelationshipReview('上次钥匙放哪了？'),true);
 const f=await fixture();const store=new ThreeAgentStore(f.path);
 try{
  store.archive(row('a',1),false);const token=store.claimReview('a','room-question')!;
  assert.equal(store.finishReview('a',token,result('a'),'room-question'),true);
  assert.equal(store.claimReview('a','room-question'),null);
  assert.ok(store.claimReview('a','object-question'));
  assert.equal(store.review('a','room-question')!.status,'done');assert.equal(store.reviewStatus().unresolvedWindows,1);
 }finally{store.close();await f.cleanup();}
});

test('out-of-order evidence is usable without waiting for the earlier association, but never before window cutoff',async()=>{
 const f=await fixture();const store=new ThreeAgentStore(f.path,()=>10000);
 try{
  for(let i=0;i<8;i++)store.archive(row(String(i),i),false);
  const first=store.claimExtraction(true)!,second=store.claimExtraction(true)!;
  store.saveExtraction(second.windowId,second.work,second.work.map(w=>({observationId:w.observationId,result:result(w.observationId)})));
  assert.equal(store.version(),0);assert.equal(store.snapshot(7).evidence.length,4);assert.equal(store.snapshot(6).evidence.length,0);
  assert.equal(store.claimAssociation(),null);assert.ok(first.work.length);
 }finally{store.close();await f.cleanup();}
});

test('a fixed one-extractor control cannot silently scale to two',()=>{
 const controller=new AdaptiveExtractionLimit(1);assert.equal(controller.choose(100,100000,0,100000),1);
});

test('string facts are structural failures, not silently converted into cited evidence',()=>{
 const malformed={summary:'scene',sourceIds:['a'],facts:['visible scene']};
 assert.throws(()=>validateAgentEvidence(malformed as unknown as AgentResult,['a']),/structure/);
 assert.deepEqual(malformed.facts,['visible scene']);
});

test('low latency extraction closes at two observations or deadline, without dropping the tail',async()=>{
 const f=await fixture();let now=1000;const store=new ThreeAgentStore(f.path,()=>now);
 try{
  store.configureExtraction(2,2000);store.archive(row('a',1000),false);
  assert.equal(store.claimExtraction(),null);now=3000;store.archive(row('b',3000),false);
  const work=store.claimExtraction()!;assert.deepEqual(work.work.map(w=>w.observationId),['a','b']);
  now=5000;store.archive(row('c',5000),false);assert.equal(store.claimExtraction(),null);
  assert.deepEqual(store.claimExtraction(true)!.work.map(w=>w.observationId),['c']);
 }finally{store.close();await f.cleanup();}
});

test('persistent extraction policy cannot silently mix protocols or batch policies',async()=>{
 const f=await fixture();let store=new ThreeAgentStore(f.path);
 try{
  store.configureExtraction(1,0,'direct-claims-v1');store.close();store=new ThreeAgentStore(f.path);
  store.configureExtraction(1,0,'direct-claims-v1');assert.equal(store.extractionPolicy().batchMax,1);
  assert.throws(()=>store.configureExtraction(2,2000,'direct-claims-v1'),/new root/);
  assert.throws(()=>store.configureExtraction(1,0,'another-protocol'),/new root/);
 }finally{store.close();await f.cleanup();}
});

test('extractor ledgers rotate even when the coordinator fully drains between windows',async()=>{
 const f=await fixture();const store=new ThreeAgentStore(f.path,()=>10000);store.configureExtraction(2,2000);const slots:number[]=[];
 const models:ThreeAgentModels={current:async r=>result(r.id),memory:async r=>result(r.id),question:async()=>({text:'unknown',source:'historical',sourceIds:[],abstained:true}),extractWindow:async(rows,slot)=>{slots.push(slot);return rows.map(r=>({observationId:r.id,result:result(r.id)}));},associateWindow:async(_r,extracted)=>extracted};
 const service=new ThreeAgentService(store,models,undefined,()=>10000,true,async r=>r,{continuousCurrent:false,extractionMax:1,relationshipMode:'on-demand'});
 try{
  for(let i=0;i<3;i++){await service.observe(row(String(i*2),i*2));await service.observe(row(String(i*2+1),i*2+1));await service.idle();}
  assert.deepEqual(slots,[0,1,0]);assert.equal(service.backgroundState().memoryBatchMax,2);
 }finally{await service.shutdown();await f.cleanup();}
});
