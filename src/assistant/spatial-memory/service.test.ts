import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {SpatialMemoryService} from './service.js';
import {SpatialQuestionView} from './question-view.js';
import {SpatialOutputProtocolError} from '../../agent/spatial-protocol-retry.js';
import {projectSpatialContext} from './context-projection.js';
import {SpatialLongTermStore} from './long-term-store.js';
import {SpatialWorkingMemory} from './working-context.js';
import type {Observation,SpatialModels,SpatialAction,Assessment,SpatialReasoner,StoredState} from './contracts.js';

async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-rewrite-'));await mkdir(join(dir,'sources'));
 const row=async(id:string,atMs:number):Promise<Observation>=>({id,atMs,recordingId:'recording',views:await Promise.all(['front','left','right'].map(async direction=>{const bytes=Buffer.from(id+direction),path=join(dir,'sources',id+'-'+direction+'.png');await writeFile(path,bytes);return {id,direction,path,sha256:createHash('sha256').update(bytes).digest('hex')};}))});
 return {dir,row,root:join(dir,'new-spatial'),cleanup:()=>rm(dir,{recursive:true,force:true})};
}
const assessment=(id:string,status:'new'|'known'|'unknown'='new',placeId:string|null=null,sourceIds=[id]):Assessment=>({location:{status,placeId,name:status==='unknown'?'无法确定':'区域'+id,reason:'独立当前布局与实际交付来源',sourceIds,...status==='new'?{regionChangeEvidence:['脚本模型声明的当前区域变化证据']}:{ }},hypotheses:[],unresolved:[],relations:[]});
const commit=(a:Assessment):SpatialAction=>({kind:'commit',assessment:a});
const facts=(row:Observation)=>({summary:'当前观察'+row.id,details:['当前细节'+row.id]});

test('continuous views reuse identity; unsupported NEW is rejected and uncertainty stays provisional, not inherited truth',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,firstPlace:string|null=null,rejected=0;
 const reasoner:SpatialReasoner={async judge(input){
  let a:Assessment;
  if(input.row.id==='t3')a=assessment(input.row.id);
  else{
   assert.ok(input.previousRegion);firstPlace??=input.previousRegion!.placeId;
   if(input.row.id==='t7'){
    const bad=assessment(input.row.id);delete bad.location.regionChangeEvidence;
    await assert.rejects(input.commit(bad,{inspected:new Set([input.row.id]),delivered:new Set()}),/positive regionChangeEvidence/);rejected++;
    a=assessment(input.row.id,'known',firstPlace);a.location.contextRefs=['t3'];
   }else if(input.row.id==='t11'){
    a=assessment(input.row.id,'unknown');a.location.continuityCandidate={placeId:firstPlace,referenceId:'t7',reason:'部分遮挡，未见新的区域边界，仅暂定延续'};
   }else if(input.row.id==='t15'){
    assert.equal(input.previousRegion!.uncertain,true);a=assessment(input.row.id,'known',firstPlace);a.location.contextRefs=['t7'];
   }else if(input.row.id==='t19'){a=assessment(input.row.id);}
   else{a=assessment(input.row.id,'known',firstPlace);a.location.contextRefs=['t15'];}
  }
  await input.commit(a,{inspected:new Set([input.row.id]),delivered:new Set()});return a;
 },async close(){}};
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(row){return facts(row);}},{windowMs:8000,reasoner});
  for(let i=0;i<24;i++)await service.observe(await f.row('t'+i,i*2000));await service.finishInput();
  assert.equal(rejected,1);assert.equal(service.progress().places,2);assert.equal(service.progress().spatialStates,6);
  const uncertain=service.snapshotAt(3,Number.MAX_SAFE_INTEGER).state;assert.equal(uncertain.assessment.location.status,'unknown');assert.equal(uncertain.assessment.location.placeId,null);assert.equal(uncertain.assessment.location.continuityCandidate!.placeId,firstPlace);assert.equal(uncertain.visitId,null);
  assert.equal(service.progress().visits,3);assert.equal(uncertain.provisionalVisitId,service.snapshotAt(2,Number.MAX_SAFE_INTEGER).state.visitId);assert.equal(service.snapshotAt(4,Number.MAX_SAFE_INTEGER).state.visitId,uncertain.provisionalVisitId);assert.notEqual(service.latest()!.state.visitId,uncertain.provisionalVisitId);
  const visits=service.snapshotAt(4,Number.MAX_SAFE_INTEGER).visits;assert.equal(visits.length,1);assert.deepEqual(visits[0]!.provisionalObservationIds,['t11']);assert.ok(!visits[0]!.observationIds.includes('t11'));
  assert.equal(service.latest()!.state.assessment.location.placeId,firstPlace);
 }finally{await service?.close().catch(()=>{});await f.cleanup();}
});

