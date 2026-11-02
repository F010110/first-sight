import {readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {loadJSON,digest} from './spatial-evaluation-pipeline.js';

const [outArg]=process.argv.slice(2);
if(!outArg)throw Error('Usage: prepare-position-relations NEW-OUTPUT');
const out=resolve(outArg),root='run/gmod-annotated-rerender-v2-final',samplePath=join(root,'sample.json'),inputPath='run/unioncity-questions90-v2-run1/input.json';
const sampleRaw=await readFile(samplePath),inputRaw=await readFile(inputPath);
const sample=JSON.parse(sampleRaw.toString()),input=JSON.parse(inputRaw.toString());
if(sample.frames.length!==813||input.observations.length!==813||sample.reviewRequired!==false)throw Error('Unexpected base annotation bundle');
const frames=sample.frames,byId=new Map<string,any>(frames.map((f:any)=>[f.id,f]));
const rows=input.observations as any[],byRow=new Map<string,any>(rows.map((r:any)=>[r.id,r]));
if(frames.some((f:any,i:number)=>f.id!==rows[i].id||f.atMs!==rows[i].atMs||!f.annotation?.placeId))throw Error('Position labels do not bind to public input');
const segments=sample.segments as any[];for(const s of segments)s.facilityId=frames[s.startIndex]!.annotation.facilityId;
const placeFrames=new Map<string,number[]>();
for(const f of frames){const p=f.annotation.placeId;if(!placeFrames.has(p))placeFrames.set(p,[]);placeFrames.get(p)!.push(f.index);}
const segmentOf=(index:number)=>segments.find((s:any)=>s.startIndex<=index&&s.endIndex>=index)!;
const caseAt=(id:string,kind:'positive'|'negative'|'ambiguous',a:number,b:number,expected:string,basis:string)=>({
 id,kind,currentId:frames[b].id,referenceId:frames[a].id,currentIndex:b,referenceIndex:a,
 currentAtMs:frames[b].atMs,referenceAtMs:frames[a].atMs,gapMs:frames[b].atMs-frames[a].atMs,
 currentPlace:frames[b].annotation.placeId,referencePlace:frames[a].annotation.placeId,
 currentFacility:frames[b].annotation.facilityId,referenceFacility:frames[a].annotation.facilityId,
 expected,basis,status:'pending-user-review',authority:'Derived from user-reviewed position labels; expected relation not visually re-annotated'
});
const cases:any[]=[];
// Positive revisits: same place id, different visit segment, >=60s apart.
for(const [place,indices] of placeFrames){
 const runs:number[][]=[];for(const index of indices){if(!runs.length||index!==runs.at(-1)!.at(-1)!+1)runs.push([index]);else runs.at(-1)!.push(index);}
 for(let i=0;i<runs.length;i++)for(let j=i+1;j<runs.length;j++){
  const a=runs[i]![0]!,b=runs[j]!.at(-1)!;if(frames[b]!.atMs-frames[a]!.atMs<60000)continue;
  const id=`positive-${place}-${i}-${j}`;
  cases.push(caseAt(id,'positive',a,b,'same-place',`Position labels: both runner-reported regions are ${place}; separated by ${Math.round((frames[b]!.atMs-frames[a]!.atMs)/1000)}s. This is a same-place candidate, not a visual correction of the label.`));
 }
}
// Existing accepted revisits are retained as explicit positive cases.
for(const r of sample.revisits as any[]){if(!cases.some(c=>c.currentIndex===r.returnIndex&&c.referenceIndex===r.firstIndex))cases.push(caseAt(`accepted-${r.id}`,'positive',r.firstIndex,r.returnIndex,'same-place',`Previously accepted revisit annotation: ${r.basis}`));}
// Negative controls: different place, same coarse kind, preferably different facility and shared inventory vocabulary.
const tokenize=(s:string)=>new Set((s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)??[]));
const segTokens=new Map(segments.map((s:any)=>[s.id,tokenize(s.inventory)]));
const similarity=(a:any,b:any)=>{const A=segTokens.get(a.id)!,B=segTokens.get(b.id)!;let n=0;for(const t of A)if(B.has(t))n++;return n;};
const candidates:any[]=[];
for(const a of segments)for(const b of segments){
 if(a.id>=b.id||a.kind!==b.kind||a.placeId===b.placeId||a.facilityId===b.facilityId)continue;
 const ai=a.startIndex,bi=b.endIndex;if(frames[bi]!.atMs-frames[ai]!.atMs<60000)continue;
 candidates.push({a,b,score:similarity(a,b)});
}
candidates.sort((x,y)=>y.score-x.score);
for(const {a,b,score} of candidates.slice(0,16))cases.push(caseAt(`negative-${a.id}-${b.id}`,'negative',a.startIndex,b.endIndex,'different-place',`Position labels: ${a.placeId} and ${b.placeId} are different regions (same coarse kind ${a.kind}); inventory overlap score ${score}. Expected different place; do not merge on generic furnishing.`));
// Ambiguous: same facility but different place id. Relationship may exist, identity must not be asserted.
const byFacility=new Map<string,any[]>();
for(const s of segments){if(!s.facilityId)continue;if(!byFacility.has(s.facilityId))byFacility.set(s.facilityId,[]);byFacility.get(s.facilityId)!.push(s);}
for(const [facility,list] of byFacility){
 for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++)if(list[i].placeId!==list[j].placeId){
  cases.push(caseAt(`ambiguous-${facility}-${list[i].id}-${list[j].id}`,'ambiguous',list[i].startIndex,list[j].endIndex,'related-unknown',`Position labels: both are in facility ${facility}, but different place ids (${list[i].placeId} vs ${list[j].placeId}). A building/path relation may exist, but same-place identity is not established.`));
 }
}
if(new Set(cases.map(c=>c.id)).size!==cases.length)throw Error('Duplicate derived relation id');
const questionBindings=async(path:string,label:string)=>{
 const tasks=JSON.parse((await readFile(join(path,'tasks.json'))).toString()),refs=JSON.parse((await readFile(join(path,'evaluation-only/references.json'))).toString());
 return {label,tasks:refs.length,items:refs.map((r:any)=>{
  const task=tasks.find((t:any)=>t.id===r.id),current=byId.get(task.currentObservationId);
  if(!task||!current||current.atMs!==task.queryAtMs)throw Error('Question current frame mismatch '+r.id);
  const refIds=r.referenceObservations.map((x:any)=>x.id),refFrames=refIds.map((id:string)=>{const f=byId.get(id);if(!f||f.atMs>task.queryAtMs)throw Error('Noncausal question reference '+r.id);return f;});
  return {id:r.id,question:task.question,queryAtMs:task.queryAtMs,currentId:task.currentObservationId,currentPlace:current.annotation.placeId,referenceIds:refIds,referencePlaces:[...new Set(refFrames.map((f:any)=>f.annotation.placeId))],requiresPriorFrame:refFrames.some((f:any)=>f.atMs<task.queryAtMs)};
 })};
};
const q90=await questionBindings('run/unioncity-questions90-v2-freeze','90'),q15=await questionBindings('run/unioncity-repair-pilot-v2-freeze','15');
const coverage={frames:frames.length,segments:segments.length,places:placeFrames.size,positive:cases.filter(c=>c.kind==='positive').length,negative:cases.filter(c=>c.kind==='negative').length,ambiguous:cases.filter(c=>c.kind==='ambiguous').length};
const standard={schema:'position-derived-evaluation-standard-v1',source:{samplePath,sourceSHA256:digest(sampleRaw),publicInputPath:inputPath,publicInputSHA256:digest(inputRaw)},authority:'User-reviewed position labels only; relation labels are mechanically derived and pending review. No per-frame visual facts.',coverage,relations:cases,questions:{q90,q15}};
await mkdir(out,{recursive:false});await mkdir(join(out,'evaluation-only'),{recursive:true});await writeFile(join(out,'evaluation-only/position-derived-standard.json'),JSON.stringify(standard,null,2));
// Reuse the existing oracle-only review server schema. This is relation review, not new visual annotation.
const reviewFrames=frames.map((f:any)=>({...f,views:{front:`/image/${f.id}/front`,left:`/image/${f.id}/left`,right:`/image/${f.id}/right`}}));
const review={...sample,schema:'unioncity-annotation-review-v1',reviewRequired:true,title:'UnionCity · 位置标注派生关系审核',frames:reviewFrames,revisits:cases.map(c=>({id:c.id,kind:c.kind,expected:c.expected,firstIndex:c.referenceIndex,returnIndex:c.currentIndex,placeId:c.kind==='positive'?c.currentPlace:`control-${c.kind}`,status:'pending-user-review',basis:`[${c.kind}] ${c.basis}`,firstMs:c.referenceAtMs,returnMs:c.currentAtMs}))};
await writeFile(join(out,'sample.json'),JSON.stringify(review,null,2));await mkdir(join(out,'reviews'),{recursive:true});
const bindings:Record<string,any>={};const allowedRoot=resolve(root,'model-png');
for(const row of rows)for(const v of row.views)bindings[`${row.id}/${v.direction}`]={path:resolve(v.path),sha256:v.sha256};
await writeFile(join(out,'bindings.json'),JSON.stringify({allowedImageRoot:allowedRoot,bindings},null,2));
for(const layer of sample.map.layers)await copyFile(join(root,`map-${layer.id}.png`),join(out,`map-${layer.id}.png`));
const mapHashes:Record<string,string>={};for(const layer of sample.map.layers)mapHashes[layer.id]=digest(await readFile(join(out,`map-${layer.id}.png`)));
await writeFile(join(out,'integrity.json'),JSON.stringify({sampleSHA256:digest(await readFile(join(out,'sample.json'))),maps:mapHashes},null,2));
const frozen={schema:'position-derived-standard-frozen-v1',out,standardSHA256:digest(await readFile(join(out,'evaluation-only/position-derived-standard.json'))),webBundleSHA256:digest(await readFile(join(out,'sample.json'))),source:{sampleSHA256:digest(sampleRaw),publicInputSHA256:digest(inputRaw)},coverage,pendingHumanReview:cases.length};
await writeFile(join(out,'frozen.json'),JSON.stringify(frozen,null,2));
console.log(JSON.stringify({out,coverage,standardSHA256:frozen.standardSHA256,webBundleSHA256:frozen.webBundleSHA256}));
