import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {SpatialMemoryService} from '../../assistant/spatial-memory/service.js';
import {spatialPerceptionModel} from '../../assistant/spatial-memory/models.js';
import {createPiSpatialReasoner} from '../../assistant/spatial-memory/pi-reasoner.js';
import {spatialJsonVlm} from '../../agent/spatial-json-vlm.js';
import type {Observation} from '../../assistant/spatial-memory/contracts.js';

// Production reconstruction entry: no annotation bundle, judge, or user questions.
const [inputArg,outArg,confirm,...flags]=process.argv.slice(2);
if(!inputArg||!outArg||confirm!=='--confirm-paid')throw Error('Usage: run-spatial-memory PUBLIC-INPUT NEW-OUTPUT --confirm-paid [--resume] [--limit=N]');
const resume=flags.includes('--resume'),limitArg=flags.find(f=>f.startsWith('--limit=')),limit=limitArg?Number(limitArg.split('=')[1]):undefined;
if(flags.some(f=>!['--resume'].includes(f)&&!f.startsWith('--limit='))||limitArg&&(!Number.isInteger(limit)||limit!<1))throw Error('Invalid runner flag');
const raw=await readFile(inputArg),input=JSON.parse(raw.toString()),out=resolve(outArg);
if(input.schema!=='spatial-public-input-v1'||!Array.isArray(input.observations)||!input.observations.length)throw Error('Require original public input');
const all:Observation[]=input.observations.map((r:any)=>({id:r.id,atMs:r.atMs,views:r.views.map((v:any)=>({id:r.id,direction:v.direction,path:v.path,sha256:v.sha256}))}));
if(new Set(all.map(r=>r.id)).size!==all.length||all.some((r,i)=>!Number.isFinite(r.atMs)||r.atMs<0||i>0&&r.atMs<=all[i-1]!.atMs))throw Error('Invalid chronological public source');
const rows=limit?all.slice(0,limit):all;
if(!resume)await mkdir(out,{recursive:false});
const start=Date.now();
const reasoner=await createPiSpatialReasoner(join(out,'pi'),spatialJsonVlm(join(out,'pi-requests'),8000,8,true,1600),{resume});
const service=await SpatialMemoryService.create(out,spatialPerceptionModel(out),{reasoner,resume,maxPending:24,extractionConcurrency:2,maxReasonCalls:8});
if(!resume)await writeFile(join(out,'manifest.json'),JSON.stringify({schema:'spatial-memory-run-v1',inputSHA256:createHash('sha256').update(raw).digest('hex'),planned:rows.length,sourcePlanned:all.length,producer:'spatial-memory-pi-v1',agent:'pi-spatial-memory-v2',spatialAssessmentRequired:true,context:'independent-bounded-working-memory',longTerm:'transactional-spatial-sqlite',extractionConcurrency:2,maxReasonCalls:8,maxPending:24,questions:false,judge:false,resume:false},null,2),{flag:'wx'});
const timer=setInterval(()=>console.log(JSON.stringify({stage:'spatial-memory',elapsedMs:Date.now()-start,...service.progress()})),10000);timer.unref();
let error:string|null=null;
try{
 if(resume)await service.resumePending();
 for(const row of rows){
  if(service.knows(row.id))continue;
  while(service.progress().pending>=24){if(service.progress().failure)throw Error(service.progress().failure!);await new Promise(r=>setTimeout(r,100));}
  await service.observe(row);
 }
 await service.finishInput();
}catch(e){error=String(e);}finally{
 clearInterval(timer);const progress=service.progress();await mkdir(join(out,'contexts'),{recursive:true});
 let contexts=0;
 for(let version=1;version<=progress.spatialStates;version++){
  const snapshot=service.snapshotAt(version,Number.MAX_SAFE_INTEGER),path=join(out,'contexts',String(version).padStart(4,'0')+'.json');
  try{await writeFile(path,JSON.stringify({schema:'spatial-state-context-v1',state:snapshot.state,context:snapshot.context},null,2),{flag:'wx'});contexts++;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;contexts++;}
 }
 const usage=await Promise.all(['perception-requests','pi-requests'].map(async lane=>{try{return {lane,...JSON.parse(await readFile(join(out,lane,'usage.json'),'utf8'))};}catch{return {lane,missing:true};}}));
 let agentCheckpoints=0;try{agentCheckpoints=(await readFile(join(out,'pi','pi-checkpoints.jsonl'),'utf8')).trim().split('\n').filter(Boolean).length;}catch{}
 const complete={schema:'spatial-memory-complete-v1',completed:!error&&progress.spatialStates===rows.length&&progress.pending===0&&contexts===rows.length,planned:rows.length,sourcePlanned:all.length,...progress,contextsWritten:contexts,agentCheckpoints,elapsedMs:Date.now()-start,usage,error};
 await writeFile(join(out,'complete.json'),JSON.stringify(complete,null,2),{flag:resume?'w':'wx'});
 console.log(JSON.stringify(complete));await service.close().catch(()=>{});
}
if(error)throw Error(error);
