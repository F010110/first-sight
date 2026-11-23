import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {imageIndexPlaceMatcher,ulvnPlaceMatcher} from '../../assistant/spatial-memory/visual-revisit.js';
import type {RevisitImage,RevisitMatchResult} from '../../assistant/spatial-memory/revisit-candidates.js';

const [dest]=process.argv.slice(2);
if(!dest||!process.env.ULVN_PYTHON)throw Error('Usage: set ULVN_PYTHON; probe-ulvn-operating-range NEW-OUTPUT (local models only)');
const out=resolve(dest);await mkdir(out,{recursive:false});
const raw=await readFile('run/unioncity-batch40-realtime813-v1-grounded-review-v1/bundle.json');
const sampleRaw=await readFile('run/gmod-annotated-rerender-v2-final/sample-human-confirmed.json');
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const bundle=JSON.parse(raw.toString()),sample=JSON.parse(sampleRaw.toString());
if(hash(sampleRaw)!==bundle.hashes.reference)throw Error('Map/reference binding mismatch');
const observations=new Map<number,any>(bundle.observations.map((o:any)=>[Number(o.id.slice(-6)),o]));
const frames=new Map<number,any>(sample.frames.map((f:any)=>[Number(f.id.slice(-6)),f]));
const images=(n:number):RevisitImage[]=>observations.get(n).views.map((v:any)=>({...v,id:observations.get(n).id}));
const referenceId=(n:number)=>'reference-'+String(n).padStart(6,'0');
const pairSpecs=[
 {name:'hardware-return',q:380,h:65,category:'near-position-return',development:true},
 {name:'hardware-interior-return',q:388,h:68,category:'near-position-return',development:false},
 {name:'park-return',q:220,h:138,category:'near-position-return',development:false},
 {name:'rotation-at-entrance',q:325,h:324,category:'near-position-rotation',development:true},
 {name:'distinct-intersections',q:680,h:100,category:'distinct-location-alias',development:true},
 {name:'distinct-street-segments',q:680,h:440,category:'distinct-location-alias',development:true},
 {name:'distinct-theatre-corner',q:660,h:580,category:'distinct-location-alias',development:true},
 {name:'hardware-inside-outside',q:388,h:380,category:'occupancy-boundary',development:false},
 {name:'brick-shop-inside-outside',q:300,h:280,category:'occupancy-boundary',development:false},
 {name:'alley-to-lower-stairs',q:340,h:320,category:'occupancy-boundary',development:true},
];
const archive=[...new Set([...Array.from({length:41},(_,i)=>1+i*20),65,68,108,138])].sort((a,b)=>a-b);
const queries=[220,360,378,388,660,680,780,813];
const cases=[...pairSpecs.map(p=>({kind:'pair',name:p.name,q:p.q,history:[p.h],category:p.category,development:p.development})),
 ...queries.map(q=>({kind:'retrieval',name:'prefix-'+q,q,history:archive.filter(h=>h<=q-60),category:'causal-prefix-retrieval',development:[660,680,378].includes(q)}))];
const distances=(q:number,h:number)=>{
 const a=frames.get(q).position,b=frames.get(h).position;
 return {xy:Math.hypot(a[0]-b[0],a[1]-b[1]),dz:Math.abs(a[2]-b[2])};
};
// Labels stay in the experiment plan/report. The worker receives images and anonymous refs only.
await writeFile(join(out,'plan.json'),JSON.stringify({bundleSHA256:hash(raw),mapSHA256:hash(sampleRaw),cases,archive,repetitions:2,paidCalls:0,
 task:'ULVN-inspired frontend operating range, not full RAVEL/BPL or semantic place grouping',
 protocol:'Three current cameras and three cameras per reference. Pair trials verify all nine direction combinations in both backends. Retrieval uses identical causal archive, >=60-observation separation. Repeat is cache timing, not independent accuracy.',
 labels:'Physical near-position sensitivity at 100/200/400 source XY units, dz<=48. These are evaluation radii, not semantic region definitions. Boundary pairs evaluated separately; shared surfaces need not mean shared occupied region.',
 restrictions:'No map/positions/annotations, Agent place IDs, questions, or previous VLM answers supplied to matchers. No threshold tuning, no VLM inference, no production default change.',
 selection:'Fixed diagnostic cases; marked development cases appeared in earlier tuning. Additional cases are unoptimized within this test, not an independent dataset. Timing includes real backend workload and CPU/GPU differences.',
 pairTruth:pairSpecs.map(p=>({...p,...distances(p.q,p.h)}))},null,2),{flag:'wx'});
