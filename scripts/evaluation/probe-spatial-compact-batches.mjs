/** Follow-up diagnostic reuses immutable perception from the first probe. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spatialJsonVlm} from '../../dist/current/agent/spatial-json-vlm.js';
const [source,inputArg,out,confirm]=process.argv.slice(2);
if(!source||!inputArg||!out||confirm!=='--confirm-paid')throw Error('Usage: probe-spatial-compact-batches SOURCE PUBLIC-INPUT NEW-OUT --confirm-paid');
await mkdir(out,{recursive:false});
const manifest=JSON.parse(await readFile(join(source,'manifest.json'),'utf8'));
const facts=new Map(),views=new Map();
for(let i=0;i<12;i++){
 const dir=join(source,'perception',String(i).padStart(4,'0'));
 const input=JSON.parse(await readFile(join(dir,'input.json'),'utf8'));
 const response=JSON.parse(await readFile(join(dir,'response.txt'),'utf8'));
 const id=manifest.windows.flat()[i]?.id;
 // Request completion order need not equal timeline order; bind via receipt.
 const match=manifest.windows.flat().find(r=>input.data.current.id===r.id);
 if(!match)throw Error('Missing source binding '+id);
 facts.set(match.id,JSON.parse(response.choices[0].message.content));
}
const publicInput=JSON.parse(await readFile(inputArg,'utf8'));
for(const r of publicInput.observations)if(facts.has(r.id))views.set(r.id,r.views.map(v=>({...v,id:r.id})));
const request=spatialJsonVlm(join(out,'batch'),3,.15,true,1200),results=[];
for(const window of manifest.windows){
 const tail=window.at(-1),begin=performance.now();
 const output=await request({phase:'identity',prompt:'空间微批实验。按时间读取4次观察，每次三摄为同一时刻不同方向。事实已独立保存，不要重复描述细节。仅输出JSON {"assignments":[{"id":"观察ID","region":"a/b或unknown","name":"区域暂名","reason":"不超过60字的视觉依据"}],"changes":[{"atId":"变化观察ID","reason":"不超过60字"}]}。assignments必须严格4项，按输入顺序逐项输出，不能省略。region表示当前实际占据的具体区域，远处可见店面不是已经进入；相似装修不认证同地，视角变化也不自动拆成新区域。证据不足用unknown。不得虚构行走/驾车动作。早帧解释由整个批次形成，不能宣称早帧当时已知。',data:{current:{id:tail.id,atMs:tail.atMs},observations:window.map(r=>({...r,facts:facts.get(r.id)})),knowledgeCutoffMs:tail.atMs},images:window.flatMap(r=>views.get(r.id))});
 const valid=Array.isArray(output.assignments)&&output.assignments.length===4&&output.assignments.every((a,i)=>a.id===window[i].id&&typeof a.region==='string'&&typeof a.reason==='string');
 results.push({window,elapsedMs:performance.now()-begin,valid,output});
 await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results.at(-1)));
 if(!valid)throw Error('Incomplete batch; no automatic paid retry');
}
