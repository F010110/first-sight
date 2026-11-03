import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {SpatialLongTermStore} from './long-term-store.js';
import {validateAssessment,type Assessment,type StoredState,type WorkingContext} from './contracts.js';

test('agent place attributes append atomically, preserve history and respect version/time cutoffs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/place-profile-'));let now=100;const store=new SpatialLongTermStore(root,()=>now);
 const checkpoint=(s:StoredState):WorkingContext=>({current:{id:s.observationId,atMs:s.atMs},location:s.assessment.location,recent:[s],anchors:[],retrieved:[]});
 const make=(id:string,placeId:string|null,status:'asserted'|'uncertain'|'retracted'='asserted'):Assessment=>({location:{status:placeId?'known':'new',placeId,name:'corner',reason:'current source',sourceIds:[id]},hypotheses:[],unresolved:[],relations:[],placeUpdates:[{key:'landmark',value:'red awning',status,reason:'visible source',sourceIds:[id]}]});
 try{
  for(const [i,id] of ['a','b','c','d'].entries()){store.archive({id,atMs:i*2000,views:[]});store.saveFacts(id,{summary:'visible '+id,details:['awning']});}
  const a=store.commit(store.observation('a')!,validateAssessment(make('a',null),'a',new Set(['a'])),checkpoint),id=a.assessment.location.placeId!;
  now=200;store.commit(store.observation('b')!,make('b',id,'uncertain'),checkpoint);
  now=300;store.commit(store.observation('c')!,make('c',id,'retracted'),checkpoint);
  assert.equal(store.placeProfile(id,1)!.attributes[0].status,'asserted');
  assert.equal(store.placeProfile(id,1,50),null);
  assert.equal(store.placeProfile(id,3,250)!.attributes[0].status,'uncertain');
  assert.equal(store.placeProfile(id)!.attributes[0].status,'retracted');
  assert.equal(store.placeProfile(id)!.revisions.length,3);
  const invalid=make('d',id);invalid.placeUpdates![0]!.sourceIds=['not-delivered'];
  assert.throws(()=>validateAssessment(invalid,'d',new Set(['d'])),/place profile evidence/);
  invalid.placeUpdates![0]!.sourceIds=['d'];invalid.placeUpdates![0]!.key='absent';invalid.placeUpdates![0]!.status='retracted';
  assert.throws(()=>store.commit(store.observation('d')!,invalid,checkpoint),/absent/);
  assert.equal(store.version(),3);assert.equal(store.placeProfile(id)!.revisions.length,3);assert.equal(store.pending().length,1);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});

test('schema-v2 databases are refused before any automatic profile or skip-table migration',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/place-legacy-'));
 try{
  const db=new DatabaseSync(join(root,'spatial.sqlite'));db.exec('CREATE TABLE spatial_schema(version INTEGER NOT NULL); INSERT INTO spatial_schema VALUES(2)');db.close();
  assert.throws(()=>new SpatialLongTermStore(root),/preserved without migration/);
  const check=new DatabaseSync(join(root,'spatial.sqlite'));try{assert.deepEqual(check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name),['spatial_schema']);assert.equal(check.prepare('SELECT version FROM spatial_schema').get()!.version,2);}finally{check.close();}
 }finally{await rm(root,{recursive:true,force:true});}
});

