/** Re-answer frozen official tasks against READ-ONLY native baseline memory.
 * No rebuilding, new captions, gold access during inference, or benchmark filtering.
 */
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {answerRealtimeQuestion} from '../hardware/realtime-question.js';
import {spatialJsonVlm} from '../agent/spatial-json-vlm.js';
import {answerEgoLifeWithFirstSight} from './egolife-first-sight-adapter.js';
import {validateNativeReplay,type NativeReplayInput} from './run-egolife-native.js';
import type {RealtimeMemory} from '../hardware/realtime-memory.js';

const sha=(raw:Uint8Array)=>createHash('sha256').update(raw).digest('hex');
const save=(path:string,value:unknown)=>writeFile(path,JSON.stringify(value,null,2));
export function readNativeSnapshot(db:DatabaseSync,asOfMs:number):ReturnType<RealtimeMemory['snapshot']>{
 const rows=db.prepare('SELECT o.raw,j.raw AS judgment,j.available_ms FROM originals o LEFT JOIN judgments j ON j.id=o.id AND j.available_ms<=? WHERE o.at_ms<=? ORDER BY o.at_ms').all(asOfMs,asOfMs) as {raw:string;judgment:string|null;available_ms:number|null}[];
 return {asOfMs,rows:rows.map(r=>({original:JSON.parse(r.raw),judgment:r.judgment?JSON.parse(r.judgment):null,availableAtMs:r.available_ms}))};
}

export async function rerunNativeQA(baseline:string,goldFile:string,output:string){
 const frozen=JSON.parse(await readFile(join(baseline,'frozen.json'),'utf8'));
 const inputRaw=await readFile(join(baseline,'public-input.json')),input=JSON.parse(inputRaw.toString()) as NativeReplayInput;
 const goldRaw=await readFile(goldFile);
 if(sha(inputRaw)!==frozen.inputSha256||sha(goldRaw)!==frozen.goldSha256)throw Error('Input/gold differ from native baseline');
 await validateNativeReplay(input);
 for(const p of ['src/hardware/realtime-method2.ts','src/hardware/realtime-memory.ts','src/hardware/live-frame-policy.ts','src/evaluation/egolife-first-sight-adapter.ts'])if(sha(await readFile(p))!==frozen.codeHashes[p])throw Error('This rerun must change QA only, not baseline building or scorer: '+p);
 const memoryPath=join(baseline,'memory.sqlite'),memoryBefore=sha(await readFile(memoryPath));
 await mkdir(output,{recursive:false});
 const codeFiles=['src/hardware/realtime-question.ts','src/hardware/history-query.ts','src/agent/spatial-json-vlm.ts','src/evaluation/rerun-egolife-native-qa.ts'];
 const codeHashes=Object.fromEntries(await Promise.all(codeFiles.map(async p=>[p,sha(await readFile(p))])));
 await save(join(output,'frozen.json'),{track:'native-first-sight-evidence-loop-QA-v3',baseline,baselineFrozenSha256:sha(await readFile(join(baseline,'frozen.json'))),inputSha256:sha(inputRaw),goldSha256:sha(goldRaw),memorySha256:memoryBefore,codeHashes,changes:'Normalize nullable tool parameters; structured recovery; browse auto-delivers real originals including explicitly tentative nearby-place context; neighbors temporal sampling; independent visual support review before accepting historical positive answers',memoryRebuilt:false,maxCalls:512,maxEstimatedUSD:.5,maxQuestionTurns:16,maxEvidenceReviewsPerQuestion:2,perRequestImageLimit:12,questions:input.tasks.map(t=>t.ID),startedAt:new Date().toISOString()});
 const db=new DatabaseSync(memoryPath,{readOnly:true});
 const provider=spatialJsonVlm(join(output,'requests'),512,.5);
 const results:Array<{ID:string;type:string;status:string;response:string;[key:string]:unknown}>=[];
 try{
  for(const task of input.tasks){
   try{results.push(await answerEgoLifeWithFirstSight(task,readNativeSnapshot(db,task.cutoffMs),answerRealtimeQuestion,provider));}
   catch(error){results.push({ID:task.ID,type:task.type,status:'error',response:'Error',error:String(error)});}
   await save(join(output,'results.json'),results);console.log(task.ID,results.at(-1)!.status);
  }
 }finally{db.close();}
 if(sha(await readFile(memoryPath))!==memoryBefore)throw Error('Baseline memory unexpectedly changed; inference retained but not accepted');
 const gold=JSON.parse(goldRaw.toString()) as Record<string,string>;
 for(const task of input.tasks)if(!['A','B','C','D'].includes(gold[task.ID]??''))throw Error('Invalid gold; no partial score');
 const scored=results.map(r=>({...r,correct:r.status==='answered'&&r.response===gold[r.ID]}));
 await save(join(output,'scored-results.json'),scored);
 const summary={track:'native-first-sight-evidence-loop-QA-v3',correct:scored.filter(r=>r.correct).length,total:input.tasks.length,accuracy:scored.filter(r=>r.correct).length/input.tasks.length,statusCounts:Object.fromEntries([...new Set(scored.map(r=>r.status))].map(s=>[s,scored.filter(r=>r.status===s).length])),memoryRebuilt:false,memoryUnchanged:true,baselineCorrect:0,baselineTotal:10,scope:'Same 10 official questions and same native causal memory. QA-only engineering iteration with visual support review, not held-out validation or full500 benchmark accuracy.'};
 await save(join(output,'summary.json'),summary);return summary;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [baseline,gold,output,confirmation]=process.argv.slice(2);
 if(!baseline||!gold||!output||confirmation!=='--confirm-paid')throw Error('Usage: rerun-egolife-native-qa BASELINE GOLD NEW-OUTPUT --confirm-paid');
 console.log(JSON.stringify(await rerunNativeQA(resolve(baseline),resolve(gold),resolve(output))));
}
