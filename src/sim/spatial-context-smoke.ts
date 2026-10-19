/** New architecture smoke, not the frozen question-bank score. */
import {readFile,mkdir,appendFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {SpatialContextMemory} from '../agent/spatial-context-memory.js';import {SpatialContextLoop} from '../agent/spatial-context-loop.js';import {spatialContextVlm} from '../agent/spatial-context-vlm.js';import type {MemoryRow} from './memory-evaluation-session.js';
const [replay,output,paid]=process.argv.slice(2);if(!replay||!output||paid!=='--confirm-paid')throw Error('Usage: public-observations.jsonl NEW-output --confirm-paid');
await mkdir(output,{recursive:false});const bytes=await readFile(replay);const rows:MemoryRow[]=bytes.toString().trim().split(/\r?\n/).map(s=>JSON.parse(s));
const all=process.argv.includes('--all'),count=all?rows.length:3,maxCalls=all?rows.length*4:12,maxEstimatedUSD=all?2:.25;
const files:Record<string,string>={};for(const file of ['./spatial-context-smoke.js','../agent/spatial-context-loop.js','../agent/spatial-context-memory.js','../agent/spatial-context-vlm.js','../agent/spatial-working-context.js','../agent/spatial-sqlite-store.js','../agent/spatial-retrieve.js']){const url=new URL(file,import.meta.url);files[url.pathname]=createHash('sha256').update(await readFile(url)).digest('hex');}
await writeFile(join(output,'plan.json'),JSON.stringify({version:'experimental-context-loop-v1',selection:all?'all chronological observations; current-view question at third':'first three public chronological observations; question at third',historical:process.argv.includes('--historical'),replaySha256:createHash('sha256').update(bytes).digest('hex'),maxCalls,maxOutputTokens:1200,maxEstimatedUSD,fullEvaluation:false,files},null,2));
const memory=new SpatialContextMemory(join(output,'memory.sqlite')),loop=new SpatialContextLoop(memory,spatialContextVlm(join(output,'requests'),maxCalls,maxEstimatedUSD),4);
try{for(let i=0;i<count;i++){
 const row=rows[i]!;for(const camera of ['front','left','right'])if(createHash('sha256').update(await readFile(row.cameras[camera]!)).digest('hex')!==row.sha256[camera])throw Error('Source image mismatch');
 const observation={id:row.id,atMs:row.atMs,sourceAtMs:row.sourceAtMs,recordingId:String(row.episodeNumber),frames:['front','left','right'].map(camera=>row.cameras[camera]!)};
 const historical=process.argv.includes('--historical');
 const result=await loop.run(observation,i===2?(historical?'请查询并实际查看之前一次观察的原图，再说明那次观察能确认的空间特征。不要仅依据context摘要回答。':'当前画面能确认什么空间特征？请不要猜测建筑用途。'):null);
 await appendFile(join(output,'results.jsonl'),JSON.stringify({id:row.id,result,context:loop.context.view()})+'\n');if(result.status==='budget-exhausted')throw Error('Smoke failed: inference budget exhausted');
 if(i===2&&historical&&(result.status!=='answered'||!result.sourceIds?.some(id=>id!==row.id)))throw Error('Historical smoke failed: no actually inspected historical citation');
}await writeFile(join(output,'complete.json'),JSON.stringify({status:all?'replay-completed-not-question-bank-score':'smoke-completed-not-final-score',observations:count}));}
catch(error){await writeFile(join(output,'stopped.json'),JSON.stringify({error:String(error)}));throw error;}finally{memory.close();}