test('add organizes a place by visits and time, deduplicates exact notes and rolls back organization with state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/place-add-'));let now=100;const store=new SpatialLongTermStore(root,()=>now);
 const checkpoint=(s:StoredState):WorkingContext=>({current:{id:s.observationId,atMs:s.atMs},location:s.assessment.location,recent:[s],anchors:[],retrieved:[]});
 const add=(id:string,placeId:string|null,text:string):Assessment=>({location:{status:placeId?'known':'new',placeId,name:'corner',reason:'visible layout',sourceIds:[id]},hypotheses:[],unresolved:[],relations:[],memoryNotes:[{text,sourceIds:[id]}]});
 try{
  for(const [i,id] of ['a','b','c','d','e'].entries()){store.archive({id,atMs:i*2000,views:[]});store.saveFacts(id,{summary:'fact '+id,details:['detail '+id]});}
  const a=store.add(store.observation('a')!,add('a',null,'red awning'),checkpoint),placeId=a.assessment.location.placeId!;
  now=200;const b=store.add(store.observation('b')!,add('b',placeId,'red awning'),checkpoint);
  assert.equal(a.memoryReceipt!.createdPlace,true);assert.equal(a.memoryReceipt!.notesAdded,1);assert.equal(b.memoryReceipt!.notesAdded,0);assert.equal(b.visitId,a.visitId);
  const early=store.placeMemory(placeId,1)!;assert.equal(early.notes.length,1);assert.equal(early.notes[0]!.sources.length,1);assert.equal(early.totalWindows,1);
  let memory=store.placeMemory(placeId,2)!;assert.equal(memory.visits.length,1);assert.deepEqual(memory.visits[0]!.windows.map(w=>w.observationId),['a','b']);assert.equal(memory.notes.length,1);assert.equal(memory.notes[0]!.sources.length,2);assert.equal(memory.originalMembership.length,2);
  now=300;store.add(store.observation('c')!,add('c',null,'different corner'),checkpoint);
  now=400;const d=store.add(store.observation('d')!,add('d',placeId,'green bin'),checkpoint);assert.notEqual(d.visitId,a.visitId);
  memory=store.placeMemory(placeId)!;assert.equal(memory.visits.length,2);assert.deepEqual(memory.visits.map(v=>v.windows.map(w=>w.observationId)),[['a','b'],['d']]);assert.equal(memory.notes.length,2);assert.equal(store.placeMemory(placeId,4,150)!.totalWindows,1);
  const causal=store.placeMemory(placeId,4,Number.MAX_SAFE_INTEGER,0,0,1000)!;assert.equal(causal.totalWindows,1);assert.equal(causal.notes.length,1);assert.equal(causal.notes[0]!.sources.length,1);assert.equal(causal.originalMembership.length,1);
  assert.throws(()=>store.add(store.observation('e')!,add('e',placeId,'must rollback'),()=>{throw Error('checkpoint failed');}),/checkpoint failed/);
  assert.equal(store.version(),4);assert.equal(store.placeMemory(placeId)!.notes.length,2);assert.equal(store.placeMemory(placeId)!.originalMembership.length,3);
  const invalid=add('e',placeId,'unseen');invalid.memoryNotes![0]!.sourceIds=['a'];assert.throws(()=>validateAssessment(invalid,'e',new Set(['e'])),/original evidence/);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});

test('place organization projects revisions without rewriting original membership or assigning unknown sources',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/place-revision-')),store=new SpatialLongTermStore(root);
 const checkpoint=(s:StoredState):WorkingContext=>({current:{id:s.observationId,atMs:s.atMs},location:s.assessment.location,recent:[s],anchors:[],retrieved:[]});
 const assessment=(id:string,status:'new'|'unknown'='new'):Assessment=>({location:{status,placeId:null,name:status==='new'?'region':'unknown',reason:'evidence',sourceIds:[id]},hypotheses:[],unresolved:[],relations:[]});
 try{
  for(const [i,id] of ['a','b','c'].entries()){store.archive({id,atMs:i*2000,views:[]});store.saveFacts(id,{summary:'fact '+id,details:['detail']});}
  const a=store.add(store.observation('a')!,assessment('a'),checkpoint),aId=a.assessment.location.placeId!;
  const b=store.add(store.observation('b')!,assessment('b'),checkpoint),bId=b.assessment.location.placeId!;
  const correction=assessment('c','unknown');correction.revisions=[{observationId:'a',location:{status:'known',placeId:bId,name:'region',reason:'checked both originals',sourceIds:['a','b','c']}}];store.add(store.observation('c')!,correction,checkpoint);
  assert.equal(store.placeMemory(aId,1)!.totalWindows,1);assert.equal(store.placeMemory(aId,3)!.totalWindows,0);assert.equal(store.placeMemory(aId,3)!.originalMembership.length,1);
  const projected=store.placeMemory(bId,3)!;assert.equal(projected.totalWindows,2);assert.equal(projected.originalMembership.length,1);assert.ok(projected.visits.some(v=>v.visitId===null));assert.ok(projected.visits.every(v=>v.windows.every(w=>w.observationId!=='c')));
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});
