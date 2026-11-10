import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {execFileSync} from 'node:child_process';
import {SpatialMemoryService} from '../../assistant/spatial-memory/service.js';
import {spatialPerceptionModel} from '../../assistant/spatial-memory/models.js';
import {createPiSpatialReasoner} from '../../assistant/spatial-memory/pi-reasoner.js';
import {spatialJsonVlm} from '../../agent/spatial-json-vlm.js';
import type {Observation} from '../../assistant/spatial-memory/contracts.js';
import {projectReplayClock} from './spatial-window-plan.js';
import {validateRealtimeInterval,deliveryDueAt,attemptArtifact,appendRunRecord,readRunRecords} from './spatial-run-runtime.js';
import {imageIndexPlaceMatcher,ulvnPlaceMatcher} from '../../assistant/spatial-memory/visual-revisit.js';

// Production reconstruction entry: no annotation bundle, judge, or user questions.
const [inputArg,outArg,confirm,...flags]=process.argv.slice(2);
if(!inputArg||!outArg||confirm!=='--confirm-paid')throw Error('Usage: run-spatial-memory PUBLIC-INPUT NEW-OUTPUT --confirm-paid [--resume] [--memory-quality] [--limit=N] [--interval-ms=2000] [--replay-time-scale=2] [--busy-policy=queue|skip-obsolete] [--window-ms=8000] [--batch-ms=40000 --perception-ms=6000] [--thinking-budget=128]');
const resume=flags.includes('--resume'),accelerated=flags.includes('--replay-time-scale=2');
// Forced realtime: input is never slowed to wait for the memory agent. A busy agent skips the
// closed window (sources+facts retained for the successor) instead of delaying the next delivery.
const requireRealtime=flags.includes('--require-realtime');
// Quality mode: process every sealed window in order, with no wall-clock judgment
// deadline and no skipped windows. Input may lag behind the source cadence; that is
// measured, not enforced here. Use it to test memory quality, not live latency.
const memoryQuality=flags.includes('--memory-quality');
const extractionPolicy=flags.includes('--extraction=streaming')?'streaming':'window';
if(requireRealtime&&accelerated)throw Error('--require-realtime cannot be combined with --replay-time-scale=2');
if(requireRealtime&&memoryQuality)throw Error('--memory-quality cannot be combined with --require-realtime: quality runs do not skip windows');
const busyPolicy=flags.find(f=>f.startsWith('--busy-policy='))?.split('=')[1]??(accelerated||memoryQuality?'queue':'skip-obsolete');
if(busyPolicy!=='queue'&&busyPolicy!=='skip-obsolete')throw Error('Invalid busy policy');
const limitArg=flags.find(f=>f.startsWith('--limit=')),limit=limitArg?Number(limitArg.split('=')[1]):undefined;
const intervalArg=flags.find(f=>f.startsWith('--interval-ms=')),intervalMs=intervalArg?Number(intervalArg.split('=')[1]):2000;
const batchArg=flags.find(f=>f.startsWith('--batch-ms=')),batchMs=batchArg?Number(batchArg.split('=')[1]):0;
const perceptionArg=flags.find(f=>f.startsWith('--perception-ms=')),perceptionMs=perceptionArg?Number(perceptionArg.split('=')[1]):6000;
const thinkingArg=flags.find(f=>f.startsWith('--thinking-budget=')),thinkingBudget=thinkingArg?Number(thinkingArg.split('=')[1]):0;
if(!Number.isInteger(thinkingBudget)||thinkingBudget<0||thinkingBudget>4096)throw Error('Invalid --thinking-budget (integer 0..4096, 0 disables)');
const thinking=thinkingBudget>0?thinkingBudget:undefined;
const windowArg=flags.find(f=>f.startsWith('--window-ms=')),windowMs=batchMs?0:(windowArg?Number(windowArg.split('=')[1]):8000);
if(!Number.isInteger(windowMs)||windowMs&&(windowMs<4000||windowMs>20000||windowMs%intervalMs!==0))throw Error('Invalid --window-ms (multiple of the sampling interval, 4000..20000)');
if(batchMs&&(!Number.isInteger(batchMs)||batchMs<4000||batchMs>40000||batchMs%intervalMs!==0))throw Error('Invalid --batch-ms (multiple of the sampling interval, 4000..40000)');
if(batchMs&&(!Number.isInteger(perceptionMs)||perceptionMs<4000||perceptionMs>8000||perceptionMs%intervalMs!==0||perceptionMs>batchMs))throw Error('Invalid --perception-ms (multiple of the sampling interval, 4000..8000, not above batch)');
if(batchMs&&windowArg)throw Error('Use either --window-ms or --batch-ms, not both');
const revisitImagesArg=flags.find(f=>f.startsWith('--revisit-images-per-place=')),revisitImagesPerPlace=revisitImagesArg?Number(revisitImagesArg.split('=')[1]):6;
if(!Number.isInteger(revisitImagesPerPlace)||revisitImagesPerPlace<2||revisitImagesPerPlace>8)throw Error('Invalid --revisit-images-per-place (2..8)');
const revisitPlacesArg=flags.find(f=>f.startsWith('--revisit-max-places=')),revisitMaxPlaces=revisitPlacesArg?Number(revisitPlacesArg.split('=')[1]):100;
if(!Number.isInteger(revisitMaxPlaces)||revisitMaxPlaces<1||revisitMaxPlaces>256)throw Error('Invalid --revisit-max-places (1..256)');
const revisitCandidatesArg=flags.find(f=>f.startsWith('--revisit-max-candidates=')),revisitMaxCandidates=revisitCandidatesArg?Number(revisitCandidatesArg.split('=')[1]):20;
const matcherArg=flags.find(f=>f.startsWith('--matcher=')),matcherBackend=matcherArg?.split('=')[1]??'legacy';
if(!['legacy','ulvn'].includes(matcherBackend))throw Error('Invalid --matcher (legacy|ulvn)');
if(matcherArg)flags.splice(flags.indexOf(matcherArg),1);
if(!Number.isInteger(revisitMaxCandidates)||revisitMaxCandidates<1||revisitMaxCandidates>200)throw Error('Invalid --revisit-max-candidates (1..200)');
const judgmentDeadlineMs=memoryQuality?0:Math.max(30000,(batchMs||windowMs)*2);
const maxTurnsPerJudgment=memoryQuality?24:12;
if(flags.some(f=>!['--resume','--replay-time-scale=2','--require-realtime','--memory-quality'].includes(f)&&!f.startsWith('--limit=')&&!f.startsWith('--interval-ms=')&&!f.startsWith('--busy-policy=')&&!f.startsWith('--window-ms=')&&!f.startsWith('--batch-ms=')&&!f.startsWith('--perception-ms=')&&!f.startsWith('--thinking-budget=')&&!f.startsWith('--extraction=')&&!f.startsWith('--revisit-images-per-place=')&&!f.startsWith('--revisit-max-places=')&&!f.startsWith('--revisit-max-candidates=')))throw Error('Invalid runner flag');
if(requireRealtime&&busyPolicy!=='skip-obsolete')throw Error('--require-realtime requires --busy-policy=skip-obsolete: a queue policy would delay input delivery');
if(limitArg&&(!Number.isInteger(limit)||limit!<1))throw Error('Invalid limit');
validateRealtimeInterval(intervalMs);
if(matcherBackend==='ulvn'){
 const python=process.env.ULVN_PYTHON;if(!python)throw Error('Set ULVN_PYTHON to the isolated model environment before a paid ULVN-backed run');
 const check=JSON.parse(execFileSync(python,[resolve('scripts/media/ulvn_match.py'),'--check'],{encoding:'utf8',timeout:60000}));
 if(check.ok!==true)throw Error('ULVN dependencies unavailable; no paid inference started: '+JSON.stringify(check.dependencies));
}
const raw=await readFile(inputArg),input=JSON.parse(raw.toString()),out=resolve(outArg);
if(input.schema!=='spatial-public-input-v1'||!Array.isArray(input.observations)||!input.observations.length)throw Error('Require original public input');
const selection=input.selection??null;
const all:Observation[]=input.observations.map((r:any)=>({id:r.id,atMs:r.atMs,...typeof r.recordingId==='string'?{recordingId:r.recordingId}:{},views:r.views.map((v:any)=>({id:r.id,direction:v.direction,path:v.path,sha256:v.sha256}))}));
if(new Set(all.map(r=>r.id)).size!==all.length||all.some((r,i)=>!Number.isFinite(r.atMs)||r.atMs<0||i>0&&r.atMs<=all[i-1]!.atMs))throw Error('Invalid chronological public source');
// Default is real-time delivery: one 3-camera observation every intervalMs of wall clock.
// --replay-time-scale=2 processes the same projection without waiting, for fast protocol checks only.
const sampled=projectReplayClock(all,intervalMs,2);
const rows=limit?sampled.slice(0,limit):sampled;
let plannedStates=0,lastBucket:number|undefined,lastRecording:string|undefined;const bucketMs=batchMs||windowMs;
for(const row of rows){const bucket=Math.floor(row.atMs/bucketMs);if(lastBucket!==bucket||lastRecording!==row.recordingId)plannedStates++;lastBucket=bucket;lastRecording=row.recordingId;}
const binding={inputSHA256:createHash('sha256').update(raw).digest('hex'),planned:rows.length,sourcePlanned:selection?.originalCount??all.length,windowMs,batchMs,perceptionMs,...thinking?{thinkingBudget:thinking}:{},bucketMs,samplingMs:2000,plannedStates,plannedBatches:batchMs?plannedStates:0,mode:memoryQuality?'quality':accelerated?'accelerated-replay':'realtime',intervalMs,replayTimeScale:2,replayMinimumIntervalMs:2000,sourceCoverage:selection?'selected-segments':rows.length===all.length?'all-original-observations':'original-prefix-no-sampling',selection,realtimeEnforced:requireRealtime,locationStatuses:'known-new-or-boundary',judgmentDeadlineMs,maxTurnsPerJudgment,memoryQuality,extractionPolicy,extractionMode:extractionPolicy==='streaming'?'per-observation-streaming':'single-window-worker',perceptionMode:batchMs?'independent-fast-facts':'window-coupled',spatialInputPolicy:batchMs?'facts-first-on-demand-images':'window-images',evidencePolicy:'wait-for-independent-facts',contextPolicy:'spatial-session-context-v1',memoryLibraryPolicy:'place-visits-windows-sources-v1',runtimePolicy:'projected-suffix-clock-durable-timing-v1',revisitPolicy:'sift-ransac-required/v1',revisitLimit:revisitMaxCandidates,revisitImagesPerPlace,revisitMaxPlaces,busyPolicy};
if(matcherBackend==='ulvn')binding.revisitPolicy='megaloc-lightglue-ransac/v1';
if(resume){const manifest=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));for(const [key,value] of Object.entries(binding))if(JSON.stringify(manifest[key])!==JSON.stringify(value))throw Error('Resume manifest mismatch: '+key);if(batchMs)throw Error('Batch-mode resume is not implemented; rerun without --resume');}
if(!resume)await mkdir(out,{recursive:false});
const start=Date.now(),attemptId=Date.now()+'-'+randomUUID();
const reasoner=await createPiSpatialReasoner(join(out,'pi'),spatialJsonVlm(join(out,'pi-requests'),8000,8,true,1600,thinking?{thinkingBudget:thinking}:{}),{resume,judgmentDeadlineMs,maxTurnsPerJudgment,...batchMs?{skillName:'spatial-memory-v2-batch'}:{}});
const matcher=matcherBackend==='ulvn'?ulvnPlaceMatcher({imagesPerPlace:revisitImagesPerPlace}):imageIndexPlaceMatcher(undefined,{imagesPerPlace:revisitImagesPerPlace,shortlistPlaces:revisitMaxPlaces,siftImagesPerPlace:2,maxDim:640,minInliers:0});
if(resume){const previous=JSON.parse(await readFile(join(out,'matcher-policy.json'),'utf8').catch(e=>{if((e as NodeJS.ErrnoException).code==='ENOENT')return '{"backend":"legacy"}';throw e;}));if(previous.backend!==matcherBackend)throw Error('Resume matcher backend mismatch');}
else await writeFile(join(out,'matcher-policy.json'),JSON.stringify({backend:matcherBackend,method:matcherBackend==='ulvn'?'megaloc-lightglue-ransac':'sift-ransac-plus-global-layout',scope:'Candidate images only; no semantic identity certification',imagesPerPlace:revisitImagesPerPlace},null,2),{flag:'wx'});
const service=await SpatialMemoryService.create(out,spatialPerceptionModel(out),{reasoner,resume,maxPending:memoryQuality?64:requireRealtime?64:12,extractionConcurrency:batchMs?3:extractionPolicy==='streaming'?3:1,extractionPolicy,maxReasonCalls:8,...batchMs?{batchMs,perceptionMs}:{windowMs},evidencePolicy:'wait',busyPolicy,revisitMatcher:matcher,revisitPolicy:'required',revisitLimit:revisitMaxCandidates,revisitMaxPlaces});
if(!resume)await writeFile(join(out,'manifest.json'),JSON.stringify({schema:'spatial-memory-run-v6',...binding,producer:'spatial-memory-pi-v6',storageSchema:4,agent:batchMs?'pi-spatial-memory-v2-batch':'pi-spatial-memory-v2',agentSkill:batchMs?'spatial-memory-v2-batch':'spatial-memory-v2',spatialAssessmentRequired:true,context:'persistent-session-with-structured-state-head',longTerm:'organized-place-visits-with-add-notes',extractionConcurrency:1,maxReasonCalls:8,maxPending:memoryQuality?64:requireRealtime?64:12,revisitImagesPerPlace,revisitMaxCandidates,revisitMaxPlaces,questions:false,judge:false,resume:false},null,2),{flag:'wx'});
const timer=setInterval(()=>console.log(JSON.stringify({stage:'spatial-memory',elapsedMs:Date.now()-start,...service.progress()})),10000);timer.unref();
type Delivery={observationId:string;index:number;attemptId:string;plannedDueMs:number|null;deliveredAtMs:number;deliveredWallMs:number;deliveryLagMs:number|null};
const delivery=await readRunRecords<Delivery>(out,'delivery.jsonl');
let backpressureWaits=0,backpressureWaitMs=0,error:string|null=null,deliveryViolations=0,maxDeliveryLagMs=0;
try{
 if(resume)await service.resumePending();
 const firstPending=rows.findIndex(row=>!service.knows(row.id)),deliveryAnchor=Date.now();
 await appendRunRecord(out,'run-attempts.jsonl',{kind:'started',attemptId,resume,startedAtMs:start,deliveryAnchorMs:deliveryAnchor,firstPendingIndex:firstPending});
 for(const [index,row] of rows.entries()){
  if(service.knows(row.id))continue;
  const due=accelerated?null:deliveryDueAt(rows,index,firstPending,deliveryAnchor);
  if(due!==null){const wait=due-Date.now();if(wait>0)await sleep(wait);}
  for(;;){
   try{await service.observe(row);break;}
   catch(e){
    if(!/Spatial backpressure/.test(String(e)))throw e;
    const began=Date.now();backpressureWaits++;
    while(service.progress().admitted>=service.progress().capacity){if(service.progress().failure)throw Error(service.progress().failure!);await sleep(20);}
    backpressureWaitMs+=Date.now()-began;
   }
  }
  const at=Date.now(),record:Delivery={observationId:row.id,index,attemptId,plannedDueMs:due===null?null:due-start,deliveredAtMs:at-start,deliveredWallMs:at,deliveryLagMs:due===null?null:at-due};
  await appendRunRecord(out,'delivery.jsonl',record);delivery.push(record);
   // Realtime is a property of input delivery, not of agent speed: a late delivery is a violation,
   // while a slow agent is expected to skip rather than block the next observation.
   if(requireRealtime&&record.deliveryLagMs!==null){const lag=record.deliveryLagMs;maxDeliveryLagMs=Math.max(maxDeliveryLagMs,lag);if(lag>intervalMs)deliveryViolations++;}
  }
 await service.finishInput();
}catch(e){error=String(e);}finally{
 clearInterval(timer);const progress=service.progress();await mkdir(join(out,'contexts'),{recursive:true});
 let contexts=0;const snapshots:Array<ReturnType<SpatialMemoryService['snapshotAt']>>=[];
 for(let version=1;version<=progress.stateVersions;version++){
  const snapshot=service.snapshotAt(version,Number.MAX_SAFE_INTEGER),path=join(out,'contexts',String(version).padStart(4,'0')+'.json');
  const expected={schema:'spatial-state-context-v1',state:snapshot.state,context:snapshot.context};snapshots.push(snapshot);
  try{await writeFile(path,JSON.stringify(expected,null,2),{flag:'wx'});contexts++;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(JSON.stringify(JSON.parse(await readFile(path,'utf8')))!==JSON.stringify(expected))error??='Existing context content mismatch at version '+version;else contexts++;}
 }
 const usage=await Promise.all(['perception-requests','pi-requests'].map(async lane=>{try{return {lane,...JSON.parse(await readFile(join(out,lane,'usage.json'),'utf8'))};}catch{return {lane,missing:true};}}));
 let agentCheckpoints=0;try{const checkpoints=(await readFile(join(out,'pi','pi-checkpoints.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));agentCheckpoints=checkpoints.length;const skillKey=batchMs?'spatial-memory-v2-batch':'spatial-memory-v2';for(const snapshot of snapshots){const matches=checkpoints.filter(c=>c.version===snapshot.state.version);if(matches.length!==1||matches[0].observationId!==snapshot.state.observationId||!matches[0].tipId||!matches[0].session?.id||!matches[0].skillVersions?.[skillKey]||JSON.stringify(matches[0].window?.memberIds??[matches[0].observationId])!==JSON.stringify(snapshot.state.window?.observations.map(o=>o.id)??[snapshot.state.observationId]))error??='Pi checkpoint binding mismatch';}}catch{error??='Missing or invalid Pi checkpoints';}
 const tasks=service.taskTimings();
 const latency=latencySummary(tasks,delivery,backpressureWaits,backpressureWaitMs,progress.peakAdmitted);
  const realtimeSatisfied=!requireRealtime||deliveryViolations===0;
  const realtime={enforced:requireRealtime,maxDeliveryLagMs,deliveryViolations,toleranceMs:intervalMs,backpressureWaits,skippedWindows:progress.skippedWindows,satisfied:realtimeSatisfied,note:requireRealtime?'Input cadence is never slowed for the memory agent; while it is busy the sealed window is skipped with its sources and facts retained for the successor.':memoryQuality?'Quality mode: every sealed window is processed in order with no judgment deadline; input delivery may lag and is reported, not enforced.':'Queue mode: sealed windows are processed in order; delivery/backpressure are reported separately from memory quality.'};
  if(requireRealtime&&!realtimeSatisfied&&!error)error='Spatial realtime delivery violated at '+deliveryViolations+' observation(s); max lag '+maxDeliveryLagMs+'ms exceeds '+intervalMs+'ms';
  const coverageObligationMet=batchMs?(requireRealtime?progress.spatialStates+progress.skippedWindows>=plannedStates&&progress.pending===0&&progress.deferredObservations===0:progress.coveredObservations===rows.length&&progress.pending===0):selection?progress.coveredObservations===rows.length&&progress.pending===0:requireRealtime?progress.spatialStates+progress.skippedWindows===plannedStates:progress.coveredObservations===rows.length&&progress.spatialStates===plannedStates;
  const complete={schema:'spatial-memory-complete-v6',inputDrainComplete:!error&&progress.observations===rows.length&&progress.pending===0&&progress.deferredObservations===0&&progress.missingFacts===0&&contexts===progress.stateVersions&&agentCheckpoints===progress.stateVersions,completed:!error&&progress.observations===rows.length&&coverageObligationMet&&progress.pending===0&&progress.missingFacts===0&&progress.incompleteWindows===0&&contexts===progress.stateVersions&&agentCheckpoints===progress.stateVersions,...binding,...progress,coverageObligationMet,fullWindowCoverage:progress.skippedWindows===0&&progress.coveredObservations===rows.length,realtime,contextsWritten:contexts,agentCheckpoints,elapsedMs:Date.now()-start,latency,usage,error};
 if(!complete.completed)error??=progress.skippedWindows?'Spatial coverage incomplete: busy windows were explicitly skipped; queue policy is required for full-window coverage':'Incomplete spatial run';
 const attempt={attemptId,resume,startedAtMs:start,elapsedScope:'current-process-attempt',deliveryLoggingGaps:progress.observations-new Set(delivery.map(d=>d.observationId)).size};
 await writeFile(join(out,attemptArtifact('task-timing',attemptId,resume)),JSON.stringify({schema:'spatial-task-timing-v2',...attempt,mode:binding.mode,intervalMs,tasks,delivery,latency},null,2),{flag:'wx'});
 await writeFile(join(out,attemptArtifact('complete',attemptId,resume)),JSON.stringify({...complete,...attempt,error},null,2),{flag:'wx'});
 await appendRunRecord(out,'run-attempts.jsonl',{kind:'finished',attemptId,finishedAtMs:Date.now(),completed:complete.completed,error});
 console.log(JSON.stringify({...complete,...attempt,error}));await service.close().catch(()=>{});
}
if(error)throw Error(error);

function percentile(values:number[],p:number){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1)]!;}
/** Descriptive latency only. A small sample or a slow API tail is not a real-time guarantee. */
function latencySummary(tasks:Array<Record<string,unknown>>,delivery:Array<{deliveryLagMs:number|null}>,backpressureWaits:number,backpressureWaitMs:number,peakAdmitted:number){
 const metric=(key:string)=>tasks.map(t=>t[key]).filter((v):v is number=>typeof v==='number');
 const stats=(key:string)=>{const values=metric(key);return {count:values.length,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),maxMs:values.length?Math.max(...values):null};};
 const lags=delivery.map(d=>d.deliveryLagMs).filter((v):v is number=>typeof v==='number');
 return {taskCount:tasks.length,observedTasks:tasks.filter(t=>typeof t.oldestDeliveryToCommitMs==='number').length,
  firstStateFromOldestDeliveryMs:stats('oldestDeliveryToCommitMs'),firstStateFromSealedMs:stats('sealedToCommitMs'),
  perceptionToCommitMs:stats('perceptionToCommitMs'),deliveryLagMs:{count:lags.length,p50Ms:percentile(lags,.5),p95Ms:percentile(lags,.95),maxMs:lags.length?Math.max(...lags):null},
  missingEvidenceTasks:tasks.filter(t=>typeof t.missingFactCount==='number'&&t.missingFactCount>0).length,
  peakAdmitted,backpressureWaits,backpressureWaitMs,
  note:'Wall-clock task latencies. Input delivery uses the selected interval; processing lag is measured, not compressed. Not a guarantee for a different source rate, model tail or account quota.'};
}
