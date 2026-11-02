import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {OrganizedExperienceMemory,proposeExperienceBoundaries,type ExperienceFact} from './organized-experience-memory.js';
const fact=(n:number,text='地下地铁站台右侧沿墙排列木质长椅'):ExperienceFact=>({memoryRef:`memory-v${n+1}`,observationId:`o${n}`,atMs:n*1000,sourceAtMs:n*1000,availableAtMs:100+n,recordingId:'recording',text,views:[{direction:'front',path:`image-${n}.png`,sha256:'a'.repeat(64)}],rawResultJSON:JSON.stringify({summary:text})});
const cutoff={eventAtMs:10000,knownAtMs:1000};
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'opencode/organized-'));return {dir,path:join(dir,'memory.sqlite'),cleanup:()=>rm(dir,{recursive:true,force:true})};}

test('facts persist unchanged, duplicate ingestion is idempotent and late extraction respects knowledge time',async()=>{
 const f=await fixture();let memory=new OrganizedExperienceMemory(f.path);
 try{
  memory.append(fact(0));memory.append(fact(2));memory.append({...fact(1),availableAtMs:500});memory.append(fact(0));
  assert.deepEqual(memory.facts({eventAtMs:2000,knownAtMs:200}).map(f=>f.observationId),['o0','o2']);
  assert.deepEqual(memory.facts(cutoff).map(f=>f.observationId),['o0','o1','o2']);
  assert.throws(()=>memory.append({...fact(0),text:'changed'}),/Immutable/);
  memory.close();memory=new OrganizedExperienceMemory(f.path,true);assert.equal(memory.facts(cutoff).length,3);assert.throws(()=>memory.append(fact(3)),/cannot write/);
 }finally{memory.close();await f.cleanup();}
});

test('revisions never leak retrospective boundaries into an earlier knowledge or event prefix',async()=>{
 const f=await fixture(),m=new OrganizedExperienceMemory(f.path);
 try{
  for(let i=0;i<4;i++)m.append(fact(i));
  const boundary={id:'b',beforeObservationId:'o2',source:'automatic' as const,reason:'candidate change',frames:['image-2.png','image-3.png']};
  m.revise({knownAtMs:200,evidenceUntilMs:3000,boundaries:[boundary],claims:[],reason:'three-frame support available'});
  assert.equal(m.view({eventAtMs:3000,knownAtMs:150}).episodes.length,1);
  assert.equal(m.view({eventAtMs:1000,knownAtMs:300}).episodes.length,1);
  const prior=m.view({eventAtMs:3000,knownAtMs:250});assert.equal(prior.episodes.length,2);
  m.revise({knownAtMs:300,evidenceUntilMs:3000,boundaries:[],claims:[],reason:'retract uncertain boundary'});
  assert.equal(m.view({eventAtMs:3000,knownAtMs:350}).episodes.length,1);
  assert.equal(m.view({eventAtMs:3000,knownAtMs:250}).episodes.length,2);
  assert.throws(()=>m.retrieveFacts(prior.episodes[0]!.episodeRef,'座位',{eventAtMs:3000,knownAtMs:350}),/stale/);
  assert.equal(m.facts(cutoff)[0]!.text,fact(0).text);
 }finally{m.close();await f.cleanup();}
});

test('different visits keep chronological episodes, identity claims remain separate and oracle boundaries fail',async()=>{
 const f=await fixture(),m=new OrganizedExperienceMemory(f.path);
 try{
  for(let i=0;i<4;i++)m.append(fact(i,'店内绿色桌面与木质柜台'));
  m.revise({knownAtMs:200,evidenceUntilMs:3000,boundaries:[{id:'return',beforeObservationId:'o2',source:'automatic',reason:'new visit candidate',frames:['image-2.png']}],claims:[{id:'possible-same',kind:'relation',predicate:'same-instance',subject:'first-context',object:'return-context',factRefs:['memory-v1','memory-v3'],status:'candidate'}],reason:'independent temporal and identity interpretations'});
  const view=m.view(cutoff);assert.equal(view.episodes.length,2);assert.ok(view.episodes.every(e=>e.placeIdentity===null));assert.equal(view.claims[0]!.status,'candidate');
  assert.throws(()=>m.revise({knownAtMs:300,evidenceUntilMs:3000,boundaries:[{id:'oracle',beforeObservationId:'o2',source:'manual-oracle',reason:'GT',frames:['image-2.png']}],claims:[],reason:'invalid'}),/Oracle/);
 }finally{m.close();await f.cleanup();}
});

test('locate respects earliest matching evidence instead of a later more keyword-heavy bench',async()=>{
 const f=await fixture(),m=new OrganizedExperienceMemory(f.path);
 try{
  m.append(fact(0,'地下车站站台，沿墙木质长椅'));
  m.append(fact(1,'街边公交站候车亭，座位长椅，等车休息'));
  const result=m.locate({text:'最开始等车的座位',order:'earliest'},cutoff);
  assert.equal(result.candidates[0]!.matchStartMs,0);assert.equal(result.candidates[0]!.evidence[0]!.memoryRef,'memory-v1');
  assert.ok(result.candidates[0]!.unresolved.some(s=>s.includes('not proof')));
  assert.equal(m.events('enter-shop',cutoff).coverageComplete,false);
 }finally{m.close();await f.cleanup();}
});

