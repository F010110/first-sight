/** Model execution reads public questions and model memory ONLY, never answers. */
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {DatabaseSync} from 'node:sqlite';import {createHash} from 'node:crypto';
import {RequestAgent,HistoricalAnswerValidationError} from '../../agent/request-agent.js';
import {memorySession,type MemoryRow,type MemoryMode} from './memory-evaluation-session.js';
import {SpatialRetriever} from '../../agent/spatial-retrieve.js';
import {spatialAlgorithmSession,oracleSession} from './spatial-memory-evaluation-session.js';

const [prepared,phase,paid]=process.argv.slice(2);if(!prepared||!['smoke','full'].includes(phase??'')||paid!=='--confirm-paid')throw Error('Usage: prepared smoke|full --confirm-paid');
const resume=process.argv[5]==='--resume';
const root=resolve(prepared),output=join(root,phase!);await mkdir(output,{recursive:resume});
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const codeFreeze=JSON.parse(await readFile(join(root,'code-freeze.json'),'utf8'));for(const [path,expected] of Object.entries(codeFreeze.files)){if(createHash('sha256').update(await readFile(path)).digest('hex')!==expected)throw Error('Compiled evaluation policy changed after freeze');}
const frozen=JSON.parse(await readFile(join(root,'frozen.json'),'utf8'));
const modes:string[]=frozen.evaluationModes??['current-only','recent-5min','full-history'];
const smokeExecutions=6*modes.length;
const memoryRoot=frozen.memoryDirectory??join(root,'memory');
const publicText=await readFile(join(root,'model-questions.json'),'utf8'),rowText=await readFile(join(root,'model-replay','observations.jsonl'),'utf8');
if(digest(publicText)!==frozen.publicTasksSha256||digest(rowText)!==frozen.replaySha256)throw Error('Frozen input changed');
const rows=rowText.trim().split(/\r?\n/).map(s=>JSON.parse(s) as MemoryRow);
const summary=JSON.parse(await readFile(join(memoryRoot,'summary.json'),'utf8'));
if(summary.status.pending!==0)throw Error('Memory replay incomplete');
const smokeIds=new Set<string>(JSON.parse(await readFile(join(root,'smoke-ids.json'),'utf8')));
let questions=JSON.parse(publicText) as Array<{id:string;question:string;queryAtMs:number;currentObservationId:string}>;
if(phase==='smoke')questions=questions.filter(q=>smokeIds.has(q.id));
else{const gate=JSON.parse(await readFile(join(root,'smoke','complete.json'),'utf8'));const grading=JSON.parse(await readFile(join(root,'smoke-grading','complete.json'),'utf8'));if(gate.status!=='completed'||gate.executions!==smokeExecutions||grading.status!=='completed'||grading.grades!==smokeExecutions)throw Error('Smoke execution/grading gate not passed');}
const dbPath=join(memoryRoot,'topology.sqlite'),db=new DatabaseSync(dbPath,{readOnly:true});
const assignments=new Map((db.prepare('SELECT observation_id,place_id,reason FROM assignments').all() as Array<{observation_id:string;place_id:string|null;reason:string}>).map(a=>[a.observation_id,{placeId:a.place_id,reason:a.reason}]));db.close();
if(assignments.size!==rows.length)throw Error('Incomplete unified memory assignments');
const spatialRetriever=modes.includes('spatial-memory')?new SpatialRetriever(dbPath):null;
const oracleEvidence:Record<string,string[]>=modes.includes('memory-oracle')?JSON.parse(await readFile(join(root,'oracle-evidence.json'),'utf8')):{};
if(modes.includes('memory-oracle')&&digest(await readFile(join(root,'oracle-evidence.json'),'utf8'))!==frozen.oracleEvidenceSha256)throw Error('Oracle evidence selection changed');
let calls=0,input=0,outputTokens=0,missingUsage=false;const results:unknown[]=[];
const maxCalls=questions.length*modes.length*8,maxInput=phase==='smoke'?1500000:18000000,maxCost=phase==='smoke'?.5:3;
if(resume){
 const previous=JSON.parse(await readFile(join(output,'usage.json'),'utf8'));
 const saved=(await readFile(join(output,'results.jsonl'),'utf8')).trim().split(/\r?\n/).map(s=>JSON.parse(s));
 if(new Set(saved.map(r=>r.id+':'+r.mode)).size!==saved.length)throw Error('Duplicate prior results');
 results.push(...saved);calls=previous.calls;input=previous.inputTokens;outputTokens=previous.outputTokens;
 if(previous.missingUsage){input+=128000;outputTokens+=512;}
 await writeFile(join(output,`resume-${Date.now()}.json`),JSON.stringify({previousUsage:previous,retainedExecutions:saved.length,policy:'Keep aborted task as failure, no retry. Missing response reserves 128000 input/512 output tokens. Counts include reservations, not actual billing.'},null,2));
}
const cost=()=>input*.1356/1e6+outputTokens*.4584/1e6;
const ledger=async()=>writeFile(join(output,'usage.json'),JSON.stringify({calls,inputTokens:input,outputTokens,estimatedUSD:cost(),missingUsage,maxCalls,maxInputTokens:maxInput,maxEstimatedUSD:maxCost,priceSource:'Published PAI Token Service China Beijing rates; not invoice; caches charged at full input rate'},null,2));
await writeFile(join(output,'provenance.json'),JSON.stringify({model:'qwen3.8-flash',enableThinking:false,publicTasksSha256:frozen.publicTasksSha256,replaySha256:frozen.replaySha256,runnerSha256:digest(await readFile(new URL(import.meta.url),'utf8')),memorySha256:createHash('sha256').update(await readFile(dbPath)).digest('hex'),questionExecutions:questions.length*modes.length,maxCalls,maxInput,maxCost,modes,reasonScopePolicy:'Causal judgment availability watermark enforced. spatial-memory uses actual SpatialRetriever; oracle directly receives reference images.',note:'Spatial algorithm receives no private labels. Oracle intentionally receives reference IDs only, never answers.'},null,2));
try{
 for(const q of questions)for(const mode of modes){
  if((results as Array<{id:string;mode:string}>).some(r=>r.id===q.id&&r.mode===mode))continue;
  const trace:unknown[]=[];const log=(e:unknown)=>trace.push(e);
  const session=mode==='spatial-memory'?spatialAlgorithmSession(spatialRetriever!,rows,q.queryAtMs,log):mode==='memory-oracle'?oracleSession(rows,oracleEvidence[q.id]??[],q.queryAtMs,log):memorySession(rows,q.currentObservationId,q.queryAtMs,mode as MemoryMode,assignments,log);let expectedCalls=0,seenUsage=0;
  const supplied=mode==='memory-oracle'&&(oracleEvidence[q.id]?.length??0)>0?await session.inspect(oracleEvidence[q.id]!):[];
  const oracleContext=mode==='memory-oracle'?` ORACLE EVIDENCE: after the first three current images, historical images are already inspected and directly provided: ${JSON.stringify(supplied.map(s=>({id:s.id,index:s.index,atMs:s.atMs})))}. Cite their IDs directly; no retrieval needed. If none are supplied, the requested unknown fact is not supported; do not fabricate. No answer labels are provided.`:'';
  const current=rows.find(r=>r.id===q.currentObservationId)!;
  for(const view of ['front','left','right'])if(createHash('sha256').update(await readFile(current.cameras[view]!)).digest('hex')!==current.sha256[view])throw Error('Current frame integrity mismatch before provider call');
  const agent=new RequestAgent(null,session,event=>{
   trace.push(event);
   if(event.role==='assistant'){
    const u=event.usage as {input?:number;output?:number;cacheRead?:number;cacheWrite?:number}|undefined;
    if(!u||![u.input,u.output].every(Number.isFinite)){missingUsage=true;return;}
    input+=u.input!+(u.cacheRead??0)+(u.cacheWrite??0);outputTokens+=u.output!;seenUsage++;
   }
  },{beforeModelCall:()=>{
   if(missingUsage||calls>=maxCalls||expectedCalls>=8||input+128000>maxInput||cost()+(128000*.1356+512*.4584)/1e6>maxCost)throw Error('Pre-call evaluation budget reached');
   calls++;expectedCalls++;
  },providedEvidence:supplied.map(s=>({type:'image' as const,data:s.data,mimeType:s.mimeType})),contextText:`Trusted recording context: current record is 第${current.episodeNumber}段${current.sourceAtMs/1000}秒. Three current images are front, left, right. For a question naming 第N段T秒, SEARCH the exact reference string 第N段T秒, then INSPECT its returned ID; do not substitute a nearby time or a semantically similar room. You can also SEARCH current record this way before citing its visible facts. The tool enforces ${mode} access; unavailable history is not proof of absence. Current and historical source times differ from the synthetic activity clock. No off-camera transit is known.${oracleContext}`});
  agent.set('ask',q.question);
  let record:Record<string,unknown>;
  try{
   const result=await agent.observe(['front','left','right'].map(view=>({id:current.id,path:current.cameras[view]!,timestampMs:current.atMs})),null,null);
   record={id:q.id,mode,result,inspectedIds:[...session.inspected]};
  }catch(e){record=e instanceof HistoricalAnswerValidationError?{id:q.id,mode,modelOutputRejected:true,rejection:String(e),result:{raw:e.rawAnswer},inspectedIds:[...session.inspected]}:{id:q.id,mode,error:String(e),inspectedIds:[...session.inspected]};}
  if(expectedCalls!==seenUsage)missingUsage=true;
  results.push(record);await writeFile(join(output,`${q.id}-${mode}-trace.json`),JSON.stringify(trace,null,2));await appendFile(join(output,'results.jsonl'),JSON.stringify(record)+'\n');await ledger();
  if('error' in record||missingUsage)throw Error('Stopped on runtime/schema/billing-usage failure; preserved result and trace');
 }
 const historyInspections=(results as Array<{mode:string;id:string;inspectedIds:string[]}>).filter(r=>r.mode==='full-history'&&r.inspectedIds.some(id=>id!==questions.find(q=>q.id===r.id)!.currentObservationId)).length;
 if(phase==='smoke'&&!frozen.evaluationModes&&historyInspections<2)throw Error('Smoke gate: insufficient successful historical inspection operations');
 await writeFile(join(output,'complete.json'),JSON.stringify({status:'completed',executions:results.length,planned:questions.length*modes.length,historyInspections,grading:'pending; execution success is not answer accuracy'},null,2));
}catch(error){await ledger();await writeFile(join(output,'stopped.json'),JSON.stringify({error:String(error),executions:results.length,planned:questions.length*modes.length},null,2));throw error;}
