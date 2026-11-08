import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ObservationArchive} from './observation-archive.js';
import {BoundedSerialLane} from './serial-lane.js';
import {LayeredMemoryRuntime} from './layered-runtime.js';
import type {Observation,Assessment} from './contracts.js';
import {validateBatchCoverage} from './spatial-batch.js';
import {BatchSpatialMemory} from './batch-memory.js';
import {V3EvidenceTools} from './evidence-tools-v3.js';
import {BACKGROUND_CONTEXT} from '@earendil-works/pi-agent-core';

const facts={summary:'visible room',details:['door and floor']};
function setup(){
 const root=mkdtempSync(join(tmpdir(),'layered-memory-')),path=join(root,'source.png');writeFileSync(path,'original');
 const sha256=createHash('sha256').update('original').digest('hex');
 const observation=(n:number):Observation=>({id:`o${n}`,atMs:n*2000,views:['front','left','right'].map(direction=>({id:`o${n}`,direction,path,sha256}))});
 return {root,observation,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
const budget={maxTasks:4,maxSpanMs:120000,maxBytes:1000000};
function assessment(id:string):Assessment{return {location:{status:'new',placeId:null,name:'room',reason:'current evidence',sourceIds:[id]},hypotheses:[],unresolved:[],relations:[]};}

test('serial lane has one actual writer and rejects overload before scheduling',async()=>{
 const lane=new BoundedSerialLane({...budget,maxTasks:2});let release!:()=>void;const blocked=new Promise<void>(r=>{release=r;});const calls:number[]=[];
 assert.equal(lane.admit({id:'1',startMs:0,endMs:1,bytes:1,run:async()=>{calls.push(1);await blocked;}}),true);
 assert.equal(lane.admit({id:'2',startMs:1,endMs:2,bytes:1,run:async()=>{calls.push(2);}}),true);
 assert.equal(lane.admit({id:'3',startMs:2,endMs:3,bytes:1,run:async()=>{calls.push(3);}}),false);
 await Promise.resolve();assert.deepEqual(calls,[1]);release();await lane.idle();assert.deepEqual(calls,[1,2]);
});

test('archive is available before spatial version and facts obey availability cutoff',()=>{
 const f=setup();let now=10;const archive=new ObservationArchive(f.root,100000,()=>now);
 try{archive.append(f.observation(0));now=20;archive.saveFacts('o0',facts);assert.equal(archive.read(0,1,15)[0]!.facts,null);assert.deepEqual(archive.read(0,1,20)[0]!.facts,facts);assert.equal(archive.progress().factsThroughSequence,1);}finally{archive.close();f.cleanup();}
});

test('facts-first batches contain no image paths and question reads never wait for spatial agent',async()=>{
 const f=setup(),archive=new ObservationArchive(f.root,1000000);let release!:()=>void;const blocked=new Promise<void>(r=>{release=r;});let started=false,commits=0;
 const runtime=new LayeredMemoryRuntime(archive,{perceiveWindow:async rows=>rows.map(r=>({id:r.id,facts}))},{
  judge:async batch=>{assert.equal(JSON.stringify(batch).includes('source.png'),false);assert.equal(JSON.stringify(batch).includes('views'),false);started=true;await blocked;return batch.observations.map(o=>({observationIds:[o.id],assessment:assessment(o.id)}));},
  commit:async()=>{commits++;}
 },{perceptionMs:6000,spatialMs:40000,maxBufferedObservations:32,perceptionBudget:budget,spatialBudget:budget});
 try{
  assert.deepEqual(runtime.questionEvidence().observations,[]);
  runtime.observe(f.observation(0));runtime.observe(f.observation(1));runtime.tick(40000);
  // Drain microtasks without wall-clock sleeps or network requests.
  for(let i=0;i<20&&!started;i++)await Promise.resolve();assert.equal(started,true);
  runtime.observe(f.observation(21));assert.equal(runtime.questionEvidence().observations.length,3);assert.equal(runtime.progress().spatialThroughSequence,0);
  release();await runtime.drain();assert.equal(commits,2);assert.equal(runtime.progress().spatialThroughSequence,3);
 }finally{archive.close();f.cleanup();}
});

test('spatial overload retains originals and records gaps without unbounded deferred tasks',async()=>{
 const f=setup(),archive=new ObservationArchive(f.root,1000000);let release!:()=>void;const blocked=new Promise<void>(r=>{release=r;});
 const runtime=new LayeredMemoryRuntime(archive,{perceiveWindow:async rows=>rows.map(r=>({id:r.id,facts}))},{judge:async batch=>{await blocked;return [{observationIds:batch.observations.map(o=>o.id),assessment:assessment(batch.observations.at(-1)!.id)}];},commit:async()=>{}},{perceptionMs:6000,spatialMs:40000,maxBufferedObservations:32,perceptionBudget:budget,spatialBudget:{...budget,maxTasks:1}});
 try{runtime.observe(f.observation(0));runtime.tick(40000);runtime.observe(f.observation(20));runtime.tick(80000);assert.equal(runtime.progress().spatial.pending,1);assert.equal(archive.latest()!.sequence,2);assert.equal(archive.gaps().length,1);release();await runtime.drain();assert.equal(runtime.progress().spatialThroughSequence,1);}finally{archive.close();f.cleanup();}
});

test('batch coverage rejects gaps, overlap and out of order members',()=>{
 const batch={id:'b',observations:[{id:'a',atMs:0,facts},{id:'b',atMs:2000,facts}]};
 assert.throws(()=>validateBatchCoverage(batch,[{observationIds:['a'],assessment:assessment('a')}]));
 assert.throws(()=>validateBatchCoverage(batch,[{observationIds:['b','a'],assessment:assessment('a')}]));
 assert.equal(validateBatchCoverage(batch,[{observationIds:['a'],assessment:assessment('a')},{observationIds:['b'],assessment:assessment('b')}]).length,2);
});

test('lane applies byte and source-span budgets and stops after a failed writer',async()=>{
 const lane=new BoundedSerialLane({maxTasks:5,maxBytes:10,maxSpanMs:100});
 assert.equal(lane.admit({id:'large',startMs:0,endMs:1,bytes:11,run:async()=>{}}),false);
 assert.equal(lane.admit({id:'long',startMs:0,endMs:101,bytes:1,run:async()=>{}}),false);
 let writes=0;
 lane.admit({id:'failure',startMs:0,endMs:1,bytes:1,run:async()=>{throw Error('commit failed');}});
 lane.admit({id:'later',startMs:1,endMs:2,bytes:1,run:async()=>{writes++;}});
 await lane.idle();assert.equal(writes,0);assert.equal(lane.status().stopped,true);assert.equal(lane.status().pending,1);
 assert.equal(lane.admit({id:'more',startMs:2,endMs:3,bytes:1,run:async()=>{}}),false);
});

test('archive persists raw evidence and explicit gaps, with finite ingest capacity',()=>{
 const f=setup();let archive=new ObservationArchive(f.root,100000);
 try{
  archive.append(f.observation(0));archive.gap(1,'spatial','overload');archive.close();
  archive=new ObservationArchive(f.root,1);
  assert.equal(archive.latest()!.observation.id,'o0');assert.equal(archive.gaps().length,1);
  assert.throws(()=>archive.append(f.observation(1)),/capacity exhausted/);assert.equal(archive.latest()!.sequence,1);
 }finally{archive.close();f.cleanup();}
});

test('missing fast facts never produce a fabricated spatial completion',async()=>{
 const f=setup(),archive=new ObservationArchive(f.root,1000000);let calls=0;
 const runtime=new LayeredMemoryRuntime(archive,{perceiveWindow:async()=>[]},{judge:async()=>{calls++;return [];},commit:async()=>{throw Error('not reachable');}},{perceptionMs:6000,spatialMs:40000,maxBufferedObservations:32,perceptionBudget:budget,spatialBudget:budget});
 try{runtime.observe(f.observation(0));await runtime.drain();assert.equal(calls,0);assert.equal(runtime.progress().spatialThroughSequence,0);assert.equal(archive.gaps().length,2);assert.equal(runtime.questionEvidence().observations.length,1);}finally{archive.close();f.cleanup();}
});

test('durable retry is explicit, bounded and resolves gaps without erasing failure history',async()=>{
 const f=setup(),archive=new ObservationArchive(f.root,1000000);let broken=true,calls=0;
 const processor={judge:async(batch:any)=>{calls++;if(broken)throw Error('injected failure');return [{observationIds:batch.observations.map((o:any)=>o.id),assessment:assessment(batch.observations.at(-1).id)}];},commit:async()=>{}};
 const runtime=new LayeredMemoryRuntime(archive,{perceiveWindow:async rows=>rows.map(r=>({id:r.id,facts}))},processor,{perceptionMs:6000,spatialMs:40000,maxBufferedObservations:32,perceptionBudget:budget,spatialBudget:budget});
 try{
  runtime.observe(f.observation(0));await runtime.drain();assert.equal(calls,1);assert.equal(runtime.progress().spatialThroughSequence,0);
  broken=false;runtime.retryFailures();await runtime.drain();assert.equal(calls,2);assert.equal(runtime.progress().spatialThroughSequence,1);assert.equal(archive.gaps().length,1);assert.ok((archive.gaps()[0] as any).resolvedAtMs);
 }finally{archive.close();f.cleanup();}
});

test('recovering durable pending work enforces the original configuration and capacity before scheduling',async()=>{
 const f=setup();let archive=new ObservationArchive(f.root,1000000);const config={perceptionMs:6000,spatialMs:40000,maxBufferedObservations:32,perceptionBudget:budget,spatialBudget:budget};
 archive.configure(config);const row=archive.append(f.observation(0));for(const lane of ['perception','spatial'] as const){archive.admit(row.sequence,lane,{maxObservations:32,maxBytes:1000000,maxSpanMs:120000});archive.makeJob(lane,[row]);}archive.jobStatus('perception:1','running');archive.close();
 archive=new ObservationArchive(f.root,1000000);let calls=0;
 const processor={judge:async(batch:any)=>{calls++;return [{observationIds:batch.observations.map((o:any)=>o.id),assessment:assessment('o0')}];},commit:async()=>{}};
 try{
  assert.throws(()=>new LayeredMemoryRuntime(archive,{perceiveWindow:async()=>[]},processor,{...config,spatialMs:80000}),/configuration changed/);
  const runtime=new LayeredMemoryRuntime(archive,{perceiveWindow:async rows=>rows.map(r=>({id:r.id,facts}))},processor,config);await runtime.drain();assert.equal(calls,1);assert.equal(runtime.progress().spatialThroughSequence,1);
 }finally{archive.close();f.cleanup();}
});

test('partial fast extraction retains valid facts, requests only omissions and falls back to bounded single-source requests',async()=>{
 const f=setup(),archive=new ObservationArchive(f.root,1000000);const seen:string[][]=[];let calls=0;
 const runtime=new LayeredMemoryRuntime(archive,{perceiveWindow:async rows=>{calls++;seen.push(rows.map(r=>r.id));return calls===1?[{id:rows[0]!.id,facts}]:calls===2?[]:rows.map(r=>({id:r.id,facts}));}},{judge:async batch=>[{observationIds:batch.observations.map(o=>o.id),assessment:assessment(batch.observations.at(-1)!.id)}],commit:async()=>{}},{perceptionMs:6000,spatialMs:40000,maxBufferedObservations:32,perceptionBudget:budget,spatialBudget:budget});
 try{runtime.observe(f.observation(0));runtime.observe(f.observation(1));await runtime.drain();assert.deepEqual(seen,[['o0','o1'],['o1'],['o1']]);assert.equal(runtime.progress().factsThroughSequence,2);assert.equal(runtime.progress().spatialThroughSequence,2);}finally{archive.close();f.cleanup();}
});

test('a stalled spatial writer cannot create an unbounded durable backlog; raw capture remains independent',async()=>{
 const f=setup(),archive=new ObservationArchive(f.root,1000000);let release!:()=>void,started!:()=>void;
 const gate=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{started=r;}),small={...budget,maxTasks:2};
 const runtime=new LayeredMemoryRuntime(archive,{perceiveWindow:async rows=>rows.map(r=>({id:r.id,facts}))},{judge:async batch=>{started();await gate;return [{observationIds:batch.observations.map(o=>o.id),assessment:assessment(batch.observations.at(-1)!.id)}];},commit:async()=>{}},{perceptionMs:6000,spatialMs:40000,maxBufferedObservations:32,perceptionBudget:small,spatialBudget:small});
 try{
  runtime.observe(f.observation(0));runtime.tick(40000);await ready;
  for(let i=20;i<220;i++)runtime.observe(f.observation(i));
  const progress=runtime.progress();assert.equal(progress.archivedThroughSequence,201);assert.ok(progress.spatial.pending<=64);assert.ok(progress.perception.pending<=16);assert.ok(archive.jobs('spatial').length+archive.jobs('spatial','running').length<=2);assert.ok(archive.gaps().length>0);assert.equal(runtime.canAcceptForQuality(f.observation(220)),false);
  release();await runtime.drain();assert.ok(runtime.progress().spatialThroughSequence<201);
 }finally{release();archive.close();f.cleanup();}
});

test('a pinned evidence revision excludes late facts and new frames even when host timestamps are identical',async()=>{
 const f=setup(),archive=new ObservationArchive(f.root,1000000,()=>100),memory=new BatchSpatialMemory(join(f.root,'memory'),archive),evidence=new V3EvidenceTools(memory,archive);
 try{
  archive.append(f.observation(0));const revision=archive.revision();evidence.reset(0,100,2000,['o0'],revision);
  archive.saveFacts('o0',facts);archive.append(f.observation(1));
  assert.equal(archive.findFacts(['room'],0,100,revision,2000).total,0);assert.equal(archive.findFacts(['room'],0,100,archive.revision(),2000).total,1);
  assert.equal(archive.read(0,8,100,revision).length,1);assert.equal(archive.read(0,8,100,revision)[0]!.facts,null);assert.equal(archive.latest(100,revision)!.facts,null);
  const read=evidence.tools().find(t=>t.name==='memory_read')!;const result=await read.execute('test',{ids:['o0']},()=>{},undefined,{} as any,BACKGROUND_CONTEXT) as any;
  assert.equal(JSON.parse(result.content[0].text)[0].facts,null);assert.equal(evidence.readFacts.has('o0'),false);
  const timeline=evidence.tools().find(t=>t.name==='observation_timeline')!;const listing=await timeline.execute('test',{},()=>{},undefined,{} as any,BACKGROUND_CONTEXT) as any;assert.deepEqual(JSON.parse(listing.content[0].text).observations.map((r:any)=>r.id),['o0']);
 }finally{memory.close();archive.close();f.cleanup();}
});
