import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ObservationArchive} from './observation-archive.js';
import {BatchSpatialMemory} from './batch-memory.js';
import type {Assessment,Observation} from './contracts.js';

const facts={summary:'room',details:['fixed counter and doorway']};
const cp={sessionId:'test-injected-session',tipId:'test-injected-tip',skillVersions:{'test-skill':'test-hash'}};
function fixture(){const root=mkdtempSync(join(tmpdir(),'batch-memory-'));const path=join(root,'original.png');writeFileSync(path,'original');const sha256=createHash('sha256').update('original').digest('hex');const archive=new ObservationArchive(join(root,'archive'),1000000),memory=new BatchSpatialMemory(join(root,'memory'),archive);const add=(n:number)=>{const row:Observation={id:'o'+n,atMs:n*2000,views:['front','left','right'].map(direction=>({id:'o'+n,direction,path,sha256}))};archive.append(row);archive.saveFacts(row.id,facts);return {id:row.id,atMs:row.atMs,facts};};return {root,archive,memory,add,close:()=>{memory.close();archive.close();rmSync(root,{recursive:true,force:true});}};}
function a(id:string):Assessment{return {location:{status:'new',placeId:null,name:'room',reason:'specific current layout',sourceIds:[id],regionChangeEvidence:['doorway crossed']},hypotheses:[],unresolved:[],relations:[],memoryNotes:[{text:'distinct fixed counter',sourceIds:[id]}]};}

test('multi-segment memory is atomic, supports local return, and binds every version to one real checkpoint receipt',()=>{
 const f=fixture();try{
  const batch={id:'batch1',observations:[f.add(0),f.add(1),f.add(2)]};
  const back=a('o2');back.location={...back.location,status:'known',placeId:'batch:0',sourceIds:['o2','o0']};
  const segments=[{observationIds:['o0'],assessment:a('o0')},{observationIds:['o1'],assessment:a('o1')},{observationIds:['o2'],assessment:back}];
  const states=f.memory.commit(batch,segments,cp,new Set(),new Set());
  assert.equal(states.length,3);assert.equal(states[0]!.assessment.location.placeId,states[2]!.assessment.location.placeId);assert.notEqual(states[0]!.visitId,states[2]!.visitId);
  assert.equal(f.memory.receipt(batch.id)!.checkpoint.tipId,cp.tipId);assert.equal(f.memory.store.counts().coveredObservations,3);
  assert.equal(f.memory.commit(batch,segments,cp,new Set(),new Set()).length,3);assert.equal(f.memory.store.version(),3);
 }finally{f.close();}
});

test('late segment failure rolls back imported sources, all places, notes, states and Context',()=>{
 const f=fixture();try{const batch={id:'bad',observations:[f.add(0),f.add(1)]},bad=a('o1');bad.placeUpdates=[{key:'absent',value:'old',status:'retracted',reason:'test missing attribute',sourceIds:['o1']}];
  assert.throws(()=>f.memory.commit(batch,[{observationIds:['o0'],assessment:a('o0')},{observationIds:['o1'],assessment:bad}],cp,new Set(),new Set()),/absent/);
  assert.equal(f.memory.store.version(),0);assert.equal(f.memory.store.counts().places,0);assert.equal(f.memory.store.counts().observations,0);assert.equal(f.memory.receipt('bad'),null);assert.equal(f.archive.latest()!.sequence,2);
 }finally{f.close();}
});

test('historical identity still needs inspected and cited support; source facts are not fake image inspection',()=>{
 const f=fixture();try{
  const b1={id:'one',observations:[f.add(0)]};const [state]=f.memory.commit(b1,[{observationIds:['o0'],assessment:a('o0')}],cp,new Set(),new Set());
  const b2={id:'two',observations:[f.add(20)]},known=a('o20');known.location={...known.location,status:'known',placeId:state!.assessment.location.placeId,sourceIds:['o20','o0']};
  assert.throws(()=>f.memory.validate(b2,[{observationIds:['o20'],assessment:known}],new Set(['o0']),new Set()),/undelivered|inspected|evidence/i);
  assert.doesNotThrow(()=>f.memory.validate(b2,[{observationIds:['o20'],assessment:known}],new Set(['o0']),new Set(['o0'])));
 }finally{f.close();}
});