test('continuity candidate cannot jump a recording boundary or a source-time gap',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,first:string|null=null;
 const reasoner:SpatialReasoner={async judge(input){
  if(!first){const s=await input.commit(assessment(input.row.id),{inspected:new Set([input.row.id]),delivered:new Set()});first=s.assessment.location.placeId;return s.assessment;}
  assert.equal(input.previousRegion,undefined);
  const bad=assessment(input.row.id,'unknown');bad.location.continuityCandidate={placeId:first,referenceId:'g3',reason:'仅因之前在这里'};
  await assert.rejects(input.commit(bad,{inspected:new Set([input.row.id]),delivered:new Set()}),/adjacent same-recording/);
  const a=assessment(input.row.id,'unknown');await input.commit(a,{inspected:new Set([input.row.id]),delivered:new Set()});return a;
 },async close(){}};
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(row){return facts(row);}},{windowMs:8000,reasoner});
  for(let i=0;i<4;i++)await service.observe(await f.row('g'+i,i*2000));await service.finishInput();
  for(let i=0;i<4;i++){const row=await f.row('h'+i,16000+i*2000);row.recordingId='other-recording';await service.observe(row);}await service.finishInput();assert.equal(service.progress().places,1);
 }finally{await service?.close().catch(()=>{});await f.cleanup();}
});

test('missing tail facts cannot block the next window; late facts append revisions without changing old snapshots',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,release!:()=>void,second!:()=>void,calls=0;
 const blocked=new Promise<void>(r=>release=r),secondCommitted=new Promise<void>(r=>second=r);
 const reasoner:SpatialReasoner={async judge(input){
  calls++;const missing=input.window!.missingFactIds??[],old=input.context.recent.find(r=>r.observationId===input.row.id);
  if(input.row.id==='n7'&&input.window!.revisionOfVersion)assert.equal(input.previousRegion?.observationId,'n3');
  const a=missing.includes(input.row.id)?assessment(input.row.id,'unknown'):old?.assessment.location.placeId?assessment(input.row.id,'known',old.assessment.location.placeId):assessment(input.row.id);
  if(a.location.status==='known')a.location.contextRefs=[input.row.id];
  await input.commit(a,{inspected:new Set(input.window!.observations.map(o=>o.id)),delivered:new Set()});if(input.row.id==='n7'&&!input.window!.revisionOfVersion)second();return a;
 },async close(){}};
 try{
   service=await SpatialMemoryService.create(f.root,{async perceive(row){if(row.id==='n3')await blocked;return facts(row);}},{windowMs:8000,evidencePolicy:'deadline',evidenceWaitMs:5,extractionConcurrency:8,reasoner});
  for(let i=0;i<8;i++)await service.observe(await f.row('n'+i,i*2000));
  await Promise.race([secondCommitted,new Promise((_,reject)=>setTimeout(()=>reject(Error('Next window was blocked')),2000))]);
  assert.equal(service.latest()!.state.observationId,'n7');assert.equal(service.progress().incompleteWindows,1);assert.ok(service.progress().admitted<=12);
  const early=service.snapshotAt(1,Number.MAX_SAFE_INTEGER);assert.equal(early.state.facts,null);assert.deepEqual(early.state.window!.missingFactIds,['n3']);
  release();await service.finishInput();assert.equal(service.progress().spatialStates,2);assert.equal(service.progress().stateVersions,4);assert.equal(service.progress().incompleteWindows,0);assert.equal(service.progress().missingFacts,0);assert.equal(calls,4);assert.equal(service.latest()!.state.observationId,'n7');assert.equal(service.latest()!.state.atMs,14000);
  assert.equal(service.snapshotAt(1,Number.MAX_SAFE_INTEGER).state.facts,null);assert.equal(service.snapshotAt(4,Number.MAX_SAFE_INTEGER).history[0]!.window!.observations[3]!.facts!.summary,'当前观察n3');
 }finally{release();await service?.close().catch(()=>{});await f.cleanup();}
});

