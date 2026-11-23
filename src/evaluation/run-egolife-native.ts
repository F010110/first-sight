/** Offline replay of REAL First-Sight components. No caption or replacement retriever. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {RealtimeMemory,type LiveOriginal} from '../hardware/realtime-memory.js';
import {RealtimeMethod2} from '../hardware/realtime-method2.js';
import {answerRealtimeQuestion} from '../hardware/realtime-question.js';
import {LiveFramePolicy} from '../hardware/live-frame-policy.js';
import {spatialJsonVlm} from '../agent/spatial-json-vlm.js';
import {answerEgoLifeWithFirstSight,egoLifeTime,type EgoLifeTask} from './egolife-first-sight-adapter.js';

export interface NativeReplayInput {
 schema:'egolife-native-rgb-replay-v1';
 cloudProcessingAuthorized:boolean;
 samplingIntervalMs:number;
 source:{revision:string;firstMs:number;lastMs:number;missingIntervals:Array<[number,number]>};
 tasks:EgoLifeTask[];
 originals:LiveOriginal[];
}
const sha=(raw:Uint8Array)=>createHash('sha256').update(raw).digest('hex');
const save=(path:string,value:unknown)=>writeFile(path,JSON.stringify(value,null,2));

/** Replay the ACTUAL latest-frame gate; do not force every archived frame into
 * quadratic whole-group comparisons that the live application would supersede.
 * Only idle waiting is fast-forwarded. Measured model service time advances the
 * source clock; late judgments retain their real replay availability time.
 */
export async function replayNativeMemory(input:NativeReplayInput,memory:Pick<RealtimeMemory,'archive'|'commit'>,method:Pick<RealtimeMethod2,'observe'|'interrupt'>,progress:(value:unknown)=>Promise<void>,timer=()=>performance.now()){
 const gate=new LiveFramePolicy<LiveOriginal>();
 let clock=input.source.firstMs,index=0,completed=0,lastModeled=-Infinity,producerFailure:string|null=null;
 while(index<input.originals.length||gate.status(clock).pending){
  if(!gate.status(clock).pending&&index<input.originals.length)clock=Math.max(clock,input.originals[index]!.atMs);
  while(index<input.originals.length&&input.originals[index]!.atMs<=clock){
   const row=input.originals[index++]!;memory.archive(row);gate.offer(row);
  }
  if(clock>input.source.lastMs)break;
  const decision=gate.take(clock);
  if(!decision.frame)continue;
  const row=decision.frame;
  for(const missed of input.originals.slice(0,index).filter(r=>r.atMs>lastModeled&&r.atMs<row.atMs))method.interrupt(missed);
  if(row.gapBefore)method.interrupt({...row,id:row.id+':gap',atMs:row.atMs-.5});
  const started=timer();
  try{
   const result=await method.observe(row);
   clock+=Math.max(0,timer()-started);
   memory.commit(row.id,result,clock);lastModeled=row.atMs;completed++;
   await progress({completed,archived:index,lastId:row.id,lastSourceMs:row.atMs,availableAtSourceMs:clock});
  }catch(error){producerFailure=String(error);break;}
 }
 // Acquisition/archive and producer are independent in the real application.
 // Retain all actual images even if producer is slow, stopped, or budget-limited.
 while(index<input.originals.length)memory.archive(input.originals[index++]!);
 return {archived:index,completedObservations:completed,producerFailure};
}

