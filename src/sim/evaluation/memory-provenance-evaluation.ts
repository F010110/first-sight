/** Fresh matched evaluation with explicit input provenance and bounded repair. */
import {readFile,writeFile,appendFile,mkdir,copyFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
import {SpatialRetriever} from '../../agent/spatial-retrieve.js';import {RequestAgent,HistoricalAnswerValidationError} from '../../agent/request-agent.js';
import {spatialAlgorithmSession,oracleSession} from './spatial-memory-evaluation-session.js';import {withCurrentEvidence} from './current-evidence-session.js';
import {answerFailures,repairFeedback,publicRequiredEvidenceIds,type RepairQuestion} from './memory-answer-repair.js';import type {MemoryRow} from './memory-evaluation-session.js';
import {wallTime,type MemoryClock} from '../../agent/memory-clock.js';
const [original,destination,phase,paid]=process.argv.slice(2);if(!original||!destination||!['smoke','full','probe'].includes(phase??'')||paid!=='--confirm-paid')throw Error('Usage: original-group NEW-root smoke|full|probe --confirm-paid');
const source=resolve(original),root=resolve(destination);const json=async(p:string)=>JSON.parse(await readFile(p,'utf8'));const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const frozen=await json(join(source,'frozen.json'));const mode=frozen.evaluationModes[0];if(!['spatial-memory','memory-oracle'].includes(mode))throw Error('Invalid mode');
const artifacts=['./memory-provenance-evaluation.js','./current-evidence-session.js','./memory-answer-repair.js','./spatial-memory-evaluation-session.js','./memory-evaluation-grade.js','../../agent/request-agent.js','../../agent/qwen-provider.js','../../agent/spatial-retrieve.js','../../agent/memory-summary.js','../../agent/memory-clock.js','../../agent/locked-protocol.js'];
if(phase==='smoke'||phase==='probe'){
  await mkdir(root,{recursive:false});await mkdir(join(root,'model-replay'));for(const name of ['frozen.json','model-questions.json','smoke-ids.json'])await copyFile(join(source,name),join(root,name));await copyFile(join(source,'model-replay/observations.jsonl'),join(root,'model-replay/observations.jsonl'));if(mode==='memory-oracle')await copyFile(join(source,'oracle-evidence.json'),join(root,'oracle-evidence.json'));
  const calendarArg=process.argv.find(a=>a.startsWith('--calendar='));if(!calendarArg)throw Error('Final candidate requires --calendar=directory containing clock.json and calendar-questions.json');
  for(const name of ['clock.json','calendar-questions.json'])await copyFile(join(resolve(calendarArg.slice(11)),name),join(root,name));
 const files:Record<string,string>={};for(const file of artifacts){const url=new URL(file,import.meta.url);files[url.pathname.replace(/^\/(\w:)/,'$1')]=digest(await readFile(url));}
  for(const name of ['clock.json','calendar-questions.json'])files[join(root,name)]=digest(await readFile(join(root,name)));
  await writeFile(join(root,'code-freeze.json'),JSON.stringify({files,policy:'Calendar matched candidate; one locked metadata continuation, no factual retries; original answers/failures retained; no answer labels used.'},null,2));
}else{const gate=await json(join(root,'smoke/complete.json')),grading=await json(join(root,'smoke-grading/complete.json'));if(gate.executions!==6||grading.grades!==6)throw Error('Smoke gate incomplete');}
const codeFreeze=await json(join(root,'code-freeze.json'));for(const [p,expected] of Object.entries(codeFreeze.files))if(digest(await readFile(p))!==expected)throw Error('Frozen code changed');
const output=join(root,phase!);await mkdir(output,{recursive:false});
const text=await readFile(join(root,'model-replay/observations.jsonl'),'utf8');if(digest(Buffer.from(text))!==frozen.replaySha256||digest(await readFile(join(root,'model-questions.json')))!==frozen.publicTasksSha256)throw Error('Frozen data changed');
const rows:MemoryRow[]=text.trim().split(/\r?\n/).map(s=>JSON.parse(s));let questions:RepairQuestion[]=await json(join(root,'model-questions.json'));
const calendar=await json(join(root,'clock.json'));const clock:MemoryClock=calendar.clock;
if(calendar.replaySha256!==frozen.replaySha256)throw Error('Calendar replay mismatch');
const calendarQuestions:Array<RepairQuestion&{originalQuestion:string}>=await json(join(root,'calendar-questions.json'));
if(calendarQuestions.length!==questions.length||new Set(calendarQuestions.map(q=>q.id)).size!==questions.length||questions.some(q=>{const c=calendarQuestions.find(c=>c.id===q.id);return !c||c.originalQuestion!==q.question||c.currentObservationId!==q.currentObservationId||c.queryAtMs!==q.queryAtMs;}))throw Error('Calendar questions mismatch');
for(const q of questions){const expected=q.question.replace(/第\s*(\d+)\s*段\s*([\d.]+)\s*秒/g,(reference:string,episode:string,seconds:string)=>{const row=rows.find(r=>r.episodeNumber===Number(episode)&&Math.abs(r.sourceAtMs-Number(seconds)*1000)<1&&r.atMs<q.queryAtMs);return row?wallTime(row.atMs,clock):reference;});if(calendarQuestions.find(c=>c.id===q.id)!.question!==expected)throw Error('Calendar question changed beyond deterministic time substitution');}
if(process.argv.includes('--prepare-only')){await writeFile(join(root,'prepare-only.json'),JSON.stringify({status:'validated-no-model-calls',mode,questions:questions.length,clock,policy:'Prepared smoke folder contains no results; remove only this empty phase folder or choose a fresh destination for online smoke.'},null,2));console.log('Validated calendar/frozen inputs; no model calls');process.exit(0);}
if(phase==='full'){
 const smoke=(await readFile(join(root,'smoke/results.jsonl'),'utf8')).trim().split(/\r?\n/).map(s=>JSON.parse(s));
 const last=new Map<string,any>();for(const line of (await readFile(join(root,'smoke/attempts.jsonl'),'utf8')).trim().split(/\r?\n/)){const a=JSON.parse(line);last.set(a.id,a);}
 for(const record of smoke){const q=questions.find(q=>q.id===record.id)!;if(record.error||last.get(q.id)?.reasons.length||publicRequiredEvidenceIds(q,rows).some(id=>!record.inspectedIds.includes(id)))throw Error('Smoke protocol/source-access regression gate failed: no full run allowed');}
}
if(phase==='smoke'){const ids=new Set(await json(join(root,'smoke-ids.json')));questions=questions.filter(q=>ids.has(q.id));}
if(phase==='probe'){const ids=new Set(['memq-4ed2448d7483a34fc8ed','memq-47587af31a4fd8050960','memq-983dc861509563837d9a','memq-64c5afefa92718875164','memq-8798429e32ee4fefac0c','memq-42c2ac7529cc9c3b9990']);questions=questions.filter(q=>ids.has(q.id));await writeFile(join(root,'probe-policy.json'),JSON.stringify({developmentOnly:true,selection:'four known source-confusion failures and two refusal-flag failures; no fresh accuracy claim',ids:[...ids],fullRunAuthorized:false},null,2));}
const oracle:Record<string,string[]>=mode==='memory-oracle'?await json(join(root,'oracle-evidence.json')):{};
if(mode==='memory-oracle'&&digest(await readFile(join(root,'oracle-evidence.json')))!==frozen.oracleEvidenceSha256)throw Error('Oracle evidence changed');
const retriever=new SpatialRetriever(join(frozen.memoryDirectory,'topology.sqlite'));
let calls=0,input=0,outTokens=0,unknown=0,executions=0;const maxCalls=phase==='full'?1080:144,maxCost=phase==='full'?2:.5;
const cost=()=>((input+unknown*128000)*.1356+(outTokens+unknown*512)*.4584)/1e6;
const ledger=()=>writeFile(join(output,'usage.json'),JSON.stringify({calls,inputTokens:input,outputTokens:outTokens,unknownCallsReserved:unknown,estimatedUSD:cost(),maxCalls,maxEstimatedUSD:maxCost,estimate:'Public list rates including reservations; not invoice'},null,2));
try{
 for(const q of questions){
  const current=rows.find(r=>r.id===q.currentObservationId)!;for(const view of ['front','left','right'])if(digest(await readFile(current.cameras[view]!))!==current.sha256[view])throw Error('Current image mismatch');
  let record:any=null,reasons:string[]=[],previous='';
   for(let attempt=0;attempt<1;attempt++){
   const trace:unknown[]=[];const log=(v:unknown)=>trace.push(v);
    const base=mode==='spatial-memory'?spatialAlgorithmSession(retriever!,rows,q.queryAtMs,log,clock):oracleSession(rows,oracle[q.id]??[],q.queryAtMs,log);
    if(mode==='memory-oracle')base.memorySummary=()=>spatialAlgorithmSession(retriever,rows,q.queryAtMs,()=>{},clock).memorySummary!();
   const historical=(oracle[q.id]??[]).filter(id=>id!==current.id);const supplied=historical.length?await base.inspect(historical):[];
   const session=withCurrentEvidence(base,current.id);let local=0,seen=0;
   trace.push({operation:'provided-input-provenance',current:{id:current.id,episodeNumber:current.episodeNumber,sourceAtMs:current.sourceAtMs,activityAtMs:current.atMs},historical:supplied.map(s=>{const row=rows.find(r=>r.id===s.id)!;return {id:s.id,index:s.index,episodeNumber:row.episodeNumber,sourceAtMs:row.sourceAtMs,activityAtMs:s.atMs};})});
   const feedback=attempt?repairFeedback(previous,reasons):'';
   const agent=new RequestAgent(null,session,e=>{trace.push(e);if(e.role==='assistant'){const u=e.usage as any;if(u&&Number.isFinite(u.input)&&Number.isFinite(u.output)){input+=u.input+(u.cacheRead??0)+(u.cacheWrite??0);outTokens+=u.output;seen++;}}},{
     currentEvidenceLabels:['front','left','right'].map(camera=>`NEXT IMAGE: CURRENT sourceId=${current.id}; calendarTime=${wallTime(current.atMs,clock)} (${clock.kind}); sourceReference=第${current.episodeNumber}段${current.sourceAtMs/1000}秒; camera=${camera}.`),
     providedEvidenceLabels:supplied.map(s=>{const row=rows.find(r=>r.id===s.id)!;return `NEXT IMAGE: HISTORICAL sourceId=${s.id}; calendarTime=${wallTime(row.atMs,clock)} (${clock.kind}); sourceReference=第${row.episodeNumber}段${row.sourceAtMs/1000}秒; camera=${['front','left','right'][s.index]}.`; }),
    jsonOutput:true,requiredEvidenceIds:[...new Set([current.id,...publicRequiredEvidenceIds(q,rows)])],beforeModelCall(){if(calls>=maxCalls||cost()+(128000*.1356+512*.4584)/1e6>maxCost)throw Error('Global provenance evaluation budget reached');if(local>=8)throw Error('Local attempt exhausted');calls++;local++;},providedEvidence:supplied.map(s=>({type:'image' as const,data:s.data,mimeType:s.mimeType})),
    contextText:`INPUT PROVENANCE: first 3 images are front,left,right CURRENT observation ${current.id}, 第${current.episodeNumber}段${current.sourceAtMs/1000}秒. These current images have ALREADY been supplied, viewed and registered as valid evidence. Cite current ID directly: NO search or re-inspection required for current facts. Historical facts must cite the specifically requested record actually inspected, not another similar room. Query 第N段T秒 for explicit recording timestamps. For comparisons cite each part's source, including current ID. ACTIVITY atMs is a synthetic clock, NOT seconds within a recording. Source references below explicitly map the requested recording time to each image. Do not infer same physical floor from similar decorations. abstained must agree with the answer; do not invent facts. ${mode==='memory-oracle'?`Additional image order after the 3 current images: ${JSON.stringify(supplied.map(s=>{const row=rows.find(r=>r.id===s.id)!;return {id:s.id,camera:['front','left','right'][s.index],sourceReference:`第${row.episodeNumber}段${row.sourceAtMs/1000}秒`,episodeNumber:row.episodeNumber,sourceAtMs:row.sourceAtMs,activityAtMs:s.atMs};}))}. These historical images also have already been inspected; cite their IDs directly. Do NOT claim a named source record is absent when its sourceReference appears in this supplied list. No search is needed to see it.`:''}\n${feedback}`
    });agent.set('ask',calendarQuestions.find(c=>c.id===q.id)!.question);
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
  await writeFile(join(output,'complete.json'),JSON.stringify({status:'completed',executions,planned:questions.length,protocol:'calendar + causal summary + one factual execution with at most one locked metadata continuation; all failures retained'},null,2));
}catch(e){await ledger();await writeFile(join(output,'stopped.json'),JSON.stringify({error:String(e),executions,planned:questions.length},null,2));throw e;}finally{retriever?.close();}