test('production batch perception uses one worker, not two per-observation lanes, while space can overlap preparation',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,active=0,peak=0,batches=0,spaceStarted!:()=>void,prepared!:()=>void;
 const firstSpace=new Promise<void>(r=>spaceStarted=r),secondPrepared=new Promise<void>(r=>prepared=r);
 const reasoner:SpatialReasoner={async judge(input){if(input.row.id==='b3'){spaceStarted();await secondPrepared;}const a=assessment(input.row.id);await input.commit(a,{inspected:new Set([input.row.id]),delivered:new Set()});return a;},async close(){}};
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(){throw Error('Per-observation lane must not run');},async perceiveWindow(rows){active++;peak=Math.max(peak,active);batches++;if(batches===2){await firstSpace;prepared();}active--;return rows.map(row=>({id:row.id,facts:facts(row)}));}},{windowMs:8000,reasoner});
  for(let i=0;i<8;i++)await service.observe(await f.row('b'+i,i*2000));await service.finishInput();assert.equal(batches,2);assert.equal(peak,1);assert.equal(service.progress().coveredObservations,8);
 }finally{spaceStarted();prepared();await service?.close().catch(()=>{});await f.cleanup();}
});

test('busy latest policy skips obsolete calls, delivers their facts to the successor and never claims full judgment coverage',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,started!:()=>void,release!:()=>void,calls=0;
 const firstStarted=new Promise<void>(r=>started=r),blocked=new Promise<void>(r=>release=r);
 const reasoner:SpatialReasoner={async judge(input){
  calls++;
  if(input.row.id==='s3'){started();await blocked;}
  else{assert.equal(input.row.id,'s11');assert.equal(input.window!.skippedBefore!.length,1);assert.deepEqual(input.window!.skippedBefore![0]!.observations.map(o=>o.id),['s4','s5','s6','s7']);assert.ok(input.window!.skippedBefore![0]!.observations.every(o=>o.facts));assert.equal(input.windowViews!.length,12);assert.equal(service!.progress().deferredObservations,4);assert.equal((await input.inspect(['s4'])).length,3);await assert.rejects(input.inspect(['not-delivered']),/outside/);}
  const a=input.row.id==='s3'?assessment(input.row.id):assessment(input.row.id,'known',input.context.recent[0]!.assessment.location.placeId!,[input.row.id]);
  if(input.row.id!=='s3')a.location.contextRefs=['s3'];
  await input.commit(a,{inspected:new Set(input.window!.observations.map(o=>o.id)),delivered:new Set()});return a;
 },async close(){}};
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(r){return facts(r);}},{windowMs:8000,extractionConcurrency:1,maxPending:12,busyPolicy:'skip-obsolete',reasoner});
  for(let i=0;i<4;i++)await service.observe(await f.row('s'+i,i*2000));await firstStarted;
  for(let i=4;i<12;i++)await service.observe(await f.row('s'+i,i*2000));
  await assert.rejects(service.observe(await f.row('overflow',24000)),/backpressure/);
  release();await service.finishInput();
  const p=service.progress();assert.equal(calls,2);assert.equal(p.observations,12);assert.equal(p.spatialStates,2);assert.equal(p.skippedWindows,1);assert.equal(p.skippedObservations,4);assert.equal(p.coveredObservations,8);assert.equal(p.deferredObservations,0);assert.equal(p.admitted,0);assert.equal(p.pending,0);assert.equal(service.latest()!.state.observationId,'s11');
  assert.equal(service.snapshotAt(2,Number.MAX_SAFE_INTEGER).state.window!.skippedBefore![0]!.reason,'busy-superseded');
  assert.equal((await service.reader().inspectAt(2,Number.MAX_SAFE_INTEGER,['s4'])).length,3);
  const organized=service.reader().placeAt(2,Number.MAX_SAFE_INTEGER,service.latest()!.state.assessment.location.placeId!)!;
  assert.equal(organized.totalWindows,2);assert.deepEqual(organized.unassignedSkippedSourceIds,['s4','s5','s6','s7']);assert.equal(organized.visits.flatMap(v=>v.windows).flatMap(w=>w.window!.observations).length,8);
 }finally{release();await service?.close().catch(()=>{});await f.cleanup();}
});

