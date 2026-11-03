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