const checked=new Set<string>();
for(const c of cases)for(const image of [c.q,...c.history].flatMap(images))if(!checked.has(image.path)){
 if(hash(await readFile(image.path))!==image.sha256)throw Error('Original image changed');checked.add(image.path);
}
function rank(result:RevisitMatchResult,mode:'geometry'|'global'){
 const best=new Map<string,any>();
 for(const entry of result.results){
  const key=entry.placeId,prior=best.get(key);
  const score:[number,number]=mode==='geometry'?[entry.inliers??0,entry.similarity??0]:[entry.similarity??0,entry.inliers??0];
  if(!prior||score[0]>prior.score[0]||score[0]===prior.score[0]&&score[1]>prior.score[1])best.set(key,{entry,score});
 }
 return [...best].sort((a,b)=>b[1].score[0]-a[1].score[0]||b[1].score[1]-a[1].score[1]||a[0].localeCompare(b[0])).map(([id,v])=>({id,...v.entry}));
}
const records:any[]=[];
for(const backend of ['legacy','ulvn']){
 const matcher=backend==='ulvn'?ulvnPlaceMatcher({imagesPerPlace:3,timeoutMs:300000}):imageIndexPlaceMatcher(undefined,{imagesPerPlace:3,shortlistPlaces:100,siftImagesPerPlace:3,minInliers:0,timeoutMs:120000});
 try{for(let repeat=0;repeat<2;repeat++)for(const c of cases){
  const current=images(c.q),candidates=c.history.flatMap(h=>images(h).map(image=>({placeId:referenceId(h),image})));
  const started=performance.now(),result=await matcher.match(current,candidates),elapsedMs=performance.now()-started;
  const geometry=rank(result,'geometry'),global=rank(result,'global');
  const best=result.best;
  const bestPair=best?{current:current.find(i=>i.path===best.queryPath),historical:candidates.find(x=>x.placeId===best.placeId&&x.image.path===best.path)?.image}:null;
  const retrieval=c.kind==='retrieval'?[100,200,400].map(radius=>{
   const positiveRefs=c.history.filter(h=>{const d=distances(c.q,h);return d.xy<=radius&&d.dz<=48;}).map(referenceId);
   const evaluate=(ranking:any[])=>positiveRefs.length?[1,3,5].map(k=>({k,hit:ranking.slice(0,k).some(r=>positiveRefs.includes(r.id))})):null;
   return {radius,positiveRefs,geometry:evaluate(geometry),global:evaluate(global)};
  }):null;
  const record={backend,repeat,...c,elapsedMs,result,geometry,global,bestPair,retrieval};records.push(record);
  await writeFile(join(out,`${backend}-${c.name}-${repeat}.json`),JSON.stringify(record,null,2),{flag:'wx'});
  console.log(JSON.stringify({backend,repeat,name:c.name,ok:result.ok,elapsedMs,inliers:best?.inliers??null,similarity:best?.similarity??null,bestReference:best?.placeId??null,error:result.error??null}));
  if(!result.ok)throw Error('Backend unavailable; preserved partial records, no silent fallback');
  if(c.kind==='pair'){
   const pairs=backend==='ulvn'?result.stats?.geometryPairs:result.stats?.siftPairs;
   if(pairs!==9)throw Error('Pair test did not verify all nine direction combinations');
  }
 }}finally{await matcher.close?.();}
}
await writeFile(join(out,'report.json'),JSON.stringify({completed:records.length===72,records,limitations:['Frontend-only; no semantic grouping or full ULVN/BPL certification','Same physical vicinity does not imply identical occupied semantic region','Development cases and curated reference coverage, no unbiased generalization claim','Scores/inliers are not calibrated probabilities; do not adopt test-derived thresholds']},null,2),{flag:'wx'});