test('partial batch extraction keeps valid sources and bounded feedback requests only the missing originals',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,calls=0;
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(){throw Error('No per-observation lane');},async perceiveWindow(rows,feedback){calls++;if(calls===1)return [{id:rows[0]!.id,facts:facts(rows[0]!)}];assert.deepEqual(rows.map(r=>r.id),['q1','q2','q3']);assert.match(feedback??'',/q3/);return rows.map(r=>({id:r.id,facts:facts(r)}));}},{windowMs:8000,reasoner:{async judge(input){const a=assessment(input.row.id);await input.commit(a,{inspected:new Set([input.row.id]),delivered:new Set()});return a;},async close(){}}});
  for(let i=0;i<4;i++)await service.observe(await f.row('q'+i,i*2000));await service.finishInput();assert.equal(calls,2);assert.equal(service.progress().missingFacts,0);assert.equal(service.progress().incompleteWindows,0);assert.equal(service.latest()!.state.window!.observations[0]!.facts!.summary,'当前观察q0');
 }finally{await service?.close().catch(()=>{});await f.cleanup();}
});

test('progressive partial extraction gets one additional bounded feedback round instead of discarding the remaining tail',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,calls=0;const requested:string[][]=[];
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(){throw Error('No per-observation lane');},async perceiveWindow(rows,feedback){calls++;requested.push(rows.map(r=>r.id));if(calls>1)assert.match(feedback??'',/remaining source/);if(calls===1)return [{id:rows[0]!.id,facts:facts(rows[0]!)}];if(calls===2)return [{id:rows[0]!.id,facts:facts(rows[0]!)}];return rows.map(r=>({id:r.id,facts:facts(r)}));}},{windowMs:8000,reasoner:{async judge(input){const a=assessment(input.row.id);await input.commit(a,{inspected:new Set([input.row.id]),delivered:new Set()});return a;},async close(){}}});
  for(let i=0;i<4;i++)await service.observe(await f.row('n'+i,i*2000));await service.finishInput();
  assert.equal(calls,3);assert.deepEqual(requested,[['n0','n1','n2','n3'],['n1','n2','n3'],['n2','n3']]);assert.equal(service.progress().missingFacts,0);assert.equal(service.progress().incompleteWindows,0);
 }finally{await service?.close().catch(()=>{});await f.cleanup();}
});

test('recovery retains skipped facts and capacity until the successor commits without inventing old locations',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,calls=0;
 const store=new SpatialLongTermStore(f.root),rows=await Promise.all(Array.from({length:8},(_,i)=>f.row('r'+i,i*2000)));
 for(const row of rows){store.archive(row);store.saveFacts(row.id,facts(row));}store.skipWindow(rows.slice(0,4));store.close();
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(){throw Error('Durable facts must be reused');}},{resume:true,windowMs:8000,maxPending:12,busyPolicy:'skip-obsolete',reasoner:{async judge(input){calls++;assert.equal(input.window!.skippedBefore![0]!.observations[0]!.id,'r0');const a=assessment(input.row.id);await input.commit(a,{inspected:new Set(input.window!.observations.map(o=>o.id)),delivered:new Set()});return a;},async close(){}}});
  assert.equal(service.progress().admitted,8);assert.equal(service.progress().deferredObservations,4);
  await service.resumePending();await service.finishInput();assert.equal(calls,1);assert.equal(service.progress().admitted,0);assert.equal(service.progress().spatialStates,1);assert.equal(service.progress().coveredObservations,4);assert.equal(service.progress().skippedObservations,4);assert.equal(service.progress().deferredObservations,0);
 }finally{await service?.close().catch(()=>{});await f.cleanup();}
});

test('persistent one-at-a-time extraction keeps valid facts and stops after the third bounded feedback',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,calls=0;
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(){throw Error('No per-observation lane');},async perceiveWindow(rows){calls++;return [{id:rows[0]!.id,facts:facts(rows[0]!)}];}},{windowMs:8000,reasoner:{async judge(input){const a=assessment(input.row.id,'unknown');await input.commit(a,{inspected:new Set([input.row.id]),delivered:new Set()});return a;},async close(){}}});
   for(let i=0;i<4;i++)await service.observe(await f.row('z'+i,i*2000));await assert.rejects(service.finishInput(),/Independent window facts unavailable/);assert.equal(calls,3);assert.equal(service.progress().missingFacts,1);assert.equal(service.progress().spatialStates,0);assert.equal(service.progress().coveredObservations,0);assert.equal(service.progress().observations,4);
 }finally{await service?.close().catch(()=>{});await f.cleanup();}
});

