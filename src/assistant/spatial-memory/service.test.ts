import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {SpatialMemoryService} from './service.js';
import {SpatialLongTermStore} from './long-term-store.js';
import {SpatialWorkingMemory} from './working-context.js';
import type {Observation,SpatialModels,SpatialAction,Assessment} from './contracts.js';

async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-rewrite-'));await mkdir(join(dir,'sources'));
 const row=async(id:string,atMs:number):Promise<Observation>=>({id,atMs,recordingId:'recording',views:await Promise.all(['front','left','right'].map(async direction=>{const bytes=Buffer.from(id+direction),path=join(dir,'sources',id+'-'+direction+'.png');await writeFile(path,bytes);return {id,direction,path,sha256:createHash('sha256').update(bytes).digest('hex')};}))});
 return {dir,row,root:join(dir,'new-spatial'),cleanup:()=>rm(dir,{recursive:true,force:true})};
}
const assessment=(id:string,status:'new'|'known'|'unknown'='new',placeId:string|null=null,sourceIds=[id]):Assessment=>({location:{status,placeId,name:status==='unknown'?'无法确定':'区域'+id,reason:'独立当前布局与实际交付来源',sourceIds},hypotheses:[],unresolved:[],relations:[]});
const commit=(a:Assessment):SpatialAction=>({kind:'commit',assessment:a});
const facts=(row:Observation)=>({summary:'当前观察'+row.id,details:['当前细节'+row.id]});

test('new durable spatial service produces location, visits and bounded context; old revisit requires actual retrieval and inspection',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined;let time=1000;const phases=new Map<string,number>();
 try{
  const models:SpatialModels={async perceive(row){assert.deepEqual(Object.keys(row).sort(),['atMs','id','recordingId','views']);return facts(row);},async reason(input,images){
   const phase=phases.get(input.current.id)??0;phases.set(input.current.id,phase+1);if(phase===0)assert.equal(input.context.location,null);
   if(input.current.id!=='c')return commit(assessment(input.current.id));
   assert.equal(input.context.recent.length,0);assert.equal(input.context.anchors.length,0);
   if(phase===0)return {kind:'read',beforeMs:20,assessment:assessment('c','unknown')};
   if(phase===1){assert.equal(input.context.location?.status,'unknown');assert.ok(JSON.stringify(input.toolResult).includes('当前观察a'));return {kind:'inspect',observationIds:['a'],assessment:assessment('c','unknown')};}
   assert.equal(images.length,6);assert.ok(input.inspectedIds.includes('a'));const prior=input.context.retrieved.find(r=>r.observationId==='a')!;
   return commit(assessment('c','known',prior.location.placeId,['c','a']));
  }};
  service=await SpatialMemoryService.create(f.root,models,{now:()=>time++});
  await service.observe(await f.row('a',0));await service.observe(await f.row('b',10));await service.observe(await f.row('c',70000));
  const progress=await service.finishInput();assert.equal(progress.spatialStates,3);assert.equal(progress.places,2);assert.equal(progress.visits,3);
  const first=service.snapshotAt(1,10000),last=service.latest()!;
  assert.equal(first.history.length,1);assert.equal(last.state.assessment.location.placeId,first.state.assessment.location.placeId);
  assert.notEqual(last.state.visitId,first.state.visitId);assert.equal(last.context.location?.placeId,last.state.assessment.location.placeId);
  assert.throws(()=>service!.snapshotAt(3,0));first.state.assessment.location.name='mutated';assert.notEqual(service.snapshotAt(1,10000).state.assessment.location.name,'mutated');
 }finally{await service?.close();await f.cleanup();}
});

test('two perception slots run eagerly out of order, spatial commits cannot skip causal prefix',async()=>{
 const f=await fixture();let release!:()=>void;const barrier=new Promise<void>(r=>release=r);let second!:()=>void;const started=new Promise<void>(r=>second=r);const order:string[]=[];let service:SpatialMemoryService|undefined;
 try{service=await SpatialMemoryService.create(f.root,{async perceive(row){if(row.id==='a')await barrier;else second();return facts(row);},async reason(input){order.push(input.current.id);return commit(assessment(input.current.id));}});
  await service.observe(await f.row('a',0));await service.observe(await f.row('b',1));await started;assert.deepEqual(order,[]);assert.equal(service.latest(),null);release();await service.finishInput();assert.deepEqual(order,['a','b']);
 }finally{release();await service?.close();await f.cleanup();}
});