test('events require known evidence and temporal order does not silently certify complete visit coverage',async()=>{
 const f=await fixture(),m=new OrganizedExperienceMemory(f.path);
 try{
  m.append(fact(0));m.append(fact(1));
  assert.throws(()=>m.revise({knownAtMs:200,evidenceUntilMs:1000,boundaries:[],claims:[{id:'e',kind:'event',predicate:'enter-shop',subject:'candidate-shop',object:null,status:'supported',factRefs:['unknown']}],reason:'bad refs'}),/known source/);
  m.revise({knownAtMs:200,evidenceUntilMs:1000,boundaries:[],claims:[{id:'e',kind:'event',predicate:'enter-shop',subject:'candidate-shop',object:null,status:'supported',factRefs:['memory-v2']}],reason:'source-supported organizer event'});
  const events=m.events('enter-shop',cutoff);assert.equal(events.events.length,1);assert.equal(events.unknownEventsPossible,true);
 }finally{m.close();await f.cleanup();}
});

test('description change proposals require sustained evidence, not one frame or elapsed fixed buckets',()=>{
 const rows=[fact(0,'alpha platform benches rails tickets underground lamps columns'),fact(1,'alpha platform benches rails tickets underground lamps columns'),fact(2,'alpha platform benches rails tickets underground lamps columns'),fact(3,'theta laundry spinning cylinders machines dryers tubs storefront bulbs'),fact(4,'theta laundry spinning cylinders machines dryers tubs storefront bulbs'),fact(5,'theta laundry spinning cylinders machines dryers tubs storefront bulbs')];
 assert.equal(proposeExperienceBoundaries(rows.slice(0,4)).length,0);
 const p=proposeExperienceBoundaries(rows);assert.equal(p.length,1);assert.equal(p[0]!.boundary.beforeObservationId,'o3');assert.equal(p[0]!.evidenceUntilMs,5000);assert.equal(p[0]!.knownAtMs,105);
});

test('shared functional context avoids splitting only for camera-dependent wording, without creating identity claims',()=>{
 const rows=[fact(0,'地下地铁站台蓝柱、灰砖、灯管、海报和轨道边缘'),fact(1,'地下地铁站台蓝柱、灰砖、灯管、海报和轨道边缘'),fact(2,'地下地铁站台蓝柱、灰砖、灯管、海报和轨道边缘'),
  fact(3,'地下地铁站台木椅、垃圾桶、广告、黄色边线和黑暗区域'),fact(4,'地下地铁站台木椅、垃圾桶、广告、黄色边线和黑暗区域'),fact(5,'地下地铁站台木椅、垃圾桶、广告、黄色边线和黑暗区域')];
 assert.equal(proposeExperienceBoundaries(rows).length,0);
});

test('incremental reconciliation preserves revisions, retries idempotently and rejects partial history atomically',async()=>{
 const f=await fixture();let m=new OrganizedExperienceMemory(f.path);
 try{
  assert.equal(m.synchronize([fact(0),fact(2)]).added,2);
  const old=m.view({eventAtMs:3000,knownAtMs:102});
  assert.equal(m.synchronize([fact(0),fact(2)]).revision,old.revision);
  m.close();m=new OrganizedExperienceMemory(f.path);
  assert.equal(m.synchronize([fact(0),{...fact(1),availableAtMs:500},fact(2)]).added,1);
  assert.equal(m.view({eventAtMs:3000,knownAtMs:102}).revision,old.revision);
  assert.equal(m.view(cutoff).facts.length,3);
  assert.throws(()=>m.synchronize([fact(0),fact(3)]),/forget/);
  assert.equal(m.view(cutoff).facts.length,3);
  assert.throws(()=>m.synchronize([fact(0),{...fact(1),availableAtMs:500},fact(2),{...fact(3),text:''}]),/Invalid/);
  assert.equal(m.view(cutoff).facts.length,3);
 }finally{m.close();await f.cleanup();}
});

test('generic shop noun retrieves shop candidates even when temporal question wording is absent from descriptions',async()=>{
 const f=await fixture(),m=new OrganizedExperienceMemory(f.path);
 try{
  m.append(fact(0,'地下地铁站台木椅'));
  m.append(fact(1,'店内有木质柜台与墙上公告板'));
  const result=m.locate({text:'出地铁后进去的第二家店',order:'earliest'},cutoff);
  assert.ok(result.candidates.flatMap(c=>c.evidence).some(e=>e.memoryRef==='memory-v2'));
  assert.equal(m.events('enter-shop',cutoff).events.length,0);
 }finally{m.close();await f.cleanup();}
});

test('sequence expands source-backed context across candidate cuts without certifying entry or crossing a recording gap',async()=>{
 const f=await fixture(),m=new OrganizedExperienceMemory(f.path);
 try{
  m.append(fact(0,'店铺外墙有招牌'));
  m.append(fact(1,'店内柜台后墙有公告板'));
  m.append({...fact(2,'另一段记录的房间'),recordingId:'other'});
  m.revise({knownAtMs:200,evidenceUntilMs:2000,boundaries:[{id:'b',beforeObservationId:'o1',source:'automatic',reason:'candidate',frames:['image-1.png']}],claims:[],reason:'candidate context'});
  const first=m.view(cutoff).episodes[0]!;
  const expanded=m.sequence(first.episodeRef,cutoff);
  assert.equal(expanded.candidates.length,2);
  assert.ok(expanded.candidates[1]!.evidence.some(e=>e.text.includes('公告板')));
  assert.equal(expanded.confirmedEntry,false);assert.equal(expanded.confirmedSamePlace,false);
  assert.ok(expanded.candidates.every(c=>c.evidence.every(e=>e.observationId!=='o2')));
  assert.throws(()=>m.sequence('invented',cutoff),/Unknown/);
 }finally{m.close();await f.cleanup();}
});
