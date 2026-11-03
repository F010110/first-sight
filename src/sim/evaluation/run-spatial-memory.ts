import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {SpatialMemoryService} from '../../assistant/spatial-memory/service.js';
import {spatialPerceptionModel} from '../../assistant/spatial-memory/models.js';
import {createPiSpatialReasoner} from '../../assistant/spatial-memory/pi-reasoner.js';
import {spatialJsonVlm} from '../../agent/spatial-json-vlm.js';
import type {Observation} from '../../assistant/spatial-memory/contracts.js';
import {projectReplayClock} from './spatial-window-plan.js';
import {validateRealtimeInterval,deliveryDueAt,attemptArtifact,appendRunRecord,readRunRecords} from './spatial-run-runtime.js';

// Production reconstruction entry: no annotation bundle, judge, or user questions.
const [inputArg,outArg,confirm,...flags]=process.argv.slice(2);
if(!inputArg||!outArg||confirm!=='--confirm-paid')throw Error('Usage: run-spatial-memory PUBLIC-INPUT NEW-OUTPUT --confirm-paid [--resume] [--limit=N] [--interval-ms=2000] [--replay-time-scale=2] [--busy-policy=queue|skip-obsolete]');
const resume=flags.includes('--resume'),accelerated=flags.includes('--replay-time-scale=2');
const busyPolicy=flags.find(f=>f.startsWith('--busy-policy='))?.split('=')[1]??(accelerated?'queue':'skip-obsolete');
if(busyPolicy!=='queue'&&busyPolicy!=='skip-obsolete')throw Error('Invalid busy policy');
const limitArg=flags.find(f=>f.startsWith('--limit=')),limit=limitArg?Number(limitArg.split('=')[1]):undefined;
const intervalArg=flags.find(f=>f.startsWith('--interval-ms=')),intervalMs=intervalArg?Number(intervalArg.split('=')[1]):2000;
if(flags.some(f=>!['--resume','--replay-time-scale=2'].includes(f)&&!f.startsWith('--limit=')&&!f.startsWith('--interval-ms=')&&!f.startsWith('--busy-policy=')))throw Error('Invalid runner flag');
if(limitArg&&(!Number.isInteger(limit)||limit!<1))throw Error('Invalid limit');
validateRealtimeInterval(intervalMs);
const raw=await readFile(inputArg),input=JSON.parse(raw.toString()),out=resolve(outArg);
if(input.schema!=='spatial-public-input-v1'||!Array.isArray(input.observations)||!input.observations.length)throw Error('Require original public input');
const all:Observation[]=input.observations.map((r:any)=>({id:r.id,atMs:r.atMs,...typeof r.recordingId==='string'?{recordingId:r.recordingId}:{},views:r.views.map((v:any)=>({id:r.id,direction:v.direction,path:v.path,sha256:v.sha256}))}));
if(new Set(all.map(r=>r.id)).size!==all.length||all.some((r,i)=>!Number.isFinite(r.atMs)||r.atMs<0||i>0&&r.atMs<=all[i-1]!.atMs))throw Error('Invalid chronological public source');
// Default is real-time delivery: one 3-camera observation every intervalMs of wall clock.
// --replay-time-scale=2 processes the same projection without waiting, for fast protocol checks only.
const sampled=projectReplayClock(all,intervalMs,2);
const rows=limit?sampled.slice(0,limit):sampled;
let plannedStates=0,lastBucket:number|undefined,lastRecording:string|undefined;
for(const row of rows){const bucket=Math.floor(row.atMs/8000);if(lastBucket!==bucket||lastRecording!==row.recordingId)plannedStates++;lastBucket=bucket;lastRecording=row.recordingId;}
const binding={inputSHA256:createHash('sha256').update(raw).digest('hex'),planned:rows.length,sourcePlanned:all.length,windowMs:8000,samplingMs:2000,plannedStates,mode:accelerated?'accelerated-replay':'realtime',intervalMs,replayTimeScale:2,replayMinimumIntervalMs:2000,sourceCoverage:rows.length===all.length?'all-original-observations':'original-prefix-no-sampling',extractionMode:'single-window-worker',evidencePolicy:'wait-for-independent-facts',contextPolicy:'spatial-session-context-v1',memoryLibraryPolicy:'place-visits-windows-sources-v1',runtimePolicy:'projected-suffix-clock-durable-timing-v1',busyPolicy};
if(resume){const manifest=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));for(const [key,value] of Object.entries(binding))if(manifest[key]!==value)throw Error('Resume manifest mismatch: '+key);}
if(!resume)await mkdir(out,{recursive:false});
const start=Date.now(),attemptId=Date.now()+'-'+randomUUID();
const reasoner=await createPiSpatialReasoner(join(out,'pi'),spatialJsonVlm(join(out,'pi-requests'),8000,8,true,1600),{resume});
const service=await SpatialMemoryService.create(out,spatialPerceptionModel(out),{reasoner,resume,maxPending:12,extractionConcurrency:1,maxReasonCalls:8,windowMs:8000,evidencePolicy:'wait',busyPolicy});
if(!resume)await writeFile(join(out,'manifest.json'),JSON.stringify({schema:'spatial-memory-run-v6',...binding,producer:'spatial-memory-pi-v6',storageSchema:4,agent:'pi-spatial-memory-v2',spatialAssessmentRequired:true,context:'persistent-session-with-structured-state-head',longTerm:'organized-place-visits-with-add-notes',extractionConcurrency:1,maxReasonCalls:8,maxPending:12,questions:false,judge:false,resume:false},null,2),{flag:'wx'});
const timer=setInterval(()=>console.log(JSON.stringify({stage:'spatial-memory',elapsedMs:Date.now()-start,...service.progress()})),10000);timer.unref();
type Delivery={observationId:string;index:number;attemptId:string;plannedDueMs:number|null;deliveredAtMs:number;deliveredWallMs:number;deliveryLagMs:number|null};
const delivery=await readRunRecords<Delivery>(out,'delivery.jsonl');
let backpressureWaits=0,backpressureWaitMs=0,error:string|null=null;
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
    while(service.progress().admitted>=12){if(service.progress().failure)throw Error(service.progress().failure!);await sleep(20);}
    backpressureWaitMs+=Date.now()-began;
   }
  }
  const at=Date.now(),record:Delivery={observationId:row.id,index,attemptId,plannedDueMs:due===null?null:due-start,deliveredAtMs:at-start,deliveredWallMs:at,deliveryLagMs:due===null?null:at-due};
  await appendRunRecord(out,'delivery.jsonl',record);delivery.push(record);
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
 let agentCheckpoints=0;try{const checkpoints=(await readFile(join(out,'pi','pi-checkpoints.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));agentCheckpoints=checkpoints.length;for(const snapshot of snapshots){const matches=checkpoints.filter(c=>c.version===snapshot.state.version);if(matches.length!==1||matches[0].observationId!==snapshot.state.observationId||!matches[0].tipId||!matches[0].session?.id||!matches[0].skillVersions?.['spatial-memory-v2']||JSON.stringify(matches[0].window?.memberIds??[matches[0].observationId])!==JSON.stringify(snapshot.state.window?.observations.map(o=>o.id)??[snapshot.state.observationId]))error??='Pi checkpoint binding mismatch';}}catch{error??='Missing or invalid Pi checkpoints';}
 const tasks=service.taskTimings();
 const latency=latencySummary(tasks,delivery,backpressureWaits,backpressureWaitMs,progress.peakAdmitted);
 const complete={schema:'spatial-memory-complete-v5',inputDrainComplete:!error&&progress.observations===rows.length&&progress.pending===0&&progress.deferredObservations===0&&progress.missingFacts===0&&contexts===progress.stateVersions&&agentCheckpoints===progress.stateVersions,completed:!error&&progress.observations===rows.length&&progress.coveredObservations===rows.length&&progress.spatialStates===plannedStates&&progress.pending===0&&progress.missingFacts===0&&progress.incompleteWindows===0&&contexts===progress.stateVersions&&agentCheckpoints===progress.stateVersions,...binding,...progress,contextsWritten:contexts,agentCheckpoints,elapsedMs:Date.now()-start,latency,usage,error};
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
