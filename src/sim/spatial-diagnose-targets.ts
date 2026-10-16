/** Two fixed-context diagnostic windows only; no database writes or chain propagation. */
import { mkdir,readdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { spatialV2Vlm } from '../agent/spatial-v2-vlm.js';
const [sourceArg,outputArg,confirm,ablation]=process.argv.slice(2);
if(!sourceArg||!outputArg||confirm!=='--confirm-paid')throw Error('Usage: spatial-diagnose-targets SOURCE-run NEW-output --confirm-paid');
const source=resolve(sourceArg),output=resolve(outputArg);await mkdir(output,{recursive:false});
const selected=[];
for(const dir of await readdir(join(source,'requests'))){const data=JSON.parse(await readFile(join(source,'requests',dir,'input.json'),'utf8'));if(data.batch.some((r:{id:string})=>r.id.endsWith('-001000')||r.id.endsWith('-001160')))selected.push({directory:dir,data});}
if(selected.length!==2)throw Error('Expected exactly two fixed diagnostic windows');
const results=[];
for(const {directory,data} of selected){
 if(ablation==='--duplicate-ablation'&&!data.batch.some((r:{id:string})=>r.id.endsWith('-001160')))continue;
 if(ablation==='--duplicate-ablation'){
  const summaries=new Set<string>();data.history.nodes=data.history.nodes.filter((n:{summary:string})=>{const text=n.summary.trim();if(summaries.has(text))return false;summaries.add(text);return true;});
 }
 const log=join(output,directory);const answer=await spatialV2Vlm(log)(data.batch,data.history);
 const historical=data.history.nodes.map((n:{id:string})=>n.id);
 results.push({sourceDirectory:directory,targets:data.batch.map((r:{id:string})=>r.id),historicalIds:historical,answer});
 await writeFile(join(output,'results.json'),JSON.stringify(results,null,2));
}
let calls=0,input=0,out=0;
for(const {sourceDirectory:directory} of results)for(const request of await readdir(join(output,directory)))for(const file of await readdir(join(output,directory,request)))if(/^response-\d+\.json$/.test(file)){
 const value=JSON.parse(await readFile(join(output,directory,request,file),'utf8'));const usage=value.response.usage;
 if(!usage)throw Error('No usage available');calls++;input+=usage.prompt_tokens;out+=usage.completion_tokens;
}
await writeFile(join(output,'usage.json'),JSON.stringify({calls,inputTokens:input,outputTokens:out,estimatedCost:null,scope:ablation==='--duplicate-ablation'?'One fixed window, corrected wording + duplicate-summary candidate removed; diagnostic only, not safe automatic identity merging.':'Two fixed original contexts, changed reference wording only; not an independent or repeated statistical evaluation.'},null,2));
console.log(JSON.stringify({calls,inputTokens:input,outputTokens:out,assignments:results.map(r=>r.answer.assignments)}));
