import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {SpatialMemoryService} from '../../assistant/spatial-memory/service.js';
import {spatialPerceptionModel} from '../../assistant/spatial-memory/models.js';
import {createPiSpatialReasoner} from '../../assistant/spatial-memory/pi-reasoner.js';
import {spatialJsonVlm} from '../../agent/spatial-json-vlm.js';
import type {Observation} from '../../assistant/spatial-memory/contracts.js';
import {projectTwoSecondReplay} from './spatial-window-plan.js';

// Production reconstruction entry: no annotation bundle, judge, or user questions.
const [inputArg,outArg,confirm,...flags]=process.argv.slice(2);
if(!inputArg||!outArg||confirm!=='--confirm-paid')throw Error('Usage: run-spatial-memory PUBLIC-INPUT NEW-OUTPUT --confirm-paid [--resume] [--limit=N] [--window-ms=8000] [--replay-time-scale=2]');
const resume=flags.includes('--resume'),limitArg=flags.find(f=>f.startsWith('--limit=')),limit=limitArg?Number(limitArg.split('=')[1]):undefined;
const windowMs=flags.includes('--window-ms=8000')?8000:0,replayAll=flags.includes('--replay-time-scale=2');
if(flags.some(f=>!['--resume','--window-ms=8000','--replay-time-scale=2'].includes(f)&&!f.startsWith('--limit='))||limitArg&&(!Number.isInteger(limit)||limit!<1)||replayAll&&!windowMs)throw Error('Invalid runner flag');
const raw=await readFile(inputArg),input=JSON.parse(raw.toString()),out=resolve(outArg);
if(input.schema!=='spatial-public-input-v1'||!Array.isArray(input.observations)||!input.observations.length)throw Error('Require original public input');
const all:Observation[]=input.observations.map((r:any)=>({id:r.id,atMs:r.atMs,...typeof r.recordingId==='string'?{recordingId:r.recordingId}:{},views:r.views.map((v:any)=>({id:r.id,direction:v.direction,path:v.path,sha256:v.sha256}))}));
if(new Set(all.map(r=>r.id)).size!==all.length||all.some((r,i)=>!Number.isFinite(r.atMs)||r.atMs<0||i>0&&r.atMs<=all[i-1]!.atMs))throw Error('Invalid chronological public source');
// Explicit source-time sampling; original timestamps and full source input survive.
const sampled=replayAll?projectTwoSecondReplay(all):windowMs?all.filter(r=>(r.atMs-all[0]!.atMs)%2000===0):all;
const rows=limit?sampled.slice(0,limit):sampled;
let plannedStates=0,lastBucket:number|undefined,lastRecording:string|undefined;
for(const row of rows){const bucket=Math.floor(row.atMs/8000);if(!windowMs||lastBucket!==bucket||lastRecording!==row.recordingId)plannedStates++;lastBucket=bucket;lastRecording=row.recordingId;}
const binding={inputSHA256:createHash('sha256').update(raw).digest('hex'),planned:rows.length,sourcePlanned:all.length,windowMs,samplingMs:windowMs?2000:null,plannedStates,replayTimeScale:replayAll?2:1,replayMinimumIntervalMs:replayAll?2000:null,sourceCoverage:replayAll?(rows.length===all.length?'all-original-observations':'original-prefix-no-sampling'):'declared-sampling',extractionMode:windowMs?'single-window-worker':'per-observation',evidenceWaitMs:8000};
if(resume){const manifest=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));for(const [key,value] of Object.entries(binding))if(manifest[key]!==value)throw Error('Resume manifest mismatch: '+key);}
if(!resume)await mkdir(out,{recursive:false});
const start=Date.now();
const reasoner=await createPiSpatialReasoner(join(out,'pi'),spatialJsonVlm(join(out,'pi-requests'),8000,8,true,1600),{resume});
const service=await SpatialMemoryService.create(out,spatialPerceptionModel(out),{reasoner,resume,maxPending:12,extractionConcurrency:windowMs?1:2,maxReasonCalls:8,windowMs,evidenceWaitMs:8000});
if(!resume)await writeFile(join(out,'manifest.json'),JSON.stringify({schema:'spatial-memory-run-v3',...binding,producer:'spatial-memory-pi-v3',agent:'pi-spatial-memory-v2',spatialAssessmentRequired:true,context:'independent-bounded-working-memory',longTerm:'transactional-spatial-sqlite',extractionConcurrency:windowMs?1:2,maxReasonCalls:8,maxPending:12,questions:false,judge:false,resume:false},null,2),{flag:'wx'});
const timer=setInterval(()=>console.log(JSON.stringify({stage:'spatial-memory',elapsedMs:Date.now()-start,...service.progress()})),10000);timer.unref();
let error:string|null=null;
try{
 if(resume)await service.resumePending();
 for(const row of rows){
  if(service.knows(row.id))continue;
  while(service.progress().admitted>=12){if(service.progress().failure)throw Error(service.progress().failure!);await new Promise(r=>setTimeout(r,100));}
  await service.observe(row);
 }
 await service.finishInput();
}catch(e){error=String(e);}finally{
 clearInterval(timer);const progress=service.progress();await mkdir(join(out,'contexts'),{recursive:true});
 let contexts=0;const snapshots=[];
 for(let version=1;version<=progress.stateVersions;version++){
  const snapshot=service.snapshotAt(version,Number.MAX_SAFE_INTEGER),path=join(out,'contexts',String(version).padStart(4,'0')+'.json');
  const expected={schema:'spatial-state-context-v1',state:snapshot.state,context:snapshot.context};snapshots.push(snapshot);
  try{await writeFile(path,JSON.stringify(expected,null,2),{flag:'wx'});contexts++;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(JSON.stringify(JSON.parse(await readFile(path,'utf8')))!==JSON.stringify(expected))error??='Existing context content mismatch at version '+version;else contexts++;}
 }
 const usage=await Promise.all(['perception-requests','pi-requests'].map(async lane=>{try{return {lane,...JSON.parse(await readFile(join(out,lane,'usage.json'),'utf8'))};}catch{return {lane,missing:true};}}));
 let agentCheckpoints=0;try{const checkpoints=(await readFile(join(out,'pi','pi-checkpoints.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));agentCheckpoints=checkpoints.length;for(const snapshot of snapshots){const matches=checkpoints.filter(c=>c.version===snapshot.state.version);if(matches.length!==1||matches[0].observationId!==snapshot.state.observationId||!matches[0].tipId||!matches[0].session?.id||!matches[0].skillVersions?.['spatial-memory-v2']||JSON.stringify(matches[0].window?.memberIds??[matches[0].observationId])!==JSON.stringify(snapshot.state.window?.observations.map(o=>o.id)??[snapshot.state.observationId]))error??='Pi checkpoint binding mismatch';}}catch{error??='Missing or invalid Pi checkpoints';}
 const complete={schema:'spatial-memory-complete-v3',completed:!error&&progress.observations===rows.length&&progress.coveredObservations===rows.length&&progress.spatialStates===plannedStates&&progress.pending===0&&progress.missingFacts===0&&progress.incompleteWindows===0&&contexts===progress.stateVersions&&agentCheckpoints===progress.stateVersions,...binding,...progress,contextsWritten:contexts,agentCheckpoints,elapsedMs:Date.now()-start,usage,error};
 if(!complete.completed)error??='Incomplete spatial run';
 await writeFile(join(out,resume?'complete-recovery-'+Date.now()+'.json':'complete.json'),JSON.stringify({...complete,error},null,2),{flag:'wx'});
 console.log(JSON.stringify(complete));await service.close().catch(()=>{});
}
if(error)throw Error(error);
