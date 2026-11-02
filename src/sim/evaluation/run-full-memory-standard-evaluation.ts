import {readFile,writeFile,mkdir,statfs} from 'node:fs/promises';import {join,resolve,dirname} from 'node:path';
import {loadJSON,digest,boundJSON,runSpatialPipeline,type PipelinePlan} from './spatial-evaluation-pipeline.js';
import {scoreFullMemoryStandard} from './score-full-memory-standard.js';
import {evaluateFullMemoryQuestions} from './full-memory-questions.js';
const [standardArg,outArg,confirm]=process.argv.slice(2);if(!standardArg||!outArg||confirm!=='--confirm-paid')throw Error('Usage: run-full-memory-standard-evaluation FROZEN-STANDARD NEW-OUTPUT --confirm-paid');
const standard=resolve(standardArg),out=resolve(outArg),manifest=await loadJSON(join(standard,'frozen.json'));
if(manifest.schema!=='full-memory-standard-v1'||!manifest.complete||manifest.observations!==813)throw Error('Complete standard must be frozen before inference');
for(const [path,hash] of Object.entries(manifest.bindings))await boundJSON(join(standard,path),hash as string);
const input=await boundJSON(manifest.inputPath,manifest.inputSHA256),free=await statfs(dirname(out));if(free.bavail*free.bsize<20_000_000_000)throw Error('20GB reserve required');
await mkdir(out,{recursive:false});
const plan:PipelinePlan={schema:'spatial-evaluation-plan-v1',inputPath:manifest.inputPath,inputSHA256:manifest.inputSHA256,mode:'fresh-sequence',requireContiguous:true,observationIds:input.observations.map((r:any)=>r.id),probeIds:input.observations.filter((_r:any,i:number)=>(i+1)%16===0).map((r:any)=>r.id),maxInferenceCalls:813*8,maxReviewCalls:813*6,reviewSpecPath:join(standard,'evaluation-only/spatial-structure.json'),reviewSpecSHA256:manifest.bindings['evaluation-only/spatial-structure.json']};
await writeFile(join(out,'inference-plan.json'),JSON.stringify(plan,null,2),{flag:'wx'});
await writeFile(join(out,'plan.json'),JSON.stringify({schema:'full-memory-two-module-evaluation-v1',standard,standardSHA256:digest(await readFile(join(standard,'frozen.json'))),observations:813,questionPilot:15,branches:37,full90:'Conditional on unchanged original gate and audit',model:'qwen3.8-flash',judge:'qwen3.8-max-0902',referenceGenerationBeforeCandidate:true,privateReferencesNeverSentToCandidate:true,scope:'One full continuous candidate spatial run; neutral relation probe on a fixed16-frame cadence, not reference-target routing'},null,2));
try{
 await writeFile(join(out,'progress.json'),JSON.stringify({stage:'spatial-generation',planned:813}));
 const run=await runSpatialPipeline(join(out,'inference-plan.json'),join(out,'candidate'));
 const complete=await loadJSON(join(run,'inference-complete.json'));if(!complete.completed)throw Error('Spatial generation incomplete; preserve failures, do not score missing state as complete');
 await writeFile(join(out,'progress.json'),JSON.stringify({stage:'fixed-spatial-scoring'}));
 const spatial=await scoreFullMemoryStandard(standard,run,join(out,'spatial-score'));
 // User explicitly requested assessment of both modules on the complete run; question quality is diagnostic, not a spatial production-pass claim.
 await writeFile(join(out,'progress.json'),JSON.stringify({stage:'original-question15-branches37'}));
 const questions=await evaluateFullMemoryQuestions(standard,run,join(out,'questions'));
 const report={schema:'full-two-module-scorecard-v1',standardSHA256:digest(await readFile(join(standard,'frozen.json'))),spatial,questions,overallPassed:false,limitations:['Fixed Max-verified silver visual references and accepted structural annotations, not independent human gold','Full90 still subject to original15/37 gate and audit','Spatial content coverage is not global-map, navigation or long-term retrieval accuracy']};
 await writeFile(join(out,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});await writeFile(join(out,'progress.json'),JSON.stringify({stage:'completed',full90Executed:false}));console.log(JSON.stringify(report));
}catch(error){await writeFile(join(out,'blocked.json'),JSON.stringify({error:String(error),scope:'No implicit semantic reruns or partial-success certification'},null,2));throw error;}
