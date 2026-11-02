import {readFile,mkdir,writeFile,appendFile,stat,statfs} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createThreeAgentService} from '../../assistant/three-agent-factory.js';

const sha=(raw:string|Buffer)=>createHash('sha256').update(raw).digest('hex');
const [frozenArg,outArg,...flags]=process.argv.slice(2);
if(!frozenArg||!outArg||flags.length!==1||flags[0]!=='--confirm-paid')throw Error('Usage: run-unioncity-questions90 FROZEN-DIR NEW-OUTPUT --confirm-paid');
const freeze=resolve(frozenArg),out=resolve(outArg);
const load=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
const manifest=await load(join(freeze,'frozen.json')),taskRaw=await readFile(join(freeze,'tasks.json'));
if(manifest.questions!==90||manifest.hashes['tasks.json']!==sha(taskRaw))throw Error('Question freeze changed');
const tasks=JSON.parse(taskRaw.toString()) as Array<{id:string;queryAtMs:number;sourceQueryAtMs:number;question:string;currentObservationId:string}>;
if(tasks.length!==90||new Set(tasks.map(t=>t.id)).size!==90||tasks.some((t,i)=>i>0&&t.queryAtMs<tasks[i-1]!.queryAtMs))throw Error('Invalid task order');
const inputRaw=await readFile(manifest.publicInputPath);if(sha(inputRaw)!==manifest.publicInputSHA256)throw Error('Public input changed');
const input=JSON.parse(inputRaw.toString()),rows=input.observations as Array<{id:string;atMs:number;sourceAtMs:number;views:Array<{direction:string;path:string;sha256:string}>}>;
if(input.clock!=='user-authorized-2x'||rows.length!==813||rows.some((r,i)=>i>0&&r.atMs<=rows[i-1]!.atMs))throw Error('Wrong sample or clocks');
for(const task of tasks)if(!rows.some(r=>r.id===task.currentObservationId&&r.atMs===task.queryAtMs))throw Error('Question/current mismatch');
for(const row of rows)for(const view of row.views)if(sha(await readFile(view.path))!==view.sha256)throw Error('Image integrity changed');
const space=await statfs(dirname(out));if(space.bavail*space.bsize<20_000_000_000)throw Error('20GB reserve required');
if(!process.env.QWEN_API_KEY||!process.env.QWEN_BASE_URL)throw Error('Missing provider configuration');
await mkdir(out,{recursive:false});await mkdir(join(out,'questions'));
const implementationFiles=['src/assistant/causal-context-question.ts','src/assistant/three-agent-factory.ts','src/assistant/three-agent-service.ts','src/assistant/three-agent-store.ts','src/agent/spatial-json-vlm.ts','src/sim/evaluation/run-unioncity-questions90.ts'];
const implementation=Object.fromEntries(await Promise.all(implementationFiles.map(async p=>[p,sha(await readFile(p))])));
const plan={schema:'unioncity-questions90-run-v1',questionCount:90,freezeSHA256:sha(await readFile(join(freeze,'frozen.json'))),
 taskSHA256:sha(taskRaw),inputSHA256:sha(inputRaw),model:'qwen3.8-flash',thinking:false,questionPolicy:'causal-context-v1',
 inputClock:'user-authorized-2x',sourceClockPreserved:true,mode:'paused-causal-replay-independent-question-branches',realtimeTest:false,
 recentContextMs:60000,privateReferenceReadByRunner:false,referenceSelectionByScheduler:false,automaticResume:false,maxWallMinutes:60,
 budgetsUSD:{extractionSlot0:.30,extractionSlot1:.30,question:.60,mainTotal:1.20,separateGrading:.30,totalIncludingGrading:1.50},
 maxCalls:{extractorPerSlot:500,question:540},implementation,scope:'Existing fact-first producer and store with new causal question policy, direct question invocation; not Planner or interactive full-product acceptance'};
