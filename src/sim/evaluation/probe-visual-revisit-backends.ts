import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {imageIndexPlaceMatcher,ulvnPlaceMatcher} from '../../assistant/spatial-memory/visual-revisit.js';
import {summarizeRevisitRecall,type RevisitPlace} from '../../assistant/spatial-memory/revisit-candidates.js';
import {sha} from './holistic-memory-bundle.js';
const [bundleArg,outArg]=process.argv.slice(2);
if(!bundleArg||!outArg)throw Error('Usage: probe-visual-revisit-backends BUNDLE NEW-OUTPUT (local models only; no paid VLM)');
const raw=await readFile(bundleArg),bundle=JSON.parse(raw.toString()),out=resolve(outArg);
await mkdir(out,{recursive:false});
const inputs:any[]=[];
for(const start of [321,361,661]){
 const index=bundle.observations.findIndex((o:any)=>Number(o.id.slice(-6))===start),rows=bundle.observations.slice(index,index+20),prefix=new Set(bundle.observations.slice(0,index).map((o:any)=>o.id));
 const states=bundle.states.filter((s:any)=>s.memberIds.every((id:string)=>prefix.has(id))),previous=states.at(-1)?.assessment.location.placeId??null;
 const grouped=new Map<string,any[]>();for(const s of states){const p=s.assessment.location.placeId;if(p&&p!==previous){const list=grouped.get(p)??[];list.push(s);grouped.set(p,list);}}
 const places:RevisitPlace[]=[...grouped].map(([placeId,ss])=>{const picks=Array.from({length:Math.min(8,ss.length)},(_,i)=>ss[Math.round(i*(ss.length-1)/Math.max(1,Math.min(8,ss.length)-1))]);return {placeId,name:ss.at(-1).assessment.location.name,members:picks.flatMap(s=>{const o=bundle.observations.find((o:any)=>o.id===s.observationId);return o.views.map((v:any)=>({observationId:o.id,atMs:s.atMs,...v}));})};});
 inputs.push({start,rows,previous,places});
}
await writeFile(join(out,'plan.json'),JSON.stringify({bundleSHA256:sha(raw),caseStarts:inputs.map(i=>i.start),historicalSampling:'Same causal prefix, same <=8 state-tail observations per place supplied to both backends; six historical images per place selected by shared sampler',querySampling:'All 20 current observations, all three cameras',runs:'Each backend runs all cases twice: cold/process-first plus warm repeats',maxModelPaidCalls:0,metricsPreserved:'Existing event precision/recall, false merges/new, latency and cost definitions unchanged; this frontend-only probe does not produce system recall or semantic precision.'},null,2),{flag:'wx'});
const records:any[]=[];
for(const backend of ['legacy','ulvn']){
 const matcher=backend==='ulvn'?ulvnPlaceMatcher({imagesPerPlace:6,timeoutMs:300000}):imageIndexPlaceMatcher(undefined,{imagesPerPlace:6,shortlistPlaces:100,siftImagesPerPlace:2,minInliers:0,timeoutMs:120000});
 try{for(let repeat=0;repeat<2;repeat++)for(const input of inputs){
  const current=input.rows.flatMap((o:any)=>o.views),candidates=input.places.flatMap((p:RevisitPlace)=>p.members.map(m=>({placeId:p.placeId,image:{id:m.observationId,...m}}))),started=performance.now();
  const result=await matcher.match(current,candidates),elapsedMs=performance.now()-started;
  const recall=summarizeRevisitRecall(input.places,input.previous,result,20,current);
  const record={backend,start:input.start,repeat,elapsedMs,result,recall};records.push(record);
  await writeFile(join(out,`${backend}-${input.start}-${repeat}.json`),JSON.stringify(record,null,2),{flag:'wx'});
  console.log(JSON.stringify({backend,start:input.start,repeat,ok:result.ok,elapsedMs,candidates:recall.candidates.length,error:result.error??null}));
  if(!result.ok)break;
 }}finally{await matcher.close?.();}
}
await writeFile(join(out,'report.json'),JSON.stringify({completed:records.length===12&&records.every(r=>r.result.ok),records,limitations:['Local candidate/geometry diagnostics, not VLM or place-identity certification','Same image coverage, different bounded geometric schedules are recorded in backend stats','Model loading/download included in first wall time; no realtime claim until warm and cold are measured']},null,2),{flag:'wx'});
