import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {prepareHolisticBundle,readRunReceipt,sha,type AuditBundle} from './holistic-memory-bundle.js';
import {calibrationCases,validateCalibration,runHolisticJudge} from './holistic-memory-judge.js';
import {dimensions,validateHolisticReport,holisticScore} from './holistic-memory-contract.js';
import {evaluationJsonVlm} from './evaluation-json-vlm.js';
import {auditProbePlan,spatialCalibrationPlan,requireHolisticCapacity} from './holistic-memory-probes.js';
import {challengeVersions,verifyHolisticJudge} from './verify-holistic-memory-judge.js';
import {combineHolisticReviews} from './holistic-memory-workflow.js';

const report=()=>({summary:'整体室内记忆',dimensions:Object.fromEntries(dimensions.map(d=>[d,{score:3,status:'scored',reason:'整体有证据，局部不确定'}])),findings:[{claimId:'state:1',quote:'inside',kind:'unsupported',severity:'minor',referenceIds:['rerender-v2-000071'],imageIds:['rerender-v2-000071'],reason:'当前证据不足'}],strengths:['历史保留'],limitations:['仅两窗原图'],untested:['QA','long-term retrieval'],needsHumanReview:true});
test('a source-first contradiction invalidates acceptance of a perfect holistic score without rewriting it',()=>{
 const primary={completed:true,scores:{overall:100}};
 const disputed=combineHolisticReviews(primary,{completed:true,review:{findings:[{verdict:'contradicted',claimId:'state:2'}]}});
 assert.equal(disputed.status,'disputed');assert.equal(disputed.provisionalScores.overall,100);assert.equal(disputed.acceptedScores,null);assert.equal(disputed.automatic813,false);assert.equal(primary.scores.overall,100);
 assert.equal(combineHolisticReviews(primary,{completed:false}).status,'incomplete');assert.equal(combineHolisticReviews(primary,{completed:true,review:{findings:[{verdict:'uncertain'}]}}).status,'needs-human-review');
});
test('probe coverage selects generic risk/control windows and requires both ends, without prescribing an error verdict',()=>{
 assert.throws(()=>requireHolisticCapacity(204,[],8),/before paying/);assert.equal(requireHolisticCapacity(25,[],8),4);
 const states=[1,2,3,4,5].map(version=>({version,memberIds:['head-'+version,'tail-'+version],assessment:{location:{status:version===4?'unknown':'known',reason:version<=2?'repeated':'fresh '+version,...version===4?{boundary:{regions:['outside','inside']}}:{}}}}));
 const reference=states.flatMap(s=>s.memberIds.map((id,i)=>({id,annotation:{boundaryUncertain:[3,4,5].includes(s.version)&&i===1,placeId:s.version===4?(i?'inside':'outside'):'room',description:s.version===1?'出口楼梯':'room'}})));
 const bundle={states,reference} as AuditBundle,probes=auditProbePlan(bundle);assert.ok(probes.some(p=>p.version===2));assert.ok(probes.some(p=>p.version===3));assert.ok(probes.some(p=>p.version===5));assert.ok(probes.some(p=>p.version===4));assert.ok(probes.every(p=>p.sourceIds.length===2));
 const controls=spatialCalibrationPlan(bundle);assert.equal(controls[0]!.sourceIds[0],'head-1');assert.deepEqual(controls[2]!.sourceIds,['head-4','tail-4']);assert.equal(controls[1]!.expected,'contradicted');
 const r:any=report();r.findings=[];r.probeChecks=probes.map(p=>({version:p.version,verdict:'supported',startEvidence:'near ground',endEvidence:'same ground',reason:'both inspected'}));
 const refs=new Set(reference.map(r=>r.id));assert.doesNotThrow(()=>validateHolisticReport(r,[],refs,refs,probes));assert.throws(()=>validateHolisticReport(r,[],refs,new Set(['tail-2']),probes),/inspected start\/end/);
 r.probeChecks[0].verdict='contradicted';assert.throws(()=>validateHolisticReport(r,[],refs,refs,probes),/bind a finding/);
});

