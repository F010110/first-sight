import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ThreeAgentStore,type AgentResult} from './three-agent-store.js';
import {ThreeAgentService,AgentSlots,type ThreeAgentModels} from './three-agent-service.js';
import {AssistantRuntime} from './runtime.js';

const row=(id:string,atMs:number)=>({id,atMs,frames:[id+'.png']});
const result=(id:string):AgentResult=>({facts:[{text:'visible desk',sourceIds:[id]}],summary:'desk; room identity uncertain',sourceIds:[id]});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
const tick=()=>new Promise<void>(r=>setImmediate(r));
async function fixture(){const root=await mkdtemp(join(tmpdir(),'three-agent-'));return {root,path:join(root,'memory.sqlite'),cleanup:()=>rm(root,{recursive:true,force:true})};}
const models:ThreeAgentModels={current:async r=>result(r.id),memory:async r=>result(r.id),question:async(_t,h,r)=>({text:'visible desk',source:h?'historical':'visual',sourceIds:[r.id]})};

test('paused replay questions use source clock and cannot run after future ingestion or write answers into memory',async()=>{
 const f=await fixture(),store=new ThreeAgentStore(f.path);
 const service=new ThreeAgentService(store,models,undefined,Date.now,true,async r=>r,{continuousCurrent:false});
 try{
  await service.observe(row('a',1000));await service.idle();const version=store.version();
  const answer=await service.questionForReplay('What is visible?',1000);assert.equal(answer.text,'visible desk');assert.equal(store.version(),version);
  await service.observe(row('b',2000));await service.idle();await assert.rejects(service.questionForReplay('Old question',1000),/future ingestion/);
 }finally{await service.shutdown();await f.cleanup();}
});

test('durable archive supersedes only immediate tasks, preserves every memory task',async()=>{
 const f=await fixture();const store=new ThreeAgentStore(f.path);
 try{
  store.archive(row('a',1));store.archive(row('b',2));
  assert.equal(store.claim('current')!.observationId,'b');
  const a=store.claim('memory')!;assert.equal(a.observationId,'a');store.commit(a,result('a'),0);
  const b=store.claim('memory')!;assert.equal(b.observationId,'b');store.commit(b,result('b'),1);
  assert.equal(store.version(),2);assert.equal(store.snapshot(1).results.length,1);
  assert.equal(store.observation('a').id,'a');assert.throws(()=>store.archive({...row('a',1),frames:['changed.png']}));
 }finally{store.close();await f.cleanup();}
});

test('organization callback failure cannot undo committed facts or poison subsequent ingestion',async()=>{
 const f=await fixture(),store=new ThreeAgentStore(f.path);let calls=0;
 const service=new ThreeAgentService(store,{...models,afterMemoryCommit:async()=>{calls++;assert.equal(store.version(),calls);throw Error('Index unavailable');}},undefined,Date.now,true,async r=>r,{continuousCurrent:false});
 try{
  await service.observe(row('a',1000));await service.idle();
  await service.observe(row('b',2000));await service.idle();
  assert.equal(calls,2);assert.equal(store.version(),2);
  assert.equal(store.snapshot(2000).results.filter(r=>r.lane==='memory').length,2);
 }finally{await service.shutdown();await f.cleanup();}
});

test('restart recovers expired leases; fencing prevents late duplicate commit',async()=>{
 const f=await fixture();let now=1000;let store=new ThreeAgentStore(f.path,()=>now);
 try{
  store.archive(row('a',1));const old=store.claim('memory')!;store.close();now+=180001;store=new ThreeAgentStore(f.path,()=>now);
  const recovered=store.claim('memory')!;assert.equal(recovered.attempt,2);
  assert.throws(()=>store.commit(old,result('a'),0),/lease/);store.commit(recovered,result('a'),0);
  assert.equal(store.snapshot(100).results.length,1);
 }finally{store.close();await f.cleanup();}
});

test('future evidence and version conflicts cannot mutate semantic memory',async()=>{
 const f=await fixture();const store=new ThreeAgentStore(f.path);
 try{
  store.archive(row('a',1));store.archive(row('future',2));const work=store.claim('memory')!;
  assert.throws(()=>store.commit(work,{...result('a'),sourceIds:['a','future']},0),/Future/);
  assert.throws(()=>store.commit(work,result('a'),99),/version/);assert.equal(store.version(),0);
 }finally{store.close();await f.cleanup();}
});

test('independent connections cannot claim concurrent writers in the same lane',async()=>{
 const f=await fixture();const a=new ThreeAgentStore(f.path);const b=new ThreeAgentStore(f.path);
 try{a.archive(row('a',1));a.archive(row('b',2));const first=a.claim('memory')!;assert.equal(b.claim('memory'),null);a.commit(first,result('a'),0);assert.equal(b.claim('memory')!.observationId,'b');}
 finally{a.close();b.close();await f.cleanup();}
});

