/** Selective protocol-repair diagnosis, not a new unbiased 90-task benchmark. */
import {readFile,writeFile,mkdir,appendFile,copyFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
import {SpatialRetriever} from '../agent/spatial-retrieve.js';import {RequestAgent,HistoricalAnswerValidationError} from '../agent/request-agent.js';
import {spatialAlgorithmSession,oracleSession} from './spatial-memory-evaluation-session.js';
import {answerFailures,repairFeedback,type RepairQuestion} from './memory-answer-repair.js';import type {MemoryRow} from './memory-evaluation-session.js';
const [original,output,paid]=process.argv.slice(2);if(!original||!output||paid!=='--confirm-paid')throw Error('Usage: original-group NEW-output --confirm-paid');
const resume=process.argv[5]==='--resume';
const source=resolve(original),root=resolve(output);await mkdir(root,{recursive:resume});
const json=async(p:string)=>JSON.parse(await readFile(p,'utf8'));const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const oldFreeze=await json(join(source,'code-freeze.json'));for(const [path,expected] of Object.entries(oldFreeze.files))if(digest(await readFile(path))!==expected)throw Error('Original execution artifacts changed');
const frozen=await json(join(source,'frozen.json'));const mode=frozen.evaluationModes[0] as string;
if(!['spatial-memory','memory-oracle'].includes(mode))throw Error('Unsupported group');
await mkdir(join(root,'model-replay'),{recursive:resume});for(const name of ['frozen.json','model-questions.json','smoke-ids.json'])if(!resume)await copyFile(join(source,name),join(root,name));
await copyFile(join(source,'model-replay/observations.jsonl'),join(root,'model-replay/observations.jsonl'));
if(mode==='memory-oracle')await copyFile(join(source,'oracle-evidence.json'),join(root,'oracle-evidence.json'));
const codeFreeze={...oldFreeze,repairPolicy:'At most 2 attempts, public runtime failure feedback only; no grader or expected answer used; retain latest attempt even if worse.',files:{...oldFreeze.files,[new URL(import.meta.url).pathname.replace(/^\/(\w:)/,'$1')]:digest(await readFile(new URL(import.meta.url))),[new URL('./memory-answer-repair.js',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')]:digest(await readFile(new URL('./memory-answer-repair.js',import.meta.url)))}};
if(resume)await copyFile(join(root,'code-freeze.json'),join(root,`code-freeze-pre-resume-${Date.now()}.json`));
await writeFile(join(root,'code-freeze.json'),JSON.stringify({...codeFreeze,...resume?{amendment:'Resume completed prefix and pending attempt without repeating paid work; local attempt exhaustion is retryable within original two-attempt cap. Original freeze archived.'}:{}},null,2));await mkdir(join(root,'full'),{recursive:resume});
const questions:RepairQuestion[]=await json(join(root,'model-questions.json'));
const rowText=await readFile(join(root,'model-replay/observations.jsonl'),'utf8');if(digest(Buffer.from(rowText))!==frozen.replaySha256||digest(await readFile(join(root,'model-questions.json')))!==frozen.publicTasksSha256)throw Error('Frozen inputs mismatch');
const rows:MemoryRow[]=rowText.trim().split(/\r?\n/).map(s=>JSON.parse(s));
const records= (await readFile(join(source,'full/results.jsonl'),'utf8')).trim().split(/\r?\n/).map(s=>JSON.parse(s));
if(records.length!==90||new Set(records.map(r=>r.id)).size!==90)throw Error('Expected 90 original records');
const oracle:Record<string,string[]>=mode==='memory-oracle'?await json(join(root,'oracle-evidence.json')):{};
const retriever=mode==='spatial-memory'?new SpatialRetriever(join(frozen.memoryDirectory,'topology.sqlite')):null;
let calls=0,inputTokens=0,outputTokens=0,unknownCalls=0,retried=0;const selected:unknown[]=[];
const previousAttempts:any[]=resume?(await readFile(join(root,'attempts.jsonl'),'utf8')).trim().split(/\r?\n/).map(s=>JSON.parse(s)):[];
if(resume){const prior=await json(join(root,'repair-usage.json'));calls=prior.calls;inputTokens=prior.inputTokens;outputTokens=prior.outputTokens;unknownCalls=prior.unknownCalls;selected.push(...(await readFile(join(root,'full/results.jsonl'),'utf8')).trim().split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s)));if(new Set((selected as any[]).map(r=>r.id)).size!==selected.length)throw Error('Duplicate selected records');retried=previousAttempts.filter(a=>a.attempt===0&&a.reasons.length).length;await writeFile(join(root,`resume-${Date.now()}.json`),JSON.stringify({prior,retainedSelected:selected.length,retainedAttempts:previousAttempts.length},null,2));}
const cost=()=>((inputTokens+unknownCalls*128000)*.1356+(outputTokens+unknownCalls*512)*.4584)/1e6;
const usage=()=>writeFile(join(root,'repair-usage.json'),JSON.stringify({calls,inputTokens,outputTokens,unknownCalls,estimatedUSDWithReservations:cost(),maxCalls:240,maxEstimatedUSD:1,priceBasis:'Published list price, not account invoice'},null,2));
await writeFile(join(root,'repair-policy.json'),JSON.stringify({original:source,mode,maxRetries:2,selection:'Public protocol failures or original execution errors only. No private grades read.',selectionBias:'Selective repair diagnostic; not a fresh system benchmark. Semantic-only wrong answers are retained, not secretly retried using the answer key.',outcome:'Latest attempt replaces original even if worse; original and all attempts retained.',model:'qwen3.8-flash',enableThinking:false,maxCalls:240,maxEstimatedUSD:1},null,2));
try{
 for(const originalRecord of records){
   if((selected as any[]).some(r=>r.id===originalRecord.id))continue;
   const priorAttempts=previousAttempts.filter(a=>a.id===originalRecord.id);const latest=priorAttempts.at(-1);
   const q=questions.find(q=>q.id===originalRecord.id)!;let record=latest?.record??originalRecord;
  let reasons=record.error?[`Previous execution failed: ${record.error}`]:answerFailures(record.result?.raw??'',q,rows,new Set(record.inspectedIds??[]));
   if(!priorAttempts.length){if(reasons.length)retried++;await appendFile(join(root,'attempts.jsonl'),JSON.stringify({id:q.id,attempt:0,reasons,record})+'\n');}
   for(let attempt=(latest?.attempt??0)+1;reasons.length&&attempt<=2;attempt++){
   const trace:unknown[]=[];const log=(e:unknown)=>trace.push(e);const current=rows.find(r=>r.id===q.currentObservationId)!;
   const session=mode==='spatial-memory'?spatialAlgorithmSession(retriever!,rows,q.queryAtMs,log):oracleSession(rows,oracle[q.id]??[],q.queryAtMs,log);
   const supplied=mode==='memory-oracle'&&(oracle[q.id]?.length??0)>0?await session.inspect(oracle[q.id]!):[];
   for(const view of ['front','left','right'])if(digest(await readFile(current.cameras[view]!))!==current.sha256[view])throw Error('Current image hash mismatch');
   let localCalls=0,seen=0;
   const feedback=repairFeedback(record.result?.raw??'',reasons);
   const agent=new RequestAgent(null,session,e=>{trace.push(e);if(e.role==='assistant'){const u=e.usage as any;if(u&&Number.isFinite(u.input)&&Number.isFinite(u.output)){inputTokens+=u.input+(u.cacheRead??0)+(u.cacheWrite??0);outputTokens+=u.output;seen++;}}},{
     beforeModelCall(){if(calls>=240||cost()+(128000*.1356+512*.4584)/1e6>1)throw Error('Repair total request/cost budget reached');if(localCalls>=8)throw Error('Repair local attempt budget reached');calls++;localCalls++;},
    providedEvidence:supplied.map(s=>({type:'image' as const,data:s.data,mimeType:s.mimeType})),
    contextText:`Current original observation ID=${current.id}; 第${current.episodeNumber}段${current.sourceAtMs/1000}秒. Current images are front,left,right. Exact 第N段T秒 queries use public recording times. You must inspect and cite each explicitly requested record including current when applicable. Do not confuse source timestamps and activity clock. ${mode==='memory-oracle'?`After the 3 current images, preinspected original evidence images are supplied in this order: ${JSON.stringify(supplied.map(s=>({id:s.id,index:s.index,atMs:s.atMs})))}. Cite their actual IDs; no retrieval needed for supplied images.`:''}\n${feedback}`
   });agent.set('ask',q.question);
   try{const result=await agent.observe(['front','left','right'].map(view=>({id:current.id,path:current.cameras[view]!,timestampMs:current.atMs})),null,null);record={id:q.id,mode,result,inspectedIds:[...session.inspected]};}
   catch(e){record=e instanceof HistoricalAnswerValidationError?{id:q.id,mode,modelOutputRejected:true,rejection:String(e),result:{raw:e.rawAnswer},inspectedIds:[...session.inspected]}:{id:q.id,mode,error:String(e),inspectedIds:[...session.inspected]};}
   unknownCalls+=Math.max(0,localCalls-seen);
   reasons=record.error?[`Previous execution failed: ${record.error}`]:answerFailures(record.result?.raw??'',q,rows,session.inspected);
   await writeFile(join(root,'full',`${q.id}-${mode}-attempt-${attempt}-trace.json`),JSON.stringify(trace,null,2));
   await appendFile(join(root,'attempts.jsonl'),JSON.stringify({id:q.id,attempt,feedback,reasons,record})+'\n');await usage();
   if(unknownCalls>0||(record.error&&!String(record.error).includes('Repair local attempt budget reached')))throw Error('Repair infrastructure failure; preserve attempts and stop, no unbounded retries');
  }
  selected.push(record);await appendFile(join(root,'full/results.jsonl'),JSON.stringify(record)+'\n');
 }
 await usage();await writeFile(join(root,'full/complete.json'),JSON.stringify({status:'completed',executions:selected.length,planned:90,retried,interpretation:'Selective bounded protocol repair diagnostic, not independent benchmark'},null,2));
}catch(e){await usage();await writeFile(join(root,'repair-stopped.json'),JSON.stringify({error:String(e),selected:selected.length,retried},null,2));throw e;}finally{retriever?.close();}