test('source-first verification hides candidates and primary scores before original-image grounding and never rewrites the primary report',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/source-first-'));
 try{
  const run=join(root,'producer');await mkdir(run);await writeFile(join(run,'spatial.sqlite'),'original');await writeFile(join(root,'primary-report.json'),'immutable-score');
  const states=[1,2,3].map(version=>({version,memberIds:['a'+version,'b'+version],assessment:{location:{status:'known',reason:version<3?'same current reason':'different'}}}));
  const observations=states.flatMap(s=>s.memberIds.map(id=>({id,views:[{id,direction:'front',path:'mock',sha256:'mock'}]})));
  const reference=observations.map(o=>({id:o.id,annotation:{boundaryUncertain:o.id==='b2'}}));
  const claims=states.map(s=>({id:'state:'+s.version,value:s.assessment})),bundle={run,hashes:{database:sha('original')},states,observations,reference,claims} as unknown as AuditBundle;
  assert.deepEqual(challengeVersions(bundle),[2,3]);const bundlePath=join(root,'bundle.json');await writeFile(bundlePath,JSON.stringify(bundle));let calls=0;
  const result=await verifyHolisticJudge(bundlePath,join(root,'audit'),async(model,prompt,data:any,images)=>{
   calls++;assert.equal(model,'qwen3.8-max-0902');assert.equal(images.length,4);
   if(calls===1){assert.ok(!JSON.stringify(data).includes('same current reason'));assert.equal(data.candidates,undefined);return {observations:data.sourceIds.map((id:string)=>({id,occupiedRegion:'road',nearGroundEvidence:'visible asphalt',distantVisible:'shop',uncertainty:'limited'})),windows:data.windows.map((w:any)=>({version:w.version,startEndRelation:'transition',reason:'ground changes'}))};}
   assert.ok(data.blindEvidence);assert.equal(data.primaryScore,undefined);return {checks:data.candidates.map((c:any)=>({claimId:c.id,...Object.fromEntries(['identity','currentReason','windowScope'].map(d=>[d,{verdict:'uncertain',reason:'limited evidence'}]))})),findings:[],summary:'No invented contradiction'};
  });
  assert.equal(calls,2);assert.equal(result.completed,true);assert.equal(await readFile(join(root,'primary-report.json'),'utf8'),'immutable-score');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('holistic findings bind exact candidate quotes, reference IDs and delivered originals; insufficient is not a full score',()=>{
 const claims=[{id:'state:1',value:{reason:'inside'}}],refs=new Set(['rerender-v2-000071']),images=new Set(refs);
 assert.doesNotThrow(()=>validateHolisticReport(report(),claims,refs,images));assert.equal(holisticScore(report()).overall,75);
 for(const change of [(r:any)=>r.findings[0].quote='invented',(r:any)=>r.findings[0].referenceIds=['foreign'],(r:any)=>r.findings[0].imageIds=['unseen'],(r:any)=>r.dimensions.identity.score=5]){const r=report();change(r);assert.throws(()=>validateHolisticReport(r,claims,refs,images));}
 const r=report();r.dimensions.identity={score:null,status:'insufficient',reason:'No evidence'} as any;assert.equal(holisticScore(r).overall,null);
 assert.throws(()=>validateCalibration({verdicts:calibrationCases.map(c=>({id:c.id,verdict:'supported',reason:'generic'}))}),/mismatch/);
});

test('bounded holistic judge maintains one Session, batches tools, separates controls, rejects uninspected final citations and preserves producer',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/holistic-agent-'));
 try{
  const run=join(root,'producer'),out=join(root,'audit');await mkdir(run);await mkdir(join(out,'sheets'),{recursive:true});await writeFile(join(run,'spatial.sqlite'),'immutable producer');await writeFile(join(out,'bundle.json'),'bundle');
  const observations=['rerender-v2-000071','rerender-v2-000089'].map((id,i)=>({id,atMs:i*2000,views:['front','left','right'].map(direction=>({id,direction,path:'mock',sha256:'mock'})),facts:{summary:'independent'}}));
  const bundle={run,hashes:{database:sha('immutable producer')},states:[{version:1,memberIds:[observations[0]!.id]},{version:2,memberIds:[observations[1]!.id]}],reference:observations.map(o=>({id:o.id})),claims:[{id:'state:1',value:{reason:'inside'}}],observations,places:[],visits:[],scope:{},integrity:{},complete:{}} as unknown as AuditBundle;
  await writeFile(join(out,'sheets/manifest.json'),JSON.stringify(bundle.states.map(s=>({id:'sheet:'+s.version,version:s.version,path:'mock',direction:'overview',sha256:'mock',sources:s.memberIds}))));
  let calls=0;
  const result=await runHolisticJudge(bundle,out,async(model,prompt,data:any,images)=>{
   assert.equal(model,'qwen3.8-max-0902');calls++;
   if(calls===1){assert.ok(!JSON.stringify(data).includes('expected'));assert.equal(images.length,6);return {verdicts:calibrationCases.map(c=>({id:c.id,verdict:c.expected,reason:'visible original'}))};}
   assert.ok(!JSON.stringify(data).includes('green-table')); // calibration is not main-session history
   if(calls===2){assert.equal(images.length,2);return {tool:'finish',report:report()};}
   if(calls===3){assert.match(JSON.stringify(data.session),/Finish requires actual original/);return {tool:'inspect',ids:observations.map(o=>o.id)};}
   assert.equal(images.length,6);return {tool:'finish',report:report()};
  },{spatialControls:false});
  assert.equal(calls,4);assert.equal(result.completed,true);assert.equal(result.scores!.overall,75);assert.equal(result.coverage.originalImagesInspected,6);assert.equal(await readFile(join(run,'spatial.sqlite'),'utf8'),'immutable producer');
  const session=await readFile(join(out,'judge-session.jsonl'),'utf8');assert.match(session,/isError/);assert.match(session,/inspect/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('read-only bundle joins position answers by source clock and hashes, strips coordinates and refuses incomplete coverage',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/holistic-bundle-'));
 try{
  const run=join(root,'producer'),reference=join(root,'reference');await mkdir(run);await mkdir(reference);
  const bytes=Buffer.from([137,80,78,71,13,10,26,10,1]),image=join(root,'image.png');await writeFile(image,bytes);
  const observations=['a','b'].map((id,i)=>({id,atMs:i*2000,sourceAtMs:i*500,views:['front','left','right'].map(direction=>({direction,path:image,sha256:sha(bytes)}))}));
  const publicBytes=JSON.stringify({observations});await writeFile(join(reference,'public-source.json'),publicBytes);
  const sample={reviewRequired:false,frames:observations.map(o=>({id:o.id,sourceAtMs:o.sourceAtMs,position:['SECRET-COORDINATES'],annotation:{status:'annotation-complete',placeId:'region',description:'inside',boundaryUncertain:false}}))};await writeFile(join(reference,'sample.json'),JSON.stringify(sample));
  await writeFile(join(run,'complete.json'),JSON.stringify({completed:true,inputSHA256:sha(publicBytes),planned:2,coveredObservations:2,plannedStates:2}));
  const db=new DatabaseSync(join(run,'spatial.sqlite'));
  db.exec('CREATE TABLE spatial_schema(version);INSERT INTO spatial_schema VALUES(4);CREATE TABLE observations(seq,id,raw,facts);CREATE TABLE states(version,raw);CREATE TABLE window_members(observation_id);CREATE TABLE checkpoints(version);CREATE TABLE checkpoint_bindings(version);CREATE TABLE revisions(version);CREATE TABLE skipped_windows(version);CREATE TABLE places(id,name,created_version);CREATE TABLE visits(id,place_id,start_version);CREATE TABLE place_notes(id,place_id,text,created_version);CREATE TABLE place_note_sources(note_id,version,source_id);CREATE TABLE place_profile_revisions(place_id,version,key,raw);');
  for(const [i,o] of observations.entries()){db.prepare('INSERT INTO observations VALUES(?,?,?,?)').run(i,o.id,JSON.stringify(o),'{}');db.prepare('INSERT INTO states VALUES(?,?)').run(i+1,JSON.stringify({version:i+1,observationId:o.id,assessment:{location:{reason:'inside'}}}));db.prepare('INSERT INTO window_members VALUES(?)').run(o.id);db.prepare('INSERT INTO checkpoints VALUES(?)').run(i+1);db.prepare('INSERT INTO checkpoint_bindings VALUES(?)').run(i+1);}db.close();
  const before=sha(await readFile(join(run,'spatial.sqlite'))),bundle=await prepareHolisticBundle(run,join(reference,'sample.json'),join(root,'out'));
  assert.equal(bundle.reference.length,2);assert.ok(!JSON.stringify(bundle).includes('SECRET-COORDINATES'));assert.equal(sha(await readFile(join(run,'spatial.sqlite'))),before);
  sample.frames[0]!.sourceAtMs=999;await writeFile(join(reference,'sample.json'),JSON.stringify(sample));await assert.rejects(prepareHolisticBundle(run,join(reference,'sample.json'),join(root,'bad-clock')),/source-clock mismatch/);
  sample.frames[0]!.sourceAtMs=0;await writeFile(join(reference,'sample.json'),JSON.stringify(sample));const alter=new DatabaseSync(join(run,'spatial.sqlite'));alter.exec("DELETE FROM window_members WHERE observation_id='a'");alter.close();await assert.rejects(prepareHolisticBundle(run,join(reference,'sample.json'),join(root,'bad-coverage')),/coverage/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Max transport text-only opt-in, token reservations and unknown failures remain bounded without provider retries',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/holistic-transport-')),originalFetch=globalThis.fetch,key=process.env.QWEN_API_KEY,base=process.env.QWEN_BASE_URL;process.env.QWEN_API_KEY='fixture';process.env.QWEN_BASE_URL='https://fixture.invalid/v1';let calls=0;
 try{
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({model:'qwen3.8-max-0902',usage:{prompt_tokens:100,completion_tokens:20},choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]}));};
  const request=evaluationJsonVlm(root,3,{transport:'qwen',allowTextOnly:true,maxInputChars:100,maxTotalTokens:136050});
  assert.deepEqual(await request('qwen3.8-max-0902','JSON',{},[]),{ok:true});await assert.rejects(request('qwen3.8-max-0902','JSON',{},[]),/reservation budget/);assert.equal(calls,1);
  const unknown=join(root,'unknown');globalThis.fetch=async()=>{calls++;throw Error('network failed');};const failed=evaluationJsonVlm(unknown,2,{transport:'qwen',allowTextOnly:true,maxTotalTokens:136050});await assert.rejects(failed('qwen3.8-max','JSON',{},[]),/network failed/);await assert.rejects(failed('qwen3.8-max','JSON',{},[]),/reservation budget/);assert.equal(JSON.parse(await readFile(join(unknown,'usage.json'),'utf8')).unknownCallsReserved,1);
 }finally{globalThis.fetch=originalFetch;if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;if(base===undefined)delete process.env.QWEN_BASE_URL;else process.env.QWEN_BASE_URL=base;await rm(root,{recursive:true,force:true});}
});

test('a failed complete.json is never used as success when a completed recovery receipt exists',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/receipt-'));
 try{
  await writeFile(join(root,'complete.json'),JSON.stringify({completed:false,observations:10,inputSHA256:'x'}));
  await assert.rejects(readRunReceipt(root),/no failed complete.json/);
  await writeFile(join(root,'complete-recovery-1.json'),JSON.stringify({completed:false,observations:10}));
  await writeFile(join(root,'complete-recovery-2.json'),JSON.stringify({completed:true,observations:100}));
  const receipt=await readRunReceipt(root);assert.equal(receipt.value.completed,true);assert.equal(receipt.value.observations,100);assert.match(receipt.path,/complete-recovery-2/);
 }finally{await rm(root,{recursive:true,force:true});}
});
