import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spatialJsonVlm} from '../../agent/spatial-json-vlm.js';

const [sourceArg,outArg,confirm]=process.argv.slice(2);
if(!sourceArg||!outArg||confirm!=='--confirm-paid')throw Error('Usage: diagnose-spatial-grounded-update DIAGNOSTIC-RUN NEW-OUTPUT --confirm-paid');
const source=resolve(sourceArg),out=resolve(outArg),plan=JSON.parse(await readFile(join(source,'plan.json'),'utf8'));
const skill=await readFile('skills/diagnostics/spatial-memory-ablation/SKILL.md','utf8'),section=(name:string)=>skill.split(`## ${name}\n`)[1]!.split('\n## ')[0]!.trim();
await mkdir(out,{recursive:false});
await writeFile(join(out,'plan.json'),JSON.stringify({schema:'spatial-grounded-update-diagnostic-v1',cases:plan.cases,conditions:['full-history','short-history','short-source-only-history'],repeats:2,plannedCalls:45,scope:'Same five sources; independent per-direction perception then controlled history projections. No user questions, private labels or target answers supplied.'},null,2));
const request=spatialJsonVlm(join(out,'requests'),45,5,true,1600);
for(const c of plan.cases){
 const saved=JSON.parse(await readFile(join(source,'frozen-inputs',c.id+'.json'),'utf8')),views=[];
 for(const image of saved.images){
  const raw=await request({phase:'perception',prompt:section('single-view'),data:{current:saved.data.current},images:[image]}) as any;
  if(typeof raw.summary!=='string'||!Array.isArray(raw.observations)||raw.observations.some((s:unknown)=>typeof s!=='string'))throw Error('Invalid per-view evidence');
  views.push({direction:image.direction,summary:raw.summary,observations:raw.observations});
 }
 await appendFile(join(out,'per-view-evidence.jsonl'),JSON.stringify({id:c.id,views})+'\n');
 const all=saved.data.messages,short=all.slice(-12),facts:any[]=[];
 for(const message of short){
  if(message.role!=='toolResult'||message.toolName!=='record_context'||message.isError)continue;
  for(const block of message.content??[]){if(block.type!=='text')continue;try{const r=JSON.parse(block.text);if(r.update?.observations)facts.push({role:'historical-observation',observationId:r.observationId,atMs:r.atMs,sourceIds:r.update.sourceIds,observations:r.update.observations});}catch{}}
 }
 for(const [condition,messages] of [['full-history',all],['short-history',short],['short-source-only-history',facts]] as const)for(let repeat=0;repeat<2;repeat++){
  let output:unknown=null,error:string|null=null;
  try{output=await request({phase:'identity',prompt:section('grounded-update'),data:{current:saved.data.current,role:'grounded-spatial-diagnostic',messages,currentEvidence:views},images:[],textOnlyIdentity:true});}catch(e){error=String(e);}
  await appendFile(join(out,'results.jsonl'),JSON.stringify({id:c.id,condition,repeat,messages:messages.length,currentEvidence:views,output,error})+'\n');
  console.log(JSON.stringify({id:c.id,condition,repeat,error}));
 }
}
await writeFile(join(out,'complete.json'),JSON.stringify({planned:45,complete:true}));