test('v3 retains sourced rename, notes, attributes, relations and historical revisions without changing older snapshots',()=>{
 const f=fixture();try{
  const first={id:'seed',observations:[f.add(0),f.add(1)]};const seeds=f.memory.commit(first,[{observationIds:['o0'],assessment:a('o0')},{observationIds:['o1'],assessment:a('o1')}],cp,new Set(),new Set());
  const batch={id:'return',observations:[f.add(20)]},update=a('o20');update.location={...update.location,status:'known',placeId:seeds[0]!.assessment.location.placeId,name:'larger accurately named room',sourceIds:['o20','o0']};
  update.placeRename={name:update.location.name,reason:'new evidence broadens confirmed extent',sourceIds:['o20']};
  update.placeUpdates=[{key:'counter',value:'fixed counter near doorway',status:'asserted',reason:'visible current detail',sourceIds:['o20']}];
  update.relations=[{kind:'same-facility',referenceId:'o1',reason:'source-backed shared facility',sourceIds:['o20','o1']}];
  update.revisions=[{observationId:'o1',location:{status:'known',placeId:seeds[0]!.assessment.location.placeId,name:update.location.name,reason:'new comparison revises old attribution',sourceIds:['o20','o1','o0']}}];
  const [state]=f.memory.commit(batch,[{observationIds:['o20'],assessment:update}],cp,new Set(['o0','o1']),new Set(['o0','o1']));
  assert.equal(state!.memoryReceipt!.renamedPlace,true);assert.equal(state!.memoryReceipt!.attributeRevisions,1);
  assert.equal((f.memory.store.placeProfile(seeds[0]!.assessment.location.placeId!,1) as any).place.name,'room');
  assert.equal((f.memory.store.placeProfile(seeds[0]!.assessment.location.placeId!,3) as any).place.name,update.location.name);
  assert.equal(f.memory.store.history(2,100000,Number.MAX_SAFE_INTEGER)[1]!.location.placeId,seeds[1]!.assessment.location.placeId);
  assert.equal(f.memory.store.history(3,100000,Number.MAX_SAFE_INTEGER)[1]!.location.placeId,seeds[0]!.assessment.location.placeId);
 }finally{f.close();}
});

test('early segments of a batch do not pretend later evidence was known at their event time',()=>{
 const f=fixture();try{
  const batch={id:'multi-time',observations:[f.add(0),f.add(1),f.add(2)]};
  const states=f.memory.commit(batch,batch.observations.map(o=>({observationIds:[o.id],assessment:a(o.id)})),cp,new Set(),new Set());
  assert.equal(states[0]!.atMs,0);assert.equal(states[0]!.window!.batch!.knowledgeCutoffMs,4000);
  assert.deepEqual(f.memory.store.history(3,2000,Number.MAX_SAFE_INTEGER),[]);
  assert.equal(f.memory.store.placeProfile(states[0]!.assessment.location.placeId!,3,Number.MAX_SAFE_INTEGER,2000),null);
  assert.equal(f.memory.store.history(3,4000,Number.MAX_SAFE_INTEGER).length,3);
  assert.deepEqual(f.memory.receipt(batch.id)!.sources.map(s=>s.id),['o0','o1','o2']);
 }finally{f.close();}
});

test('all segments and Context references share the final batch publication cutoff, never an intermediate savepoint time',()=>{
 const f=fixture();f.memory.close();const start=Date.now()+1000;let clock=start;const memory=new BatchSpatialMemory(join(f.root,'publication-memory'),f.archive,()=>clock++);
 try{
  const batch={id:'publication',observations:[f.add(0),f.add(1)]},states=memory.commit(batch,batch.observations.map(o=>({observationIds:[o.id],assessment:a(o.id)})),cp,new Set(),new Set());
  const receipt=memory.receipt(batch.id)!;assert.ok(receipt.availableAtMs>start);assert.ok(states.every(s=>s.availableAtMs===receipt.availableAtMs));
  assert.deepEqual(memory.store.history(2,100000,receipt.availableAtMs-1),[]);assert.equal(memory.store.history(2,100000,receipt.availableAtMs).length,2);
  assert.ok(memory.store.checkpoint(2)!.recent.every(s=>s.availableAtMs===receipt.availableAtMs));
  assert.throws(()=>memory.store.publishBatchAvailability(batch.id,states,0),/active unpublished/);
 }finally{memory.close();f.archive.close();rmSync(f.root,{recursive:true,force:true});}
});
