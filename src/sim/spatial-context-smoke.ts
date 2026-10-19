/** New architecture smoke, not the frozen question-bank score. */
import {readFile,mkdir,appendFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {SpatialContextMemory} from '../agent/spatial-context-memory.js';import {SpatialContextLoop} from '../agent/spatial-context-loop.js';import {spatialContextVlm} from '../agent/spatial-context-vlm.js';import type {MemoryRow} from './memory-evaluation-session.js';
const [replay,output,paid]=process.argv.slice(2);if(!replay||!output||paid!=='--confirm-paid')throw Error('Usage: public-observations.jsonl NEW-output --confirm-paid');
await mkdir(output,{recursive:false});const bytes=await readFile(replay);const rows:MemoryRow[]=bytes.toString().trim().split(/\r?\n/).map(s=>JSON.parse(s));
await writeFile(join(output,'plan.json'),JSON.stringify({version:'experimental-context-loop-v1',selection:'first three public chronological observations; question at third',replaySha256:createHash('sha256').update(bytes).digest('hex'),maxCalls:12,maxOutputTokens:1200,conservativeEstimatedUSD:.22,fullEvaluation:false},null,2));
const memory=new SpatialContextMemory(join(output,'memory.sqlite')),loop=new SpatialContextLoop(memory,spatialContextVlm(join(output,'requests'),12),4);
try{for(let i=0;i<3;i++){
 const row=rows[i]!;for(const camera of ['front','left','right'])if(createHash('sha256').update(await readFile(row.cameras[camera]!)).digest('hex')!==row.sha256[camera])throw Error('Source image mismatch');
 const observation={id:row.id,atMs:row.atMs,sourceAtMs:row.sourceAtMs,recordingId:String(row.episodeNumber),frames:['front','left','right'].map(camera=>row.cameras[camera]!)};
 const result=await loop.run(observation,i===2?'当前画面能确认什么空间特征？请不要猜测建筑用途。':null);
 await appendFile(join(output,'results.jsonl'),JSON.stringify({id:row.id,result,context:loop.context.view()})+'\n');if(result.status==='budget-exhausted')throw Error('Smoke failed: inference budget exhausted');
}await writeFile(join(output,'complete.json'),JSON.stringify({status:'smoke-completed-not-final-score',observations:3}));}
catch(error){await writeFile(join(output,'stopped.json'),JSON.stringify({error:String(error)}));throw error;}finally{memory.close();}
