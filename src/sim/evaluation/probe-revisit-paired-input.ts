import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {imageIndexPlaceMatcher} from '../../assistant/spatial-memory/visual-revisit.js';
import {summarizeRevisitRecall,revisitProjection,selectRevisitImagePairs,type RevisitPlace} from '../../assistant/spatial-memory/revisit-candidates.js';
import {spatialJsonVlm} from '../../agent/spatial-json-vlm.js';
const [runArg,outArg,confirm]=process.argv.slice(2);
if(!runArg||!outArg||confirm!=='--confirm-paid')throw Error('Usage: probe-revisit-paired-input RUN NEW-OUTPUT --confirm-paid');
const run=resolve(runArg),out=resolve(outArg);await mkdir(out,{recursive:false});
const bundle=JSON.parse(await readFile(join(run+'-grounded-review-v1','bundle.json'),'utf8'));
const matcher=imageIndexPlaceMatcher(undefined,{imagesPerPlace:24,siftImagesPerPlace:4,shortlistPlaces:100,timeoutMs:120000});
const request=spatialJsonVlm(join(out,'requests'),18,1,true,2000,{thinkingBudget:128});
try{for(const slot of ['0022','0025','0051']){
 const original=JSON.parse(await readFile(join(run,'pi-requests',slot,'input.json'),'utf8')),rt=original.data.runtimeContext;
 const ids=rt.batch.observations.map((o:any)=>o.id),rows=ids.map((id:string)=>bundle.observations.find((o:any)=>o.id===id));
 const firstIndex=bundle.observations.findIndex((o:any)=>o.id===ids[0]);
 const before=new Set(bundle.observations.slice(0,firstIndex).map((o:any)=>o.id));
 const history=bundle.states.filter((s:any)=>s.memberIds.every((id:string)=>before.has(id)));
 const groups=new Map<string,any[]>();for(const s of history){const id=s.assessment.location.placeId;if(id&&id!==rt.previousRegion?.placeId){const list=groups.get(id)??[];list.push(s);groups.set(id,list);}}
 const places:RevisitPlace[]=[...groups].map(([placeId,states])=>{const all=[...new Set<string>(states.flatMap(s=>s.memberIds))],count=Math.min(24,all.length),picks=Array.from({length:count},(_,i)=>all[Math.round(i*(all.length-1)/Math.max(1,count-1))]);return {placeId,name:states.at(-1).assessment.location.name,members:picks.flatMap(id=>{const o=bundle.observations.find((o:any)=>o.id===id);return o.views.map((v:any)=>({observationId:o.id,atMs:o.atMs,...v}));})};});
 const current=rows.flatMap((o:any)=>o.views),matched=await matcher.match(current,places.flatMap(p=>p.members.map(m=>({placeId:p.placeId,image:{id:m.observationId,...m}}))));
 if(!matched.ok)throw Error(matched.error);
 const recall=summarizeRevisitRecall(places,rt.previousRegion?.placeId??null,matched,20,current),updated=structuredClone(original);
 updated.data.runtimeContext.revisit=revisitProjection(recall);
 for(const pairBudget of [2,3,5]){
 const pairs=selectRevisitImagePairs(recall,ids,pairBudget);
 const images:any[]=[];for(const p of pairs)for(const image of [p.current,p.historical])if(!images.some(v=>v.path===image.path))images.push(image);
 for(const o of [rows[0],rows.at(-1)]){const image=o.views.find((v:any)=>v.direction==='front');if(image&&!images.some(v=>v.path===image.path))images.push(image);}
 updated.images=images;updated.data.runtimeContext.inspectedIds=[...new Set(images.map(v=>v.id))];updated.data.runtimeContext.deliveredIds=[...new Set([...(rt.deliveredIds??[]),...images.map(v=>v.id)])];
 updated.data.runtimeContext.batch.preloadedImageIds=images.map(v=>v.id);updated.data.runtimeContext.batch.preloadNote='Matched current/historical image pairs are already delivered and inspected. Compare each relevant segment; cite supporting old observation IDs in sourceIds. Direction labels are actual cameras, not required to be equal. Scores only select evidence, never confirm identity. Continuity at the start does not decide the whole batch.';
 updated.prompt+='\nMatched-pair update: runtimeContext.revisit.candidates[].matchedPair identifies the exact current and historical camera images. Inspect the supplied pairs before claiming continuation/new/revisit for each segment. Preloaded pairs are already inspected. A middle-batch return must not be swallowed by continuity at the start. Do not infer identity from a remote landmark alone.';
 await writeFile(join(out,slot+'-pairs'+pairBudget+'-matching.json'),JSON.stringify({queryIds:ids,candidates:recall.candidates,stats:matched.stats},null,2),{flag:'wx'});
 updated.prompt=original.prompt+'\nMatched pairs below are delivered and inspected; evaluate relevant segments separately, not only continuity at batch start. Use historical IDs in sourceIds only when supported.\nSelected evidence pairs: '+JSON.stringify(pairs.map(p=>({placeId:p.placeId,channel:p.channel,current:{id:p.current.id,direction:p.current.direction},historical:{id:p.historical.id,direction:p.historical.direction}})));
 const treatment=await request(updated);
 await writeFile(join(out,slot+'-pairs'+pairBudget+'-comparison.json'),JSON.stringify({originalRequest:join(run,'pi-requests',slot,'input.json'),scope:'Frozen single-request counterfactual; same prior context, no tools executed or state committed; not end-to-end recall',pairBudget,pairs,images,treatment},null,2),{flag:'wx'});
 console.log(JSON.stringify({slot,pairBudget,imageCount:images.length,treatment}));
 }
}}finally{await matcher.close?.();}