await writeFile(join(out,'plan.json'),JSON.stringify(plan,null,2),{flag:'wx'});
await writeFile(join(out,'tasks.json'),taskRaw,{flag:'wx'});
await writeFile(join(out,'input.json'),inputRaw,{flag:'wx'});
const service=await createThreeAgentService(join(out,'three-agent'),true,{extractionMax:2,batchMax:1,maxExtractionCalls:500,extractionMaxUSD:.30,questionPolicy:'causal-context-v1',questionMaxCalls:540,questionMaxUSD:.60});
const started=Date.now();let position=0,finished=0,failed=0;
const outcomes:Array<Record<string,unknown>>=[];
async function checkpoint(){
 if(Date.now()-started>3600000)throw Error('Wall-clock budget exhausted');
 try{await stat(join(out,'STOP'));throw Error('User stop file');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const free=await statfs(out);if(free.bavail*free.bsize<20_000_000_000)throw Error('20GB reserve exhausted');
}
async function ingestThrough(atMs:number){
 while(position<rows.length&&rows[position]!.atMs<=atMs){
  await checkpoint();const row=rows[position++]!;
  await service.observe({id:row.id,atMs:row.atMs,sourceAtMs:row.sourceAtMs,recordingId:'unioncity-rerender-v2-authorized-2x',frames:row.views.map(v=>v.path)});
 }
 // Paused causal mode: only already ingested frames can finish; never process a future batch.
 await service.idle();
}
try{
 service.resume();
 for(const task of tasks){
  await checkpoint();await ingestThrough(task.queryAtMs);
  const dir=join(out,'questions',task.id);await mkdir(dir,{recursive:false});
  const snapshot=service.store.snapshot(task.queryAtMs);
  await writeFile(join(dir,'producer-snapshot.json'),JSON.stringify(snapshot,null,2));
  const start=Date.now();let record:Record<string,unknown>;
  try{
   const answer=await service.questionForReplay(task.question,task.queryAtMs) as any;
   if(!answer.audit)throw Error('Causal audit missing');
   const {contextSHAInput,...audit}=answer.audit;
   record={id:task.id,question:task.question,queryAtMs:task.queryAtMs,sourceQueryAtMs:task.sourceQueryAtMs,
    status:'completed',elapsedMs:Date.now()-start,answer:{...answer,audit:{...audit,initialContextSHA256:sha(contextSHAInput)}},snapshotVersion:snapshot.version};
   finished++;
  }catch(error){failed++;record={id:task.id,question:task.question,queryAtMs:task.queryAtMs,sourceQueryAtMs:task.sourceQueryAtMs,status:'failed',elapsedMs:Date.now()-start,error:String(error)};}
  await writeFile(join(dir,'result.json'),JSON.stringify(record,null,2),{flag:'wx'});
  await appendFile(join(out,'results.jsonl'),JSON.stringify(record)+'\n');outcomes.push(record);
  await writeFile(join(out,'progress.json'),JSON.stringify({settled:outcomes.length,finished,failed,observations:position,wallElapsedMs:Date.now()-started},null,2));
  console.log(JSON.stringify({id:task.id,status:record.status,elapsedMs:record.elapsedMs,settled:outcomes.length,observations:position}));
 }
 await ingestThrough(Infinity);
 await writeFile(join(out,'efficiency-events.json'),JSON.stringify(service.store.efficiencyEvents()));
 await writeFile(join(out,'report.json'),JSON.stringify({completedScript:true,questions:outcomes.length,finished,failed,observations:position,progress:service.store.progress(),wallElapsedMs:Date.now()-started,semanticAccuracy:null,mechanismAudit:'pending separate evaluator',realtime:false},null,2),{flag:'wx'});
}catch(error){
 await writeFile(join(out,'stopped.json'),JSON.stringify({error:String(error),settled:outcomes.length,finished,failed,observations:position,wallElapsedMs:Date.now()-started},null,2),{flag:'wx'});throw error;
}finally{await service.shutdown();}