test('slow current agent cannot block durable ingestion, memory lane or question',async()=>{
 const f=await fixture();const block=deferred();const store=new ThreeAgentStore(f.path,()=>1000);
 const service=new ThreeAgentService(store,{...models,current:async r=>{await block.promise;return result(r.id);}},new AgentSlots(2),()=>1000);
 try{
  await service.observe(row('a',900));await tick();await service.observe(row('b',950));await tick();
  assert.equal(store.observation('b').id,'b');
  const answer=await service.question('what happened',true);assert.equal(answer.text,'visible desk');
  assert.ok(store.version()>=1);
 }finally{block.resolve();await service.shutdown();await f.cleanup();}
});

test('memory consumes raw records even when immediate observation fails',async()=>{
 const f=await fixture();const store=new ThreeAgentStore(f.path);
 const service=new ThreeAgentService(store,{...models,current:async()=>{throw Error('injected provider failure');}},new AgentSlots(2),()=>1000);
 try{await service.observe(row('a',900));await service.idle();assert.equal(store.version(),1);assert.ok(store.status().some((r:any)=>r.lane==='current'&&r.status==='failed'));}
 finally{await service.shutdown();await f.cleanup();}
});

test('pause prevents new model calls; originals remain available and resume processes backlog',async()=>{
 const f=await fixture();const store=new ThreeAgentStore(f.path);let calls=0;
 const service=new ThreeAgentService(store,{...models,memory:async r=>{calls++;return result(r.id);}});
 try{service.discardPending();await service.observe(row('a',1));await tick();assert.equal(calls,0);assert.equal(store.observation('a').id,'a');service.resume();await service.idle();assert.equal(calls,1);}
 finally{await service.shutdown();await f.cleanup();}
});

test('slot limit and question priority keep finite concurrency',async()=>{
 const slots=new AgentSlots(1);const block=deferred();const order:string[]=[];
 const a=slots.run('current',async()=>{order.push('a');await block.promise;});
 const b=slots.run('memory',async()=>{order.push('b');});const c=slots.run('question',async()=>{order.push('c');});
 await tick();assert.deepEqual(order,['a']);block.resolve();await Promise.all([a,b,c]);assert.deepEqual(order,['a','c','b']);
});

test('default slots reserve interaction capacity while both resident agents are blocked',async()=>{
 const slots=new AgentSlots();const block=deferred();let background=0;
 const a=slots.run('current',async()=>{background++;await block.promise;});
 const b=slots.run('memory',async()=>{background++;await block.promise;});
 await tick();assert.equal(background,2);
 const answer=await slots.run('question',async()=>'answered-before-background');assert.equal(answer,'answered-before-background');
 block.resolve();await Promise.all([a,b]);
});

test('late current answer cannot masquerade as now',async()=>{
 const f=await fixture();let now=1000;const store=new ThreeAgentStore(f.path,()=>now);
 const service=new ThreeAgentService(store,{...models,question:async()=>{now=5000;return {text:'desk',source:'visual',sourceIds:['a']};}},new AgentSlots(2),()=>now);
  try{service.discardPending();await service.observe(row('a',900));service.resume();const answer=await service.question('now',false);assert.equal(answer.source,'historical');assert.match(answer.text,/不能代表现在/);}
 finally{await service.shutdown();await f.cleanup();}
});

test('AssistantRuntime can submit a question while current inference is delayed',async()=>{
 const f=await fixture();const block=deferred();const store=new ThreeAgentStore(f.path,()=>1000);
 const service=new ThreeAgentService(store,{...models,current:async r=>{await block.promise;return result(r.id);}},new AgentSlots(2),()=>1000);
 const runtime=new AssistantRuntime({plan:async()=>({capability:'memory.query'})},service,{append:async()=>{}},[{id:'memory.query',title:'memory',available:true,requiresFreshObservation:false,execute:async text=>service.question(text,true)}],true,()=>1000);
 try{
  await runtime.control('capture.start');await runtime.observe(row('a',900));await runtime.submit('what happened','memory.query');await runtime.idle();
  assert.equal(runtime.view().tasks[0]!.status,'completed');assert.equal(runtime.view().messages.at(-1)!.text,'visible desk');
 }finally{block.resolve();await runtime.close();await f.cleanup();}
});

for(const delay of [5000,15000,60000])test(`injected ${delay}ms inference delay does not stop recording or historical questions`,async()=>{
 const f=await fixture();let now=100000;const block=deferred();const store=new ThreeAgentStore(f.path,()=>now);
 const service=new ThreeAgentService(store,{...models,current:async r=>{await block.promise;return result(r.id);}},new AgentSlots(2),()=>now);
 try{
  await service.observe(row('a',now));await tick();now+=delay;
  await service.observe(row('b',now));await tick();
  assert.equal(store.latest()!.id,'b');const answer=await service.question('earlier',true);assert.equal(answer.source,'historical');
  assert.equal(store.observation('a').atMs,100000);
  block.resolve();await service.idle();
  assert.ok(store.snapshot(now).results.some(r=>r.lane==='current'&&r.observation_id==='a'&&r.source_at_ms===100000&&r.available_at_ms===now));
 }finally{block.resolve();await service.shutdown();await f.cleanup();}
});
