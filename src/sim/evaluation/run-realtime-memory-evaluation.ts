import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createThreeAgentService} from '../../assistant/three-agent-factory.js';
import {RealtimeSpatialContext} from '../../assistant/harness/realtime-spatial-context.js';
import {boundJSON,digest,pipelineSources,sequenceLayout,type PipelinePlan} from './spatial-evaluation-pipeline.js';

const [standardArg,outArg,confirm]=process.argv.slice(2);
if(!standardArg||!outArg||confirm!=='--confirm-paid')throw Error('Usage: run-realtime-memory-evaluation FROZEN-STANDARD NEW-OUTPUT --confirm-paid');
const standard=resolve(standardArg),out=resolve(outArg),frozen=JSON.parse(await readFile(join(standard,'frozen.json'),'utf8'));
if(frozen.schema!=='reviewed-position-freeze-v1'||!frozen.complete||frozen.pendingHumanReview!==0)throw Error('Require frozen reviewed positions');
for(const [path,hash] of Object.entries(frozen.hashes))await boundJSON(join(standard,path),hash as string);
const input=await boundJSON(frozen.inputPath,frozen.inputSHA256);
if(input.observations.length!==813)throw Error('Require original813');
const plan:PipelinePlan={schema:'spatial-evaluation-plan-v1',inputPath:frozen.inputPath,inputSHA256:frozen.inputSHA256,mode:'fresh-sequence',observationIds:input.observations.map((r:any)=>r.id),probeIds:[],requireContiguous:true,maxInferenceCalls:1200,maxReviewCalls:222,reviewSpecPath:join(standard,'evaluation-only/standard.json'),reviewSpecSHA256:frozen.hashes['evaluation-only/standard.json']};
const {rows,selected}=await pipelineSources(plan);
await mkdir(out,{recursive:false});const planBytes=JSON.stringify(plan,null,2);await writeFile(join(out,'plan.json'),planBytes);
await writeFile(join(out,'manifest.json'),JSON.stringify({schema:'spatial-pipeline-manifest-v1',planSHA256:digest(planBytes),mode:plan.mode,sampling:sequenceLayout(rows.map(r=>r.id),plan.observationIds),coldStart:true,inferenceRows:selected,producer:'original-three-agent-realtime-fact-first',extractionMax:2,batchMax:1,sourcePaced:false,limitations:['Accelerated input replay through original persistent real-time scheduler; not a source-clock latency test','Facts are not a certified global place map','Position standard remains evaluation-only; no per-frame visual relabeling']},null,2));
const context=new RealtimeSpatialContext(join(out,'spatial'),plan.observationIds),started=Date.now();
let reported=0;
const service=await createThreeAgentService(join(out,'three-agent'),true,{parallelMemory:true,continuousCurrent:false,extractionMax:2,batchMax:1,maxExtractionCalls:600,extractionMaxUSD:5,afterMemoryCommit:async store=>{await context.synchronize(store);if(context.versions.length-reported>=25){reported=context.versions.length;console.log(JSON.stringify({stage:'realtime-progress',committed:reported,planned:813,elapsedMs:Date.now()-started,progress:store.progress()}));}}});
let failure:string|null=null;
try{
 // The production factory starts paused until explicit capture authorization.
 // This paid replay is the capture owner; use the same resume transition as capture.start.
 service.resume();
 for(const row of selected){
  // Bound input backlog while leaving both resident extraction workers occupied.
  while(service.store.progress().unfinished>8){if(context.failure)throw Error(context.failure);if(Date.now()-started>30*60*1000)throw Error('Observation processing exceeded30 minute budget');await sleep(100);}
  await service.observe({id:row.id,atMs:row.atMs,frames:row.views.map(v=>v.path)});
 }
 await service.finishInput();if(context.failure)throw Error(context.failure);
}catch(error){failure=String(error);}finally{await service.shutdown();}
const processingMs=Date.now()-started;
for(const row of selected){const version=context.versions.find(v=>v.observationId===row.id);let checkpoint:any=null;
 if(version){const snapshot=context.snapshotAt(version),record=snapshot.results.at(-1)!;checkpoint={...version,update:{summary:record.result.summary,observations:record.result.facts.map(f=>f.text)}};}
 await appendFile(join(out,'observations.jsonl'),JSON.stringify({id:row.id,status:checkpoint?'completed':'failed',checkpoint,error:checkpoint?null:failure??'No committed context publication'})+'\n');
}
const completed=!failure&&context.versions.length===813;
await writeFile(join(out,'inference-complete.json'),JSON.stringify({completed,planned:813,committed:context.versions.length,processingMs,error:failure,observationsSHA256:digest(await readFile(join(out,'observations.jsonl')))}));
console.log(JSON.stringify({stage:'observation-processing-complete',completed,committed:context.versions.length,processingMs}));
if(!completed)throw Error(failure??'Incomplete real-time replay');
await writeFile(join(out,'timing.json'),JSON.stringify({processingMs,questionAndScoringMs:null,totalMs:Date.now()-started,spatialIdentityScore:'Pending separate spatial memory scoring',nextStage:'Spatial scoring and result review; user-question tests are not automatically authorized'},null,2));
