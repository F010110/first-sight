/** Windowed online replay diagnostic, not the frozen question-bank score. */
import {readFile,mkdir,appendFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {SpatialContextMemory} from '../../agent/spatial-context-memory.js';import {SpatialContextLoop} from '../../agent/spatial-context-loop.js';import {spatialContextVlm} from '../../agent/spatial-context-vlm.js';import {spatialWindows} from '../../agent/spatial-window-schedule.js';import type {MemoryRow} from '../evaluation/memory-evaluation-session.js';
const [replay,output,paid]=process.argv.slice(2);if(!replay||!output||paid!=='--confirm-paid')throw Error('Usage: public-observations.jsonl NEW-output --confirm-paid');
await mkdir(output,{recursive:false});const bytes=await readFile(replay);const rows:MemoryRow[]=bytes.toString().trim().split(/\r?\n/).map(s=>JSON.parse(s));
const all=process.argv.includes('--all'),historical=process.argv.includes('--historical');
const limitArg=process.argv.find(a=>a.startsWith('--limit='));const limit=limitArg?Number(limitArg.slice(8)):all?rows.length:12;if(!Number.isInteger(limit)||limit<1||limit>rows.length)throw Error('Invalid replay limit');
const observations=rows.slice(0,limit).map(row=>({id:row.id,atMs:row.atMs,sourceAtMs:row.sourceAtMs,recordingId:String(row.episodeNumber),frames:['front','left','right'].map(camera=>row.cameras[camera]!)}));
const windows=spatialWindows(observations),maxCalls=windows.length*4,maxEstimatedUSD=all?2:.25;
const files:Record<string,string>={};for(const file of ['./spatial-context-smoke.js','../../agent/spatial-context-loop.js','../../agent/spatial-context-protocol.js','../../agent/spatial-context-memory.js','../../agent/spatial-context-vlm.js','../../agent/bounded-network-retry.js','../../agent/spatial-working-context.js','../../agent/spatial-sqlite-store.js','../../agent/spatial-retrieve.js','../../agent/spatial-window-schedule.js']){const url=new URL(file,import.meta.url);files[url.pathname]=createHash('sha256').update(await readFile(url)).digest('hex');}
const questionWindow=Math.min(2,windows.length-1);
await writeFile(join(output,'plan.json'),JSON.stringify({version:'window-context-v2',observations:observations.length,windows:windows.length,questionWindows:[questionWindow],historical,replaySha256:createHash('sha256').update(bytes).digest('hex'),maxCalls,maxEstimatedUSD,fullEvaluation:false,files},null,2));
const memory=new SpatialContextMemory(join(output,'memory.sqlite'));
let loop:SpatialContextLoop;
const model=spatialContextVlm(join(output,'requests'),maxCalls,maxEstimatedUSD,async(atMs,value)=>{await memory.writeOutput(atMs,value);try{const response=JSON.parse((value as {rawResponse:string}).rawResponse);JSON.parse(response.choices[0].message.content);}catch{loop.context.recordOutput(atMs,value);}});
loop=new SpatialContextLoop(memory,model,4);
let completed=0;
try{for(let index=0;index<windows.length;index++){
 const window=windows[index]!;
 for(const observation of window){const row=rows.find(r=>r.id===observation.id)!;for(const camera of ['front','left','right'])if(createHash('sha256').update(await readFile(row.cameras[camera]!)).digest('hex')!==row.sha256[camera])throw Error('Source image mismatch');}
 const question=index===questionWindow?(historical?'请查询并实际查看前一个窗口的一次观察原图，再说明那次观察能确认的空间特征。不要仅依据context摘要回答。':'当前画面能确认什么空间特征？请不要猜测建筑用途。'):null;
 const result=await loop.runWindow(window,question,{historicalEvidenceRequired:!!question&&historical});
 await appendFile(join(output,'results.jsonl'),JSON.stringify({window:index,ids:window.map(o=>o.id),question,result,context:loop.context.view()})+'\n');
 if(result.status==='budget-exhausted')throw Error('Replay failed: inference budget exhausted');
 if(question&&historical&&(result.status!=='answered'||!result.sourceIds?.some(id=>!window.some(o=>o.id===id))))throw Error('Historical smoke failed: no inspected historical citation');
 completed+=window.length;
}const counts=memory.counts();if(!counts.places)throw Error('Spatial smoke/replay failed: no location candidate created');await writeFile(join(output,'complete.json'),JSON.stringify({status:'window-replay-completed-not-question-bank-score',observations:completed,windows:windows.length,counts}));}
catch(error){await writeFile(join(output,'stopped.json'),JSON.stringify({error:String(error),completedObservations:completed}));throw error;}finally{memory.close();}
