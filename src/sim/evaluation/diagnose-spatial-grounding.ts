import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spatialJsonVlm} from '../../agent/spatial-json-vlm.js';

const [outArg,confirm]=process.argv.slice(2);
if(!outArg||confirm!=='--confirm-paid')throw Error('Usage: diagnose-spatial-grounding NEW-OUTPUT --confirm-paid');
const out=resolve(outArg),sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const inputPath='run/unioncity-questions90-v2-run1/input.json',raw=await readFile(inputPath),input=JSON.parse(raw.toString());
const roots=['run/unioncity-pi-spatial-replay-v1','run/unioncity-pi-spatial-state-prefix90-v2'];
const {readdir}=await import('node:fs/promises');
const requests=new Map<string,any>();
for(const root of roots)for(const entry of await readdir(join(root,'requests'),{withFileTypes:true})){
 if(!entry.isDirectory())continue;
 let data:any;try{data=JSON.parse(await readFile(join(root,'requests',entry.name,'input.json'),'utf8'));}catch{continue;}
 if(data.data?.role==='pi-harness'&&data.images?.length===3&&[71,90,164,180,793].some(n=>data.data.current.id===`rerender-v2-${String(n).padStart(6,'0')}`))requests.set(data.data.current.id,{input:data,path:join(root,'requests',entry.name,'input.json')});
}
const baseline=JSON.parse(await readFile('run/unioncity-pi-spatial-replay-v1/requests/0000/input.json','utf8')).prompt;
const skill=await readFile('skills/diagnostics/spatial-memory-ablation/SKILL.md','utf8');
const section=(name:string)=>skill.split(`## ${name}\n`)[1]!.split('\n## ')[0]!.trim();
const conditions=[
 {name:'no-history-triplet',history:false,triplet:true,prompt:'baseline'},
 {name:'history-triplet',history:true,triplet:true,prompt:'baseline'},
 {name:'no-history-front',history:false,triplet:false,prompt:'baseline'},
 {name:'history-front',history:true,triplet:false,prompt:'baseline'},
 {name:'history-triplet-neutral',history:true,triplet:true,prompt:'neutral'},
 {name:'history-triplet-conditional',history:true,triplet:true,prompt:'conditional'}];
const cases=[71,90,164,180,793].map(n=>{const id=`rerender-v2-${String(n).padStart(6,'0')}`,saved=requests.get(id);if(!saved)throw Error('Missing actual input '+id);return {id,n,row:input.observations.find((r:any)=>r.id===id),saved};});
await mkdir(out,{recursive:false});await mkdir(join(out,'frozen-inputs'));
await writeFile(join(out,'plan.json'),JSON.stringify({schema:'spatial-grounding-ablation-v1',sourceInputSHA256:sha(raw),cases:cases.map(c=>({id:c.id,index:c.n,actualHistoryInput:c.saved.path})),conditions,repeats:2,plannedCalls:60,scope:'Same original images, model, output budget and literal task; history/image/prompt ablations. No user questions or answer labels sent. Repeats at temperature zero assess stability only, not independent statistical evidence.',prompts:{baselineSHA256:sha(baseline),diagnosticSkillSHA256:sha(skill)},maxCalls:60,maxEstimatedUSD:5},null,2));
const request=spatialJsonVlm(join(out,'requests'),60,5,true,1600);
let index=0;
for(const c of cases){
 const frozen=JSON.stringify(c.saved.input,null,2);await writeFile(join(out,'frozen-inputs',c.id+'.json'),frozen);
 for(const condition of conditions)for(let repeat=0;repeat<2;repeat++){
  const prompt=condition.prompt==='baseline'?baseline:section(condition.prompt);
  const images=condition.triplet?c.saved.input.images:c.saved.input.images.filter((i:any)=>i.direction==='front');
  const messages=condition.history?structuredClone(c.saved.input.data.messages):[];
  const start=Date.now();let output:unknown=null,error:string|null=null;
  try{output=await request({phase:'identity',prompt,data:{current:c.saved.input.data.current,role:'spatial-diagnostic',messages,tools:c.saved.input.data.tools},images});}catch(e){error=String(e);}
  const result={index:index++,id:c.id,condition:condition.name,repeat,historyMessages:messages.length,imageDirections:images.map((i:any)=>i.direction),promptSHA256:sha(prompt),output,error,elapsedMs:Date.now()-start};
  await appendFile(join(out,'results.jsonl'),JSON.stringify(result)+'\n');
  console.log(JSON.stringify({index:result.index,id:c.id,condition:condition.name,repeat,error}));
 }
}
await writeFile(join(out,'complete.json'),JSON.stringify({settled:index,planned:60}));