test('recovery resumes durable incomplete windows instead of treating coverage as completion',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,extractions=0;const rows=await Promise.all(Array.from({length:4},(_,i)=>f.row('p'+i,i*2000)));
 const store=new SpatialLongTermStore(f.root);for(const row of rows)store.archive(row);for(const row of rows.slice(0,3))store.saveFacts(row.id,facts(row));
 const working=new SpatialWorkingMemory();working.begin(rows[3]!);
 store.commit(rows[3]!,assessment('p3','unknown'),s=>{working.commit(s);return working.view();},{startMs:0,endExclusiveMs:8000,observations:rows.map(r=>({id:r.id,atMs:r.atMs,facts:store.facts(r.id)})),missingFactIds:['p3']});store.close();
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(row){extractions++;return facts(row);}},{resume:true,windowMs:8000,reasoner:{async judge(input){const a=assessment(input.row.id);await input.commit(a,{inspected:new Set([input.row.id]),delivered:new Set()});return a;},async close(){}}});
  await service.resumePending();await service.finishInput();assert.equal(extractions,1);assert.equal(service.progress().incompleteWindows,0);assert.equal(service.progress().stateVersions,2);assert.equal(service.progress().admitted,0);assert.equal(service.snapshotAt(1,Number.MAX_SAFE_INTEGER).state.facts,null);
 }finally{await service?.close().catch(()=>{});await f.cleanup();}
});

test('8-second windows commit one durable judgment with four immutable members, not four invented locations',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,calls=0;
 const reasoner:SpatialReasoner={async judge(input){calls++;assert.equal(input.window!.observations.length,4);assert.equal(input.windowViews!.length,12);assert.equal(input.context.location,null);const a=assessment(input.row.id);if(calls===2){a.location.status='unknown';a.location.name='甲乙边界';a.location.boundary={regions:['甲','乙']};}await input.commit(a,{inspected:new Set(input.window!.observations.map(o=>o.id)),delivered:new Set()});return a;},async close(){}};
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(r){return facts(r);}},{reasoner,windowMs:8000,maxPending:12,now:()=>50000});
  for(let i=0;i<8;i++)await service.observe(await f.row('w'+i,i*2000));
  const p=await service.finishInput();assert.equal(calls,2);assert.equal(p.observations,8);assert.equal(p.spatialStates,2);assert.equal(p.coveredObservations,8);assert.equal(p.pending,0);assert.equal(service.progress().admitted,0);
   const first=service.snapshotAt(1,50000);assert.deepEqual(first.state.window!.observations.map(o=>o.id),['w0','w1','w2','w3']);assert.equal(first.history.length,1);assert.equal(first.history[0]!.window!.observations[0]!.facts!.summary,'当前观察w0');assert.throws(()=>service!.snapshotAt(1,6000),/not yet available/);
  assert.equal(service.latest()!.state.assessment.location.boundary!.regions.length,2);assert.equal(service.latest()!.state.visitId,null);
  const question=SpatialQuestionView.open(service.reader(),1,50000);await assert.rejects(question.inspect(['w0']),/delivered/);question.timeline();assert.equal((await question.inspect(['w0'])).images.length,3);assert.equal(question.read(['w0'])[0]!.window!.observations.length,4);
  const db=new DatabaseSync(join(f.root,'spatial.sqlite'),{readOnly:true});try{assert.equal((db.prepare('SELECT COUNT(*) AS n FROM window_members').get() as any).n,8);assert.equal((db.prepare('SELECT COUNT(*) AS n FROM checkpoint_bindings').get() as any).n,2);}finally{db.close();}
 }finally{await service?.close();await f.cleanup();}
});

test('admission capacity rejects excess callers before archiving and is released after bounded batch completion',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,release!:()=>void;const blocked=new Promise<void>(r=>release=r);
 const reasoner:SpatialReasoner={async judge(input){await blocked;const a=assessment(input.row.id);await input.commit(a,{inspected:new Set([input.row.id]),delivered:new Set()});return a;},async close(){}};
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(r){return facts(r);}},{reasoner,windowMs:8000,maxPending:4});
  const rows=await Promise.all(Array.from({length:5},(_,i)=>f.row('c'+i,i*2000)));
  const accepted=rows.slice(0,4).map(r=>service!.observe(r));
  await assert.rejects(service.observe(rows[4]!),/backpressure/);assert.equal(service.progress().admitted,4);
  await Promise.all(accepted);assert.equal(service.knows('c4'),false);release();await service.finishInput();
  await service.observe(rows[4]!);await service.finishInput();assert.equal(service.progress().coveredObservations,5);assert.equal(service.latest()!.state.window!.observations.length,1);
 }finally{release();await service?.close();await f.cleanup();}
});