export async function validateNativeReplay(input:NativeReplayInput){
 if(input.schema!=='egolife-native-rgb-replay-v1'||!input.cloudProcessingAuthorized)throw Error('Explicit RGB cloud-processing authorization is required');
 if(!input.tasks.length||!input.originals.length||!Number.isFinite(input.samplingIntervalMs)||input.samplingIntervalMs<100)throw Error('Missing tasks or actual source images');
 if(input.source.missingIntervals.length)throw Error('Incomplete source prefix; do not silently score as complete-history benchmark');
 if(input.originals[0]!.atMs-input.source.firstMs>input.samplingIntervalMs||input.source.firstMs>Math.min(...input.tasks.map(t=>t.cutoffMs)))throw Error('Source prefix does not cover tasks');
 if(new Set(input.tasks.map(t=>t.ID)).size!==input.tasks.length)throw Error('Duplicate task IDs');
 for(const t of input.tasks){
  const allowed=['ID','type','question','choices','queryTime','untilTime','cutoffMs'];
  if(Object.keys(t).some(k=>!allowed.includes(k))||Object.keys(t.choices).sort().join('')!=='ABCD')throw Error('Task contains unexpected annotation or invalid choices');
  const clock=egoLifeTime(t.queryTime.date,t.queryTime.time);
  if(t.cutoffMs!==clock.cutoffMs||t.untilTime!==clock.untilTime||t.cutoffMs>input.source.lastMs)throw Error('Task clock outside source prefix');
 }
 const ids=new Set<string>();let previous=-Infinity;
 for(const row of input.originals){
  if(ids.has(row.id)||row.atMs<=previous||row.atMs<input.source.firstMs||row.atMs>input.source.lastMs)throw Error('Invalid source chronology');
  if(previous!==-Infinity&&row.atMs-previous>input.samplingIntervalMs+200)throw Error('Unreported sampling gap');
  ids.add(row.id);previous=row.atMs;
  if(!row.pngPath||!row.pngSha256||row.features?.length!==1||row.features[0]?.length!==72||row.features[0].some(v=>!Number.isFinite(v)))throw Error('Original needs native prepared pixels and descriptor');
  const bytes=await readFile(row.pngPath);
  if(sha(bytes)!==row.pngSha256||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Source PNG hash mismatch');
 }
 if(input.source.lastMs-input.originals.at(-1)!.atMs>input.samplingIntervalMs)throw Error('Unprepared source tail');
}

export async function runNativeReplay(inputFile:string,goldFile:string,output:string,confirmPaid:boolean){
 const raw=await readFile(inputFile),input=JSON.parse(raw.toString()) as NativeReplayInput;
 await validateNativeReplay(input);
 if(!confirmPaid)throw Error('Validated input; actual run requires --confirm-paid');
 await mkdir(output,{recursive:false});
 // Freeze source code actually used; no assumption that a dirty working tree is a release.
 const codeFiles=['src/hardware/realtime-method2.ts','src/hardware/realtime-question.ts','src/hardware/realtime-memory.ts','src/hardware/live-frame-policy.ts','src/agent/spatial-json-vlm.ts','src/agent/spatial-fixed-group-agent.ts','src/agent/spatial-fixed-prompts.ts','src/evaluation/egolife-first-sight-adapter.ts','src/evaluation/run-egolife-native.ts','scripts/evaluation/prepare-egolife-native.py','cam/host/prepare_live_image.py'];
 const codeHashes=Object.fromEntries(await Promise.all(codeFiles.map(async p=>[p,sha(await readFile(p))])));
 const goldBytes=await readFile(goldFile); // Freeze bytes, never pass them to an inference component.
 await save(join(output,'frozen.json'),{inputSha256:sha(raw),goldSha256:sha(goldBytes),codeHashes,track:'native-first-sight-single-view-RGB-offline-replay',samplingIntervalMs:input.samplingIntervalMs,source:input.source,maxCalls:12000,maxEstimatedUSD:5,semanticChanges:false,clockPolicy:'native capacity1 latest-frame gate; measured model service time advances source clock, idle waiting fast-forwarded; judgment availability is completion time, not capture time; QA uses causal snapshots after replay',audio:'not supplied; audio/name-dependent tasks retained, no extra transcripts',startedAt:new Date().toISOString()});
 await writeFile(join(output,'public-input.json'),raw);
 const provider=spatialJsonVlm(join(output,'requests'),12000,5);
 const method=new RealtimeMethod2(provider),memory=new RealtimeMemory(join(output,'memory.sqlite'));
 const tasks=[...input.tasks].sort((a,b)=>a.cutoffMs-b.cutoffMs);
 let build:{archived:number;completedObservations:number;producerFailure:string|null}={archived:0,completedObservations:0,producerFailure:null};
 const results:Array<{ID:string;type:string;status:string;response:string;[key:string]:unknown}>=[];
 try{
  build=await replayNativeMemory(input,memory,method,value=>save(join(output,'build-progress.json'),value));
  await save(join(output,'build-summary.json'),build);
  for(const task of tasks){
   try{
    const result=await answerEgoLifeWithFirstSight(task,memory.snapshot(task.cutoffMs),answerRealtimeQuestion,provider);
    memory.question(task.ID,result);results.push(result);
   }catch(error){results.push({ID:task.ID,type:task.type,status:'error',response:'Error',error:String(error)});}
   await save(join(output,'results.json'),results);
  }
 }finally{memory.close();}
 // Scoring occurs after inference. Failures and abstentions remain in denominator.
 const gold=JSON.parse(goldBytes.toString()) as Record<string,string>;
 for(const task of tasks)if(!['A','B','C','D'].includes(gold[task.ID]??''))throw Error('Missing gold; inference preserved, no partial score');
 const scored=results.map(r=>({...r,correct:r.status==='answered'&&r.response===gold[r.ID]}));
 await save(join(output,'scored-results.json'),scored);
 const summary={track:'native-first-sight-single-view-RGB-offline-replay',correct:scored.filter(r=>r.correct).length,total:tasks.length,accuracy:scored.filter(r=>r.correct).length/tasks.length,...build,statusCounts:Object.fromEntries([...new Set(scored.map(r=>r.status))].map(s=>[s,scored.filter(r=>r.status===s).length])),note:'Native method2 builds memory with the native latest-frame gate; all sampled originals remain archived. Native search/inspect function answers causal snapshots. Sparse sampling, source availability, audio omission and small subset must accompany score.'};
 await save(join(output,'summary.json'),summary);return summary;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [input,gold,output,confirmation]=process.argv.slice(2);
 if(!input||!gold||!output||confirmation!=='--confirm-paid')throw Error('Usage: run-egolife-native INPUT GOLD NEW-OUTPUT --confirm-paid');
 console.log(JSON.stringify(await runNativeReplay(resolve(input),resolve(gold),resolve(output),true)));
}
