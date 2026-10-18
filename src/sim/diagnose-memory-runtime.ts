/** Small paid factorial probe: same public tasks/images/retriever; vary ONE
 * runtime prompt or JSON mode, never read an answer key or auto-launch full QA. */
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';import {resolve,join} from 'node:path';
import {RequestAgent,HistoricalAnswerValidationError} from '../agent/request-agent.js';import {SpatialRetriever} from '../agent/spatial-retrieve.js';
import {spatialAlgorithmSession} from './spatial-memory-evaluation-session.js';import {withCurrentEvidence} from './current-evidence-session.js';
import type {MemoryRow} from './memory-evaluation-session.js';import {publicRequiredEvidenceIds,type RepairQuestion} from './memory-answer-repair.js';
const [prepared,destination,paid]=process.argv.slice(2);if(!prepared||!destination||paid!=='--confirm-paid')throw Error('Usage: prepared NEW-output --confirm-paid');
const fixed=process.argv[5]==='--fixed';
const root=resolve(destination);await mkdir(root,{recursive:false});const source=resolve(prepared);
const frozen=JSON.parse(await readFile(join(source,'frozen.json'),'utf8'));const rows:MemoryRow[]=(await readFile(join(source,'model-replay/observations.jsonl'),'utf8')).trim().split(/\r?\n/).map(s=>JSON.parse(s));
const questions:RepairQuestion[]=JSON.parse(await readFile(join(source,'model-questions.json'),'utf8'));
const ids=['memq-33ab74de7b6e8378f0bb','memq-14a29ad4f6c71bc8fbba'];const retriever=new SpatialRetriever(join(frozen.memoryDirectory,'topology.sqlite'));
let calls=0,input=0,output=0;const results:unknown[]=[];const cost=()=>input*.1356/1e6+output*.4584/1e6;
await writeFile(join(root,'plan.json'),JSON.stringify({questionIds:ids,selection:'Two already-known development failures, no accuracy claims',fixed,repeats:fixed?3:1,factors:{prompt:fixed?['provenance']:['original','provenance'],jsonOutput:fixed?[true]:[false,true]},maxCalls:64,maxEstimatedUSD:.5,model:'qwen3.8-flash',enableThinking:false},null,2));
try{
 for(const id of ids)for(const prompt of fixed?['provenance']:['original','provenance'])for(const jsonOutput of fixed?[true]:[false,true])for(let repeat=0;repeat<(fixed?3:1);repeat++){
  const q=questions.find(q=>q.id===id)!;const current=rows.find(r=>r.id===q.currentObservationId)!;const trace:unknown[]=[];let local=0,seen=0;
  const session=withCurrentEvidence(spatialAlgorithmSession(retriever,rows,q.queryAtMs,e=>trace.push(e)),current.id);
  const originalContext=`Trusted recording context: current record is 第${current.episodeNumber}段${current.sourceAtMs/1000}秒. Three current images are front, left, right. For a question naming 第N段T秒, SEARCH the exact reference string 第N段T秒, then INSPECT its returned ID; do not substitute a nearby time or a semantically similar room. You can also SEARCH current record this way before citing its visible facts. The tool enforces spatial-memory access; unavailable history is not proof of absence. Current and historical source times differ from the synthetic activity clock. No off-camera transit is known.`;
  const provenanceContext=`INPUT PROVENANCE: first 3 images are front,left,right CURRENT observation ${current.id}, 第${current.episodeNumber}段${current.sourceAtMs/1000}秒. These current images have ALREADY been supplied, viewed and registered as valid evidence. Cite current ID directly: NO search or re-inspection required for current facts. Historical facts must cite the specifically requested record actually inspected, not another similar room. Query 第N段T秒 for explicit recording timestamps. For comparisons cite each part's source, including current ID. ACTIVITY atMs is a synthetic clock, NOT seconds within a recording. Do not infer same physical floor from similar decorations. abstained must agree with the answer; do not invent facts.`;
  const required=[...new Set([current.id,...publicRequiredEvidenceIds(q,rows)])];
  const agent=new RequestAgent(null,session,e=>{trace.push(e);if(e.role==='assistant'){const u=e.usage as any;if(u&&Number.isFinite(u.input)&&Number.isFinite(u.output)){input+=u.input+(u.cacheRead??0)+(u.cacheWrite??0);output+=u.output;seen++;}}},{jsonOutput,...fixed?{requiredEvidenceIds:required}:{},contextText:prompt==='original'?originalContext:provenanceContext,beforeModelCall(){if(calls>=64||local>=8||cost()+(128000*.1356+512*.4584)/1e6>.5)throw Error('Diagnostic budget reached');calls++;local++;}});
  agent.set('ask',q.question);let result:unknown,error:string|undefined;
  try{result=await agent.observe(['front','left','right'].map(view=>({id:current.id,path:current.cameras[view]!,timestampMs:current.atMs})),null,null);}catch(e){error=String(e);if(e instanceof HistoricalAnswerValidationError)result={raw:e.rawAnswer};}
  const operations=trace.filter((e:any)=>e.operation) as any[];
  const receipt={id,prompt,jsonOutput,repeat,calls:local,result,error,requiredIds:fixed?required:undefined,searches:operations.filter(e=>e.operation==='SpatialRetriever.search').length,inspects:operations.filter(e=>e.operation==='SpatialRetriever.inspect').length,inspectedIds:[...session.inspected]};
  results.push(receipt);await appendFile(join(root,'results.jsonl'),JSON.stringify(receipt)+'\n');await writeFile(join(root,`${id}-${prompt}-${jsonOutput}-${repeat}-trace.json`),JSON.stringify(trace,null,2));await writeFile(join(root,'usage.json'),JSON.stringify({calls,inputTokens:input,outputTokens:output,estimatedUSD:cost()},null,2));
  if(local!==seen)throw Error('Diagnostic usage missing; stopped');
  if(fixed&&(error||!required.every(id=>session.inspected.has(id))))throw Error('Fixed-runtime regression gate failed; do not launch full evaluation');
 }
 await writeFile(join(root,'complete.json'),JSON.stringify({status:'completed',executions:results.length},null,2));console.log(JSON.stringify(results,null,2));
}finally{retriever.close();}
