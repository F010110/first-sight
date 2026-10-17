/** Model execution reads public questions and model memory ONLY, never answers. */
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {DatabaseSync} from 'node:sqlite';import {createHash} from 'node:crypto';
import {RequestAgent,HistoricalAnswerValidationError} from '../agent/request-agent.js';
import {memorySession,type MemoryRow,type MemoryMode} from './memory-evaluation-session.js';

const [prepared,phase,paid]=process.argv.slice(2);if(!prepared||!['smoke','full'].includes(phase??'')||paid!=='--confirm-paid')throw Error('Usage: prepared smoke|full --confirm-paid');
const root=resolve(prepared),output=join(root,phase!);await mkdir(output,{recursive:false});
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const codeFreeze=JSON.parse(await readFile(join(root,'code-freeze.json'),'utf8'));for(const [path,expected] of Object.entries(codeFreeze.files)){if(createHash('sha256').update(await readFile(path)).digest('hex')!==expected)throw Error('Compiled evaluation policy changed after freeze');}
const frozen=JSON.parse(await readFile(join(root,'frozen.json'),'utf8'));
const memoryRoot=frozen.memoryDirectory??join(root,'memory');
const publicText=await readFile(join(root,'model-questions.json'),'utf8'),rowText=await readFile(join(root,'model-replay','observations.jsonl'),'utf8');
if(digest(publicText)!==frozen.publicTasksSha256||digest(rowText)!==frozen.replaySha256)throw Error('Frozen input changed');
const rows=rowText.trim().split(/\r?\n/).map(s=>JSON.parse(s) as MemoryRow);
const summary=JSON.parse(await readFile(join(memoryRoot,'summary.json'),'utf8'));
if(summary.status.pending!==0)throw Error('Memory replay incomplete');
const smokeIds=new Set<string>(JSON.parse(await readFile(join(root,'smoke-ids.json'),'utf8')));
let questions=JSON.parse(publicText) as Array<{id:string;question:string;queryAtMs:number;currentObservationId:string}>;
if(phase==='smoke')questions=questions.filter(q=>smokeIds.has(q.id));
else{const gate=JSON.parse(await readFile(join(root,'smoke','complete.json'),'utf8'));const grading=JSON.parse(await readFile(join(root,'smoke-grading','complete.json'),'utf8'));if(gate.status!=='completed'||gate.executions!==18||grading.status!=='completed'||grading.grades!==18)throw Error('Smoke execution/grading gate not passed');}
const dbPath=join(memoryRoot,'topology.sqlite'),db=new DatabaseSync(dbPath,{readOnly:true});
const assignments=new Map((db.prepare('SELECT observation_id,place_id,reason FROM assignments').all() as Array<{observation_id:string;place_id:string|null;reason:string}>).map(a=>[a.observation_id,{placeId:a.place_id,reason:a.reason}]));db.close();
if(assignments.size!==rows.length)throw Error('Incomplete unified memory assignments');
let calls=0,input=0,outputTokens=0,missingUsage=false;const results:unknown[]=[];
const maxCalls=questions.length*3*8,maxInput=phase==='smoke'?1500000:18000000,maxCost=phase==='smoke'?.5:3;
const cost=()=>input*.1356/1e6+outputTokens*.4584/1e6;
const ledger=async()=>writeFile(join(output,'usage.json'),JSON.stringify({calls,inputTokens:input,outputTokens,estimatedUSD:cost(),missingUsage,maxCalls,maxInputTokens:maxInput,maxEstimatedUSD:maxCost,priceSource:'Published PAI Token Service China Beijing rates; not invoice; caches charged at full input rate'},null,2));
await writeFile(join(output,'provenance.json'),JSON.stringify({model:'qwen3.8-flash',enableThinking:false,publicTasksSha256:frozen.publicTasksSha256,replaySha256:frozen.replaySha256,runnerSha256:digest(await readFile(new URL(import.meta.url),'utf8')),memorySha256:createHash('sha256').update(await readFile(dbPath)).digest('hex'),questionExecutions:questions.length*3,maxCalls,maxInput,maxCost,reasonScopePolicy:'Only full-history exposes per-observation judgments after window availability watermark; bounded controls suppress inherited full-context judgments.',note:'No private questions/answers/labels read by this executor.'},null,2));
try{
 for(const q of questions)for(const mode of ['current-only','recent-5min','full-history'] as MemoryMode[]){
  const trace:unknown[]=[];const session=memorySession(rows,q.currentObservationId,q.queryAtMs,mode,assignments,e=>trace.push(e));let expectedCalls=0,seenUsage=0;
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
  },contextText:`Trusted recording context: current record is 第${current.episodeNumber}段${current.sourceAtMs/1000}秒. Three current images are front, left, right. For a question naming 第N段T秒, SEARCH the exact reference string 第N段T秒, then INSPECT its returned ID; do not substitute a nearby time or a semantically similar room. You can also SEARCH current record this way before citing its visible facts. The tool enforces ${mode} access; unavailable history is not proof of absence. Current and historical source times differ from the synthetic activity clock. No off-camera transit is known.`});
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
 if(phase==='smoke'&&historyInspections<2)throw Error('Smoke gate: insufficient successful historical inspection operations');
 await writeFile(join(output,'complete.json'),JSON.stringify({status:'completed',executions:results.length,planned:questions.length*3,historyInspections,grading:'pending; execution success is not answer accuracy'},null,2));
}catch(error){await ledger();await writeFile(join(output,'stopped.json'),JSON.stringify({error:String(error),executions:results.length,planned:questions.length*3},null,2));throw error;}