test('automatic visual recall proposes an older place, excludes the previous place and supplies inspectable candidates',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,firstPlace:string|null=null,secondPlace:string|null=null,matcherCalls=0,checkedPrevious=false;
 const matcher={async match(current:any[],candidates:any[]){
  matcherCalls++;assert.ok(current.length>=3);assert.ok(candidates.length>0);assert.ok(candidates.every(c=>c.placeId!==secondPlace));
  const first=candidates.find(c=>c.placeId===firstPlace)!;assert.ok(first);
  return {ok:true,best:null,nearest:null,results:[{placeId:firstPlace!,observationId:first.image.id,path:first.image.path,queryPath:current[0].path,inliers:29,similarity:0.8}]};
 }};
 const reasoner:SpatialReasoner={async judge(input){
  if(!firstPlace){
   const state=await input.commit(assessment(input.row.id),{inspected:new Set([input.row.id]),delivered:new Set()});firstPlace=state.assessment.location.placeId;return state.assessment;
  }
  if(!secondPlace){
   const state=await input.commit(assessment(input.row.id),{inspected:new Set([input.row.id]),delivered:new Set()});secondPlace=state.assessment.location.placeId;
   assert.notEqual(secondPlace,firstPlace);return state.assessment;
  }
  assert.equal(input.revisit?.status,'ok');checkedPrevious=!!secondPlace;
  const candidate=input.revisit!.candidates[0]!;assert.equal(candidate.placeId,firstPlace);
  assert.ok(input.revisit!.candidates.every(c=>c.placeId!==secondPlace));
  await assert.rejects(input.commit(assessment(input.row.id,'new'),{inspected:new Set([input.row.id]),delivered:new Set()}),/Cannot submit a new place without inspecting/);
  const a=assessment(input.row.id,'known',firstPlace,[input.row.id,candidate.matchedObservationId]);
  a.location.contextRefs=[candidate.matchedObservationId];
  await input.commit(a,{inspected:new Set([input.row.id,candidate.matchedObservationId]),delivered:new Set()});return a;
 },async close(){}};
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(row){return facts(row);}},{windowMs:8000,reasoner,revisitMatcher:matcher,revisitPolicy:'required',revisitLimit:2});
  for(let i=0;i<12;i++)await service.observe(await f.row('v'+i,i*2000));await service.finishInput();
  assert.equal(matcherCalls,1);assert.equal(checkedPrevious,true);assert.equal(service.progress().places,2);assert.equal(service.progress().visits,3);
 }finally{await service?.close().catch(()=>{});await f.cleanup();}
});

test('required visual recall fails closed instead of silently creating a new place',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,first:string|null=null;
 const reasoner:SpatialReasoner={async judge(input){
  if(!first){const state=await input.commit(assessment(input.row.id),{inspected:new Set([input.row.id]),delivered:new Set()});first=state.assessment.location.placeId;return state.assessment;}
  const a=assessment(input.row.id,'new');await input.commit(a,{inspected:new Set([input.row.id]),delivered:new Set()});return a;
 },async close(){}};
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(row){return facts(row);}},{windowMs:8000,reasoner,revisitMatcher:{async match(){return {ok:false,best:null,nearest:null,results:[],error:'opencv unavailable'};}},revisitPolicy:'required'});
  for(let i=0;i<12;i++)await service.observe(await f.row('u'+i,i*2000));
  await assert.rejects(service.finishInput(),/Revisit candidate recall unavailable/);
  assert.equal(service.progress().places,2);
 }finally{await service?.close().catch(()=>{});await f.cleanup();}
});

test('a checkpoint failure after durable commit cannot trigger another model judgment',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,calls=0;
 const reasoner:SpatialReasoner={async judge(input){calls++;await input.commit(assessment(input.row.id),{inspected:new Set([input.row.id]),delivered:new Set()});throw Error('Pi journal disk failure');},async close(){}};
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(r){return facts(r);}},{reasoner});await service.observe(await f.row('a',0));
  await assert.rejects(service.finishInput(),/committed.*explicit recovery/);assert.equal(calls,1);assert.equal(service.progress().spatialStates,1);
 }finally{await service?.close().catch(()=>{});await f.cleanup();}
});

