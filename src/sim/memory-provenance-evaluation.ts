/** Fresh matched evaluation with explicit input provenance and bounded repair. */
import {readFile,writeFile,appendFile,mkdir,copyFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
import {SpatialRetriever} from '../agent/spatial-retrieve.js';import {RequestAgent,HistoricalAnswerValidationError} from '../agent/request-agent.js';
import {spatialAlgorithmSession,oracleSession} from './spatial-memory-evaluation-session.js';import {withCurrentEvidence} from './current-evidence-session.js';
import {answerFailures,repairFeedback,type RepairQuestion} from './memory-answer-repair.js';import type {MemoryRow} from './memory-evaluation-session.js';
const [original,destination,phase,paid]=process.argv.slice(2);if(!original||!destination||!['smoke','full'].includes(phase??'')||paid!=='--confirm-paid')throw Error('Usage: original-group NEW-root smoke|full --confirm-paid');
const source=resolve(original),root=resolve(destination);const json=async(p:string)=>JSON.parse(await readFile(p,'utf8'));const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const frozen=await json(join(source,'frozen.json'));const mode=frozen.evaluationModes[0];if(!['spatial-memory','memory-oracle'].includes(mode))throw Error('Invalid mode');
const artifacts=['./memory-provenance-evaluation.js','./current-evidence-session.js','./memory-answer-repair.js','./spatial-memory-evaluation-session.js','./memory-evaluation-grade.js','../agent/request-agent.js','../agent/qwen-provider.js','../agent/spatial-retrieve.js'];
if(phase==='smoke'){
 await mkdir(root,{recursive:false});await mkdir(join(root,'model-replay'));for(const name of ['frozen.json','model-questions.json','smoke-ids.json'])await copyFile(join(source,name),join(root,name));await copyFile(join(source,'model-replay/observations.jsonl'),join(root,'model-replay/observations.jsonl'));if(mode==='memory-oracle')await copyFile(join(source,'oracle-evidence.json'),join(root,'oracle-evidence.json'));
 const files:Record<string,string>={};for(const file of artifacts){const url=new URL(file,import.meta.url);files[url.pathname.replace(/^\/(\w:)/,'$1')]=digest(await readFile(url));}
 await writeFile(join(root,'code-freeze.json'),JSON.stringify({files,policy:'Fresh matched all-task evaluation; current frames are verified supplied evidence, history requires inspect; JSON output constrained; at most 2 repairs per task; no answer labels used.'},null,2));
}else{const gate=await json(join(root,'smoke/complete.json')),grading=await json(join(root,'smoke-grading/complete.json'));if(gate.executions!==6||grading.grades!==6)throw Error('Smoke gate incomplete');}
const codeFreeze=await json(join(root,'code-freeze.json'));for(const [p,expected] of Object.entries(codeFreeze.files))if(digest(await readFile(p))!==expected)throw Error('Frozen code changed');
const output=join(root,phase!);await mkdir(output,{recursive:false});
const text=await readFile(join(root,'model-replay/observations.jsonl'),'utf8');if(digest(Buffer.from(text))!==frozen.replaySha256||digest(await readFile(join(root,'model-questions.json')))!==frozen.publicTasksSha256)throw Error('Frozen data changed');
const rows:MemoryRow[]=text.trim().split(/\r?\n/).map(s=>JSON.parse(s));let questions:RepairQuestion[]=await json(join(root,'model-questions.json'));
if(phase==='smoke'){const ids=new Set(await json(join(root,'smoke-ids.json')));questions=questions.filter(q=>ids.has(q.id));}
const oracle:Record<string,string[]>=mode==='memory-oracle'?await json(join(root,'oracle-evidence.json')):{};
if(mode==='memory-oracle'&&digest(await readFile(join(root,'oracle-evidence.json')))!==frozen.oracleEvidenceSha256)throw Error('Oracle evidence changed');
const retriever=mode==='spatial-memory'?new SpatialRetriever(join(frozen.memoryDirectory,'topology.sqlite')):null;
let calls=0,input=0,outTokens=0,unknown=0,executions=0;const maxCalls=phase==='smoke'?144:1080,maxCost=phase==='smoke'?.5:2;
const cost=()=>((input+unknown*128000)*.1356+(outTokens+unknown*512)*.4584)/1e6;
const ledger=()=>writeFile(join(output,'usage.json'),JSON.stringify({calls,inputTokens:input,outputTokens:outTokens,unknownCallsReserved:unknown,estimatedUSD:cost(),maxCalls,maxEstimatedUSD:maxCost,estimate:'Public list rates including reservations; not invoice'},null,2));
try{
 for(const q of questions){
  const current=rows.find(r=>r.id===q.currentObservationId)!;for(const view of ['front','left','right'])if(digest(await readFile(current.cameras[view]!))!==current.sha256[view])throw Error('Current image mismatch');
  let record:any=null,reasons:string[]=[],previous='';
  for(let attempt=0;attempt<3;attempt++){
   const trace:unknown[]=[];const log=(v:unknown)=>trace.push(v);
   const base=mode==='spatial-memory'?spatialAlgorithmSession(retriever!,rows,q.queryAtMs,log):oracleSession(rows,oracle[q.id]??[],q.queryAtMs,log);
   const historical=(oracle[q.id]??[]).filter(id=>id!==current.id);const supplied=historical.length?await base.inspect(historical):[];
   const session=withCurrentEvidence(base,current.id);let local=0,seen=0;
   trace.push({operation:'provided-input-provenance',current:{id:current.id,episodeNumber:current.episodeNumber,sourceAtMs:current.sourceAtMs,activityAtMs:current.atMs},historical:supplied.map(s=>{const row=rows.find(r=>r.id===s.id)!;return {id:s.id,index:s.index,episodeNumber:row.episodeNumber,sourceAtMs:row.sourceAtMs,activityAtMs:s.atMs};})});
   const feedback=attempt?repairFeedback(previous,reasons):'';
   const agent=new RequestAgent(null,session,e=>{trace.push(e);if(e.role==='assistant'){const u=e.usage as any;if(u&&Number.isFinite(u.input)&&Number.isFinite(u.output)){input+=u.input+(u.cacheRead??0)+(u.cacheWrite??0);outTokens+=u.output;seen++;}}},{
    jsonOutput:true,beforeModelCall(){if(calls>=maxCalls||cost()+(128000*.1356+512*.4584)/1e6>maxCost)throw Error('Global provenance evaluation budget reached');if(local>=8)throw Error('Local attempt exhausted');calls++;local++;},providedEvidence:supplied.map(s=>({type:'image' as const,data:s.data,mimeType:s.mimeType})),
    contextText:`INPUT PROVENANCE: first 3 images are front,left,right CURRENT observation ${current.id}, 第${current.episodeNumber}段${current.sourceAtMs/1000}秒. These current images have ALREADY been supplied, viewed and registered as valid evidence. Cite current ID directly: NO search or re-inspection required for current facts. Historical facts must cite the specifically requested record actually inspected, not another similar room. Query 第N段T秒 for explicit recording timestamps. For comparisons cite each part's source, including current ID. ACTIVITY atMs is a synthetic clock, NOT seconds within a recording. Source references below explicitly map the requested recording time to each image. Do not infer same physical floor from similar decorations. abstained must agree with the answer; do not invent facts. ${mode==='memory-oracle'?`Additional image order after the 3 current images: ${JSON.stringify(supplied.map(s=>{const row=rows.find(r=>r.id===s.id)!;return {id:s.id,camera:['front','left','right'][s.index],sourceReference:`第${row.episodeNumber}段${row.sourceAtMs/1000}秒`,episodeNumber:row.episodeNumber,sourceAtMs:row.sourceAtMs,activityAtMs:s.atMs};}))}. These historical images also have already been inspected; cite their IDs directly. Do NOT claim a named source record is absent when its sourceReference appears in this supplied list. No search is needed to see it.`:''}\n${feedback}`
   });agent.set('ask',q.question);
   try{const result=await agent.observe(['front','left','right'].map(view=>({id:current.id,path:current.cameras[view]!,timestampMs:current.atMs})),null,null);record={id:q.id,mode,result,inspectedIds:[...session.inspected]};}
   catch(e){record=e instanceof HistoricalAnswerValidationError?{id:q.id,mode,modelOutputRejected:true,rejection:String(e),result:{raw:e.rawAnswer},inspectedIds:[...session.inspected]}:{id:q.id,mode,error:String(e),inspectedIds:[...session.inspected]};}
   unknown+=Math.max(0,local-seen);previous=record.result?.raw??'';reasons=record.error?[record.error]:answerFailures(previous,q,rows,session.inspected);
   if(mode==='memory-oracle'&&!record.error){try{const p=JSON.parse(previous.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));if(p.abstained&&/没有|未检索|未出现|未返回|不包含|仅有|只有|未包含|未找到/.test(p.answer)&&historical.length)reasons.push('Requested source images have been explicitly supplied with sourceReference labels. Do not confuse activityAtMs with recording seconds or claim those supplied records are absent. Reinspect the supplied list and images; abstain only if their visual content is insufficient, not because a supplied record is missing.');}catch{}}
   if(reasons.length&&!record.error)record={...record,modelOutputRejected:true,rejection:reasons.join(' ')};
   await appendFile(join(output,'attempts.jsonl'),JSON.stringify({id:q.id,mode,attempt,feedback,reasons,record})+'\n');await writeFile(join(output,`${q.id}-${mode}-attempt-${attempt}-trace.json`),JSON.stringify(trace,null,2));await ledger();
   if(unknown||record.error&&!String(record.error).includes('Local attempt exhausted'))throw Error('Infrastructure/usage failure; stop with attempts preserved');
   if(!reasons.length)break;
  }
  await appendFile(join(output,'results.jsonl'),JSON.stringify(record)+'\n');executions++;
 }
 await writeFile(join(output,'complete.json'),JSON.stringify({status:'completed',executions,planned:questions.length,protocol:'verified current provenance + strict JSON + at most two repairs; final attempt retained'},null,2));
}catch(e){await ledger();await writeFile(join(output,'stopped.json'),JSON.stringify({error:String(e),executions,planned:questions.length},null,2));throw e;}finally{retriever?.close();}
