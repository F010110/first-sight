/** Isolated speed probe: one regional judgment per four-observation window. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spatialJsonVlm} from '../../dist/current/agent/spatial-json-vlm.js';
const [source,inputArg,out,confirm]=process.argv.slice(2);
if(!source||!inputArg||!out||confirm!=='--confirm-paid')throw Error('Usage: probe-spatial-window-region SOURCE PUBLIC-INPUT NEW-OUT --confirm-paid');
const manifest=JSON.parse(await readFile(join(source,'manifest.json'),'utf8'));
const input=JSON.parse(await readFile(inputArg,'utf8'));
if(input.schema!=='spatial-public-input-v1')throw Error('Require public input');
const facts=new Map();
for(let i=0;i<12;i++){
 const dir=join(source,'perception',String(i).padStart(4,'0'));
 const receipt=JSON.parse(await readFile(join(dir,'input.json'),'utf8'));
 const response=JSON.parse(await readFile(join(dir,'response.txt'),'utf8'));
 facts.set(receipt.data.current.id,JSON.parse(response.choices[0].message.content));
}
await mkdir(out,{recursive:false});
const request=spatialJsonVlm(join(out,'requests'),3,.10,true,400),results=[];
for(const window of manifest.windows){
 if(window.length!==4||window.some((r,i)=>i&&r.atMs-window[i-1].atMs!==2000))throw Error('Require four observations at 2s intervals');
 const rows=window.map(r=>{const row=input.observations.find(o=>o.id===r.id);if(!row||row.atMs!==r.atMs||!facts.has(r.id))throw Error('Source mismatch');return row;});
 const tail=window.at(-1),begin=performance.now();
 const output=await request({phase:'identity',prompt:'把这4组按时间排列的三摄观察视作一个8秒整体，只给一个简短空间判断。三摄是同一时刻不同朝向。输出JSON {"kind":"region或boundary或unknown","regions":["区域暂名"],"reason":"不超过60个汉字的可见依据"}。region表示整个窗口主要处于一个区域；boundary表示两个区域之间的边界/过渡，regions列两个区域；unknown用于证据不足或复杂多区域，regions为空。不逐帧输出、不重新描述细节、不推断精确转场时间，不把远处可见店铺当已进入，不推断连通或虚构移动动作。',data:{current:{id:tail.id,atMs:tail.atMs},observations:window.map(r=>({...r,facts:facts.get(r.id)})),windowStartMs:window[0].atMs,windowEndExclusiveMs:window[0].atMs+8000,knowledgeCutoffMs:tail.atMs},images:rows.flatMap(r=>r.views.map(v=>({...v,id:r.id})))});
 const valid=['region','boundary','unknown'].includes(output.kind)&&Array.isArray(output.regions)&&output.regions.length===({region:1,boundary:2,unknown:0}[output.kind])&&output.regions.every(r=>typeof r==='string'&&r.trim())&&typeof output.reason==='string'&&output.reason.length>0&&output.reason.length<=240;
 results.push({window,elapsedMs:performance.now()-begin,valid,output});
 await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results.at(-1)));
 if(!valid)throw Error('Invalid region response; retained without paid retry');
}
const times=results.map(r=>r.elapsedMs);
await writeFile(join(out,'summary.json'),JSON.stringify({schema:'window-region-speed-probe-v1',calls:results.length,observationCount:12,totalReasoningMs:times.reduce((a,b)=>a+b,0),maxReasoningMs:Math.max(...times),allBelowWindowDuration:times.every(t=>t<8000),scope:'Direct-model short speed probe only; shared perception reused; excludes collection and perception delay. No production Pi integration, sustained-load or semantic certification.'},null,2));