test('known identity cannot be guessed from persistent names without delivered historical image evidence',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,calls=0;
 try{service=await SpatialMemoryService.create(f.root,{async perceive(row){return facts(row);},async reason(input){calls++;return commit(assessment(input.current.id,'known','guessed',['a']));}},{maxReasonCalls:2});await service.observe(await f.row('a',0));await assert.rejects(service.finishInput(),/budget exhausted/);assert.equal(calls,2);assert.equal(service.latest(),null);assert.equal(service.progress().spatialStates,0);}
 finally{await service?.close().catch(()=>{});await f.cleanup();}
});

test('explicit recovery restores only durable same-session checkpoint and reuses immutable extraction',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined;let extracted=0;
 const models:SpatialModels={async perceive(row){extracted++;return facts(row);},async reason(input){return commit(assessment(input.current.id));}};
 try{
  service=await SpatialMemoryService.create(f.root,models);await service.observe(await f.row('a',0));await service.finishInput();const before=service.latest();await service.close();
  await assert.rejects(SpatialMemoryService.create(f.root,models));
  service=await SpatialMemoryService.create(f.root,models,{resume:true});assert.deepEqual(service.latest(),before);await service.resumePending();await service.observe(await f.row('b',1));await service.finishInput();assert.equal(extracted,2);assert.equal(service.latest()!.state.version,2);
 }finally{await service?.close();await f.cleanup();}
});

test('failed spatial prefix preserves later extracted observations and resumes from last committed state',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined;let extractions=0;const models:SpatialModels={async perceive(row){extractions++;return facts(row);},async reason(input){if(input.current.id==='b')throw Error('provider failure');return commit(assessment(input.current.id));}};
 try{
  service=await SpatialMemoryService.create(f.root,models);for(const [i,id] of ['a','b','c'].entries())await service.observe(await f.row(id,i));await assert.rejects(service.finishInput(),/provider failure/);assert.equal(service.latest()!.state.version,1);await service.close().catch(()=>{});
  service=await SpatialMemoryService.create(f.root,{...models,async reason(input){return commit(assessment(input.current.id));}},{resume:true});await service.resumePending();await service.finishInput();assert.equal(service.latest()!.state.version,3);assert.equal(extractions,3);
 }finally{await service?.close().catch(()=>{});await f.cleanup();}
});

test('long-term transaction failure cannot create place/state/checkpoint or publish short-term changes',async()=>{
 const f=await fixture();const store=new SpatialLongTermStore(f.root);try{const row=await f.row('a',0);store.archive(row);store.saveFacts('a',facts(row));assert.throws(()=>store.commit(row,assessment('a'),()=>{throw Error('checkpoint failure');}),/checkpoint failure/);assert.deepEqual(store.counts(),{observations:1,spatialStates:0,places:0,visits:0,pending:1});assert.equal(store.checkpoint(1),null);}finally{store.close();await f.cleanup();}
});

test('new observation does not inherit location; cold start never rebuilds context from archive',async()=>{
 const context=new SpatialWorkingMemory();const row:Observation={id:'a',atMs:0,views:[]};context.begin(row);context.commit({version:1,observationId:'a',atMs:0,availableAtMs:0,facts:facts(row),assessment:assessment('a'),visitId:'v'});context.begin({...row,id:'b',atMs:1});assert.equal(context.view().location,null);context.begin({...row,id:'c',atMs:70000});assert.equal(context.view().recent.length,0);assert.equal(context.view().anchors.length,0);assert.throws(()=>new SpatialWorkingMemory().view());
});

test('legacy database is refused rather than silently altered into new schema',async()=>{
 const f=await fixture();await mkdir(f.root);const path=join(f.root,'spatial.sqlite'),db=new DatabaseSync(path);db.exec('CREATE TABLE legacy(value TEXT)');db.close();try{assert.throws(()=>new SpatialLongTermStore(f.root),/legacy database/);const check=new DatabaseSync(path,{readOnly:true});try{assert.equal((check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).length,1);}finally{check.close();}}finally{await f.cleanup();}
});

