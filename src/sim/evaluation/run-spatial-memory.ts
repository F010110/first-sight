import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {SpatialMemoryService} from '../../assistant/spatial-memory/service.js';
import {spatialMemoryModels} from '../../assistant/spatial-memory/models.js';
import type {Observation} from '../../assistant/spatial-memory/contracts.js';

// Production reconstruction entry: no annotation bundle, judge, or user questions.
const [inputArg,outArg,confirm]=process.argv.slice(2);
if(!inputArg||!outArg||confirm!=='--confirm-paid')throw Error('Usage: run-spatial-memory PUBLIC-INPUT NEW-OUTPUT --confirm-paid');
const raw=await readFile(inputArg),input=JSON.parse(raw.toString()),out=resolve(outArg);
if(input.schema!=='spatial-public-input-v1'||!Array.isArray(input.observations)||!input.observations.length)throw Error('Require original public input');
const rows:Observation[]=input.observations.map((r:any)=>({id:r.id,atMs:r.atMs,views:r.views.map((v:any)=>({id:r.id,direction:v.direction,path:v.path,sha256:v.sha256}))}));
if(new Set(rows.map(r=>r.id)).size!==rows.length||rows.some((r,i)=>!Number.isFinite(r.atMs)||r.atMs<0||i>0&&r.atMs<=rows[i-1]!.atMs))throw Error('Invalid chronological public source');
const start=Date.now(),service=await SpatialMemoryService.create(out,spatialMemoryModels(out));
await writeFile(join(out,'manifest.json'),JSON.stringify({schema:'spatial-memory-run-v1',inputSHA256:createHash('sha256').update(raw).digest('hex'),planned:rows.length,producer:'spatial-memory-rewrite-v1',spatialAssessmentRequired:true,context:'independent-bounded-working-memory',longTerm:'transactional-spatial-sqlite',extractionConcurrency:2,maxReasonCalls:8,questions:false,judge:false},null,2),{flag:'wx'});
const timer=setInterval(()=>console.log(JSON.stringify({stage:'spatial-memory',elapsedMs:Date.now()-start,...service.progress()})),10000);timer.unref();
let error:string|null=null;
try{
 for(const row of rows){while(service.progress().pending>=12){if(service.progress().failure)throw Error(service.progress().failure!);await new Promise(r=>setTimeout(r,100));}await service.observe(row);}
 await service.finishInput();
}catch(e){error=String(e);}finally{
 clearInterval(timer);const progress=service.progress();await mkdir(join(out,'contexts'),{recursive:true});
 for(let version=1;version<=progress.spatialStates;version++){const snapshot=service.snapshotAt(version,Number.MAX_SAFE_INTEGER);await writeFile(join(out,'contexts',String(version).padStart(4,'0')+'.json'),JSON.stringify({schema:'spatial-state-context-v1',state:snapshot.state,context:snapshot.context},null,2),{flag:'wx'});}
 const complete={completed:!error&&progress.spatialStates===rows.length&&progress.pending===0,planned:rows.length,...progress,elapsedMs:Date.now()-start,error};await writeFile(join(out,'complete.json'),JSON.stringify(complete,null,2),{flag:'wx'});await service.close().catch(()=>{});console.log(JSON.stringify(complete));
}
if(error)throw Error(error);