test('failed window preserves every observation and recovery resumes the same complete batch',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined;let extractions=0;
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(r){extractions++;return facts(r);}},{windowMs:8000,reasoner:{async judge(){throw Error('protocol failure');},async close(){}}});
  for(let i=0;i<4;i++)await service.observe(await f.row('r'+i,i*2000));await assert.rejects(service.finishInput(),/protocol failure/);assert.equal(service.progress().pending,4);assert.equal(service.progress().spatialStates,0);await service.close().catch(()=>{});
  service=await SpatialMemoryService.create(f.root,{async perceive(){throw Error('Do not re-extract');}},{resume:true,windowMs:8000,reasoner:{async judge(input){assert.equal(input.window!.observations.length,4);const a=assessment(input.row.id);await input.commit(a,{inspected:new Set([input.row.id]),delivered:new Set()});return a;},async close(){}}});
  await service.resumePending();await service.finishInput();assert.equal(extractions,4);assert.equal(service.progress().coveredObservations,4);
 }finally{await service?.close().catch(()=>{});await f.cleanup();}
});

test('window transaction rolls back membership, place and context together',async()=>{
 const f=await fixture(),store=new SpatialLongTermStore(f.root);
 try{const rows=await Promise.all([f.row('a',0),f.row('b',2000)]);for(const r of rows){store.archive(r);store.saveFacts(r.id,facts(r));}assert.throws(()=>store.commit(rows[1]!,assessment('b'),()=>{throw Error('context failure');},{startMs:0,endExclusiveMs:8000,observations:rows.map(r=>({id:r.id,atMs:r.atMs,facts:facts(r)}))}),/context failure/);assert.equal(store.counts().pending,2);assert.equal(store.counts().coveredObservations,0);assert.equal(store.counts().places,0);}finally{store.close();await f.cleanup();}
});

test('length-triggered working compression retains current state, unresolved and source recovery references',()=>{
 const working=new SpatialWorkingMemory();let original:StoredState|undefined;
 for(let i=0;i<7;i++){const row={id:'s'+i,atMs:i*2000,views:[]};working.begin(row);const a=assessment(row.id);a.unresolved=['需要进一步确认'];const s:StoredState={version:i+1,observationId:row.id,atMs:row.atMs,availableAtMs:99999,facts:{summary:'事实'.repeat(1000),details:Array(12).fill('细节'.repeat(500))},assessment:a,visitId:null};original=s;working.commit(s);}
  const view=working.view();assert.ok(view.summary?.policy.includes('extractive'));assert.ok(view.summary!.sourceIds.length);assert.equal(view.current.id,'s6');assert.deepEqual(view.unresolved,['需要进一步确认']);assert.ok(JSON.stringify(view).length<24000);assert.equal(original!.facts!.details.length,12);assert.equal(original!.facts!.summary.length,2000);
});

test('model context projection deduplicates anchors and separates historical decisions from current reasons',()=>{
 const shared:StoredState={version:2,observationId:'b',atMs:2000,availableAtMs:50000,facts:{summary:'事实b',details:['细节']},assessment:assessment('b','known','place-a',['b','a']),locationDecision:'known',visitId:'v1'};
 const context={current:{id:'c',atMs:4000},location:null,recent:[shared],anchors:[shared],retrieved:[],summary:{policy:'p',text:'t',sourceIds:['a'],throughAtMs:2000},unresolved:['待确认']};
 const projected=projectSpatialContext(context) as any;
 assert.equal(projected.recent.length,1);assert.equal(projected.anchors.length,0);assert.deepEqual(projected.anchorRefs,['b']);
 assert.equal(projected.recent[0].decisionAtThatTime,'known');assert.equal(projected.recent[0].assessment.location.placeId,'place-a');
 assert.equal(projected.recent[0].assessment.location.reason,undefined);assert.ok(projected.recent[0].historicalReason);
 assert.ok(JSON.stringify(projected).includes('historical-not-current'));assert.deepEqual(projected.unresolved,['待确认']);
 assert.equal(shared.assessment.location.reason,'独立当前布局与实际交付来源');
});

