/** Public-only causal construction + questions. Private truth is read solely
 * by the independent existing grader process, never this process or the VLM. */
import {mkdir,readFile,writeFile,appendFile,copyFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
import {SpatialContextMemory} from '../agent/spatial-context-memory.js';import {SpatialContextLoop} from '../agent/spatial-context-loop.js';import {spatialContextVlm} from '../agent/spatial-context-vlm.js';
import {publicRequiredEvidenceIds,answerFailures,type RepairQuestion} from './memory-answer-repair.js';import type {MemoryRow} from './memory-evaluation-session.js';import {interleavedSchedule} from './interleaved-memory-schedule.js';import {wallTime,type MemoryClock} from '../agent/memory-clock.js';
const [sourceArg,calendarArg,outArg,phase,paid]=process.argv.slice(2);if(!sourceArg||!calendarArg||!outArg||!['smoke','full'].includes(phase??'')||paid!=='--confirm-paid')throw Error('Usage: original-group calendar-directory NEW-output smoke|full --confirm-paid');
const source=resolve(sourceArg),calendar=resolve(calendarArg),root=resolve(outArg),hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),load=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
const frozen=await load(join(source,'frozen.json')),replay=await readFile(join(source,'model-replay/observations.jsonl')),publicBytes=await readFile(join(source,'model-questions.json'));
if(hash(replay)!==frozen.replaySha256||hash(publicBytes)!==frozen.publicTasksSha256)throw Error('Original public data changed');
const rows:MemoryRow[]=replay.toString().trim().split(/\r?\n/).map(s=>JSON.parse(s)),originals:RepairQuestion[]=JSON.parse(publicBytes.toString());
const clockFile=await load(join(calendar,'clock.json')),clock:MemoryClock=clockFile.clock;if(clockFile.replaySha256!==hash(replay))throw Error('Calendar clock mismatch');
let questions:Array<RepairQuestion&{originalQuestion:string}>=await load(join(calendar,'calendar-questions.json'));
if(questions.length!==90||new Set(questions.map(q=>q.id)).size!==90)throw Error('Expected 90 unique questions');
for(const q of questions){const old=originals.find(o=>o.id===q.id);if(!old||q.originalQuestion!==old.question||q.queryAtMs!==old.queryAtMs||q.currentObservationId!==old.currentObservationId)throw Error('Calendar identity mismatch');const expected=old.question.replace(/第\s*(\d+)\s*段\s*([\d.]+)\s*秒/g,(reference:string,episode:string,seconds:string)=>{const row=rows.find(r=>r.episodeNumber===Number(episode)&&Math.abs(r.sourceAtMs-Number(seconds)*1000)<1&&r.atMs<q.queryAtMs);return row?wallTime(row.atMs,clock):reference;});if(q.question!==expected)throw Error('Question changed beyond calendar substitution');}
questions.sort((a,b)=>a.queryAtMs-b.queryAtMs||a.id.localeCompare(b.id));if(phase==='smoke')questions=questions.slice(0,6);
const end=phase==='smoke'?questions[questions.length-1]!.queryAtMs:Infinity;
const observations=rows.filter(r=>r.atMs<end).map(r=>({id:r.id,atMs:r.atMs,sourceAtMs:r.sourceAtMs,recordingId:String(r.episodeNumber),frames:['front','left','right'].map(camera=>r.cameras[camera]!)}));
const events=interleavedSchedule(observations,questions);
await mkdir(root,{recursive:false});await mkdir(join(root,'model-replay'));await mkdir(join(root,phase!));
await copyFile(join(source,'model-replay/observations.jsonl'),join(root,'model-replay/observations.jsonl'));await writeFile(join(root,'model-questions.json'),publicBytes);
await copyFile(join(calendar,'clock.json'),join(root,'clock.json'));await copyFile(join(calendar,'calendar-questions.json'),join(root,'calendar-questions.json'));
const files:Record<string,string>={};for(const name of ['interleaved-memory-evaluation','interleaved-memory-schedule','memory-evaluation-grade','memory-answer-repair']){const url=new URL(`./${name}.js`,import.meta.url);files[url.pathname.replace(/^\/(\w:)/,'$1')]=hash(await readFile(url));}
for(const name of ['spatial-context-loop','spatial-context-protocol','spatial-context-memory','spatial-context-vlm','spatial-working-context','spatial-sqlite-store','spatial-retrieve','memory-clock','bounded-network-retry']){const url=new URL(`../agent/${name}.js`,import.meta.url);files[url.pathname.replace(/^\/(\w:)/,'$1')]=hash(await readFile(url));}
for(const name of ['clock.json','calendar-questions.json','model-questions.json'])files[join(root,name)]=hash(await readFile(join(root,name)));
await writeFile(join(root,'code-freeze.json'),JSON.stringify({files},null,2));await writeFile(join(root,'frozen.json'),JSON.stringify({...frozen,evaluationModes:['spatial-context-interleaved'],evaluationStatus:'fresh-interleaved-not-scored'},null,2));
await writeFile(join(root,'plan.json'),JSON.stringify({protocol:'interleaved-context-v1',phase,questions:questions.map(q=>q.id),events:events.length,observations:observations.length,clock,ordering:'queryAtMs then ID, including simultaneous questions',maxEstimatedUSD:3,policy:'New memory; no old database, no Context restore; every Q/A retained in subsequent short and long memory. Changed sequential-interaction condition, not directly equivalent to independent old questions.'},null,2));
if(process.argv.includes('--prepare-only')){console.log(JSON.stringify({status:'prepared-no-paid-calls',questions:questions.length,observations:observations.length,events:events.length}));process.exit(0);}
const memory=new SpatialContextMemory(join(root,'memory.sqlite'),clock);let loop:SpatialContextLoop;
const model=spatialContextVlm(join(root,'requests'),events.length*4,3,async(atMs,value)=>{await memory.writeOutput(atMs,value);try{const body=JSON.parse((value as {rawResponse:string}).rawResponse);JSON.parse(body.choices[0].message.content);}catch{loop.context.recordOutput(atMs,value);}},clock);
loop=new SpatialContextLoop(memory,model,4);let executed=0;
try{for(const [index,event] of events.entries()){
 for(const observation of event.observations){const row=rows.find(r=>r.id===observation.id)!;for(const camera of ['front','left','right'])if(hash(await readFile(row.cameras[camera]!))!==row.sha256[camera])throw Error('Image hash mismatch');}
 const q=event.question,old=q?originals.find(o=>o.id===q.id)!:null;
 const result=await loop.runWindow(event.observations,q?.question??null,{requiredEvidenceIds:old?publicRequiredEvidenceIds(old,rows):[]});
 await appendFile(join(root,'events.jsonl'),JSON.stringify({index,atMs:event.atMs,ids:event.observations.map(o=>o.id),questionId:q?.id??null,result,context:loop.context.view()})+'\n');
 if(q){let record:any={id:q.id,mode:'spatial-context-interleaved',error:'Question exhausted bounded control budget',inspectedIds:[]};
  if(result.status==='answered'){const raw=JSON.stringify({kind:'question',answer:result.answer,historicalEvidenceIds:result.sourceIds,abstained:result.abstained});const reasons=answerFailures(raw,old!,rows,new Set(result.inspectedIds));record={id:q.id,mode:'spatial-context-interleaved',result:{raw},inspectedIds:result.inspectedIds,modelOutputRejected:reasons.length>0,rejection:reasons.join(' ')};}
  await appendFile(join(root,phase!,'results.jsonl'),JSON.stringify(record)+'\n');executed++;
 }
 // Exhausting optional search/inspect rounds is not missing spatial inference:
 // valid assessments were already durably committed. Preserve that status,
 // but stop only when observations actually remain unassessed.
 if(memory.counts().pending)throw Error('Spatial construction incomplete; preserve run and stop');
 await writeFile(join(root,'progress.json'),JSON.stringify({events:index+1,totalEvents:events.length,questions:executed,counts:memory.counts()}));
}if(executed!==questions.length)throw Error('Question count mismatch');await writeFile(join(root,phase!,'complete.json'),JSON.stringify({status:'completed',executions:executed,observations:observations.length,events:events.length,protocol:'interleaved-context-v1'}));}
catch(error){await writeFile(join(root,'stopped.json'),JSON.stringify({error:String(error),questions:executed}));throw error;}finally{memory.close();}