test('later sourced revisions change current historical view, never prior snapshots or original facts',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,inspected=false;
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(row){return facts(row);},async reason(input){
   if(input.current.id!=='c')return commit(assessment(input.current.id));
   if(!inspected){inspected=true;return {kind:'inspect',observationIds:['a','b'],assessment:assessment('c','unknown')};}
   const placeId=input.context.retrieved.find(r=>r.observationId==='a')!.location.placeId;
   return commit({...assessment('c'),revisions:[{observationId:'b',location:{status:'known',placeId,name:'区域a',reason:'新证据纠正旧归属',sourceIds:['c','b','a']}}]});
  }});
  for(const [i,id] of ['a','b','c'].entries())await service.observe(await f.row(id,i));await service.finishInput();
  const before=service.snapshotAt(2,Number.MAX_SAFE_INTEGER),after=service.snapshotAt(3,Number.MAX_SAFE_INTEGER);
  assert.notEqual(before.history[0]!.location.placeId,before.history[1]!.location.placeId);
  assert.equal(after.history[0]!.location.placeId,after.history[1]!.location.placeId);assert.equal(after.visits.length,2);
  assert.deepEqual(before.history[1]!.facts,after.history[1]!.facts);assert.notEqual(service.snapshotAt(2,Number.MAX_SAFE_INTEGER).history[1]!.location.placeId,after.history[1]!.location.placeId);
  assert.deepEqual(Object.keys(service.reader()).sort(),['inspectAt','latest','snapshotAt']);
  assert.equal((await service.reader().inspectAt(2,Number.MAX_SAFE_INTEGER,['a'])).length,3);
  await assert.rejects(service.reader().inspectAt(2,Number.MAX_SAFE_INTEGER,['c']),/outside committed snapshot/);
 }finally{await service?.close();await f.cleanup();}
});

test('extra source fields including oracle labels are not forwarded into independent observation',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined;
 try{service=await SpatialMemoryService.create(f.root,{async perceive(row){assert.ok(!('annotation' in row));assert.ok(!('placeId' in row.views[0]!));return facts(row);},async reason(input){return commit(assessment(input.current.id,'unknown'));}});const row:any=await f.row('a',0);row.annotation={placeId:'private'};row.views[0].placeId='private';await service.observe(row);await service.finishInput();assert.equal(service.latest()!.state.assessment.location.status,'unknown');}finally{await service?.close();await f.cleanup();}
});

test('a newly archived observation clears current location for readers until its spatial commit',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,release!:()=>void;const gate=new Promise<void>(r=>release=r);
 try{service=await SpatialMemoryService.create(f.root,{async perceive(row){if(row.id==='b')await gate;return facts(row);},async reason(input){return commit(assessment(input.current.id));}});await service.observe(await f.row('a',0));await service.finishInput();assert.ok(service.latest()!.currentLocation);await service.observe(await f.row('b',1));assert.equal(service.latest()!.current.id,'b');assert.equal(service.latest()!.currentLocation,null);assert.equal(service.latest()!.pendingCurrent,true);assert.equal(service.latest()!.state.observationId,'a');release();await service.finishInput();assert.equal(service.latest()!.pendingCurrent,false);assert.ok(service.latest()!.currentLocation);}finally{release();await service?.close();await f.cleanup();}
});

test('tool continuations cannot skip the current spatial assessment',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,calls=0;
 try{service=await SpatialMemoryService.create(f.root,{async perceive(row){return facts(row);},async reason(input){if(calls++===0)return {kind:'find',terms:['x']} as any;assert.match(input.feedback!,/Missing location/);assert.equal(input.toolResult,null);return commit(assessment(input.current.id));}});await service.observe(await f.row('a',0));await service.finishInput();assert.equal(calls,2);assert.equal(service.latest()!.state.version,1);}finally{await service?.close();await f.cleanup();}
});

test('recent context can support spatial continuity without a mandatory historical-image ritual',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined;
 try{service=await SpatialMemoryService.create(f.root,{async perceive(row){return facts(row);},async reason(input){if(input.current.id==='a')return commit(assessment('a'));assert.deepEqual(input.inspectedIds,['b']);const recent=input.context.recent[0]!;const value=assessment('b','known',recent.assessment.location.placeId);value.location.contextRefs=['a'];return commit(value);}});await service.observe(await f.row('a',0));await service.observe(await f.row('b',1000));await service.finishInput();assert.equal(service.progress().places,1);assert.equal(service.progress().visits,1);assert.deepEqual(service.latest()!.state.assessment.location.contextRefs,['a']);}finally{await service?.close();await f.cleanup();}
});