test('task timing reports delivery-to-commit latency, missing evidence and peak admission without changing semantics',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,time=1000;
 const reasoner:SpatialReasoner={async judge(input){time+=2500;const a=assessment(input.row.id);await input.commit(a,{inspected:new Set([input.row.id]),delivered:new Set()});return a;},async close(){}};
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(){throw Error('No per-observation lane');},async perceiveWindow(rows){time+=1000;return rows.map(r=>({id:r.id,facts:facts(r)}));}},{windowMs:8000,reasoner,now:()=>time});
  for(let i=0;i<4;i++){time+=2000;await service.observe(await f.row('k'+i,i*2000));}
  await service.finishInput();
  const timings=service.taskTimings();assert.equal(timings.length,1);
  const task=timings[0] as any;assert.deepEqual(task.observationIds,['k0','k1','k2','k3']);
  assert.equal(task.missingFactCount,0);assert.equal(task.perceptionCalls,1);
  assert.ok(task.oldestDeliveryToCommitMs>0);assert.ok(task.sealedToCommitMs>=0);assert.ok(task.tailDeliveryToCommitMs>=0);
  assert.equal(service.progress().peakAdmitted,4);assert.equal(service.progress().admitted,0);assert.equal(service.progress().backpressureRejections,0);
 }finally{await service?.close().catch(()=>{});await f.cleanup();}
});

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
  const f=await fixture();const store=new SpatialLongTermStore(f.root);try{const row=await f.row('a',0);store.archive(row);store.saveFacts('a',facts(row));assert.throws(()=>store.commit(row,assessment('a'),()=>{throw Error('checkpoint failure');}),/checkpoint failure/);assert.deepEqual(store.counts(),{observations:1,spatialStates:0,stateVersions:0,incompleteWindows:0,missingFacts:0,coveredObservations:0,places:0,visits:0,pending:1,skippedWindows:0,skippedObservations:0,deferredObservations:0});assert.equal(store.checkpoint(1),null);}finally{store.close();await f.cleanup();}
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
   assert.deepEqual(Object.keys(service.reader()).sort(),['inspectAt','latest','placeAt','snapshotAt']);
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

test('question view on the real service reads history and images without changing spatial memory',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined;
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(row){return facts(row);},async reason(input){return commit(assessment(input.current.id));}});
  await service.observe(await f.row('a',0));await service.observe(await f.row('b',1000));await service.finishInput();
  const before=service.progress(),view=SpatialQuestionView.open(service.reader(),2,Number.MAX_SAFE_INTEGER);
  assert.equal(view.summary().coverage.semanticCompleteness,false);assert.equal(view.currentLocation().status,'known');
  assert.equal(view.timeline().records.length,2);
  assert.equal(view.find(['当前观察a']).total,1);
  const images=await view.inspect(['a']);assert.equal(images.images.length,3);
  assert.deepEqual(service.progress(),before);
  const locked:any=view;assert.equal(typeof locked.commit,'undefined');assert.equal(typeof locked.close,'undefined');
 }finally{await service?.close();await f.cleanup();}
});

test('invalid model JSON is retried with bounded feedback; provider failures are not disguised as semantic retries',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,calls=0;
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(row){return facts(row);},async reason(input){calls++;if(calls===1)throw new SpatialOutputProtocolError('Model content is not valid JSON');assert.match(input.feedback??'',/not a valid spatial action/);return commit(assessment(input.current.id));}});
  await service.observe(await f.row('a',0));await service.finishInput();assert.equal(calls,2);assert.equal(service.latest()!.state.version,1);
 }finally{await service?.close();await f.cleanup();}
});

test('HTTP 429 cools extraction and retries without dropping the observation',async()=>{
 const f=await fixture();let service:SpatialMemoryService|undefined,calls=0;
 try{
  service=await SpatialMemoryService.create(f.root,{async perceive(row){calls++;if(calls===1)throw Error('Separated VLM HTTP 429');return facts(row);},async reason(input){return commit(assessment(input.current.id));}},{cooldownMs:0});
  await service.observe(await f.row('a',0));await service.finishInput();assert.equal(calls,2);assert.equal(service.progress().spatialStates,1);
  const db=new DatabaseSync(join(f.root,'spatial.sqlite'),{readOnly:true});try{assert.ok((db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='congestion-429'").get() as any).n>=1);}finally{db.close();}
 }finally{await service?.close();await f.cleanup();}
});
