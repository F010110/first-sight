import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {createThreeAgentService} from '../../assistant/three-agent-factory.js';
import {AssistantRuntime} from '../../assistant/runtime.js';
import {assistantCapabilities} from '../../assistant/capabilities.js';
import {QwenPlanner} from '../../assistant/qwen-planner.js';
import {FileJournal} from '../../assistant/journal.js';
import {streamEfficiency} from '../../assistant/stream-efficiency.js';
import {assessRealtime} from '../../assistant/realtime-acceptance.js';

const [inputArg,outArg,...flags]=process.argv.slice(2);
if(!inputArg||!outArg||!flags.includes('--confirm-paid')||flags.some(f=>!['--confirm-paid','--extraction-max=1','--extraction-max=2','--relationship-question','--observations=192','--batch-max=1','--batch-max=2','--batch-max=4','--passes=3'].includes(f))||flags.includes('--extraction-max=1')&&flags.includes('--extraction-max=2')||flags.filter(f=>f.startsWith('--batch-max=')).length>1)throw Error('Usage: run-three-agent-stream INPUT NEW-OUTPUT --confirm-paid [--extraction-max=1|2] [--batch-max=1|2|4] [--observations=192] [--passes=3] [--relationship-question]');
const extractionMax=flags.includes('--extraction-max=1')?1:2;
const batchMax=(Number(flags.find(f=>f.startsWith('--batch-max='))?.split('=')[1]??2)) as 1|2|4;
const raw=await readFile(resolve(inputArg));const data=JSON.parse(raw.toString());
if(data.schema!=='spatial-public-input-v1'||!Array.isArray(data.observations)||data.observations.length<8)throw Error('Need at least 8 observations');
const sample=data.observations.slice(0,flags.includes('--observations=192')?192:32);
const passes=flags.includes('--passes=3')?3:1;
const passDuration=sample.at(-1).atMs-sample[0].atMs+(sample[1].atMs-sample[0].atMs);
const rows=Array.from({length:passes},(_,pass)=>sample.map((r:any)=>({...r,id:pass?`pass-${pass+1}-${r.id}`:r.id,atMs:r.atMs+pass*passDuration,originalSourceAtMs:r.atMs,pass}))).flat();
if(rows.some((r:any,i:number)=>!Number.isFinite(r.atMs)||i>0&&r.atMs<=rows[i-1].atMs)||rows.at(-1).atMs-rows[0].atMs>1260000)throw Error('Invalid bounded source prefix');
for(const row of rows)for(const v of row.views)if(createHash('sha256').update(await readFile(v.path)).digest('hex')!==v.sha256)throw Error('Input image changed');
const out=resolve(outArg);await mkdir(out,{recursive:false});
const maxExtractionCalls=passes===3?320:128;
const service=await createThreeAgentService(join(out,'three-agent'),true,{extractionMax,batchMax,maxExtractionCalls});const planner=new QwenPlanner(join(out,'planner'),true,fetch,passes+1);const journal=new FileJournal(out);
const capabilities=assistantCapabilities(service,true).map(c=>['task.find','task.watch'].includes(c.id)?{...c,available:false,reason:'Not integrated'}:c);
const runtime=new AssistantRuntime({plan:(...args)=>service.scheduleInteraction(()=>planner.plan(...args))},service,journal,capabilities,true);
await writeFile(join(out,'plan.json'),JSON.stringify({schema:'three-agent-source-paced-v1',pipeline:'parallel-extraction-fact-first',extractionProtocol:batchMax===1?'source-bound-text-v1':'direct-claims-v1',dispatch:'eager-with-congestion-hold',currentMode:'on-demand',relationshipMode:'on-demand',extractionMax,totalRequestSlots:5,associationSerial:false,inputSha256:createHash('sha256').update(raw).digest('hex'),observations:rows.length,passes,sourceSpanMs:rows.at(-1).atMs-rows[0].atMs,memoryBatchMax:batchMax,memoryMaxWaitMs:batchMax===1?0:2000,sourcePaced:true,questionCount:passes+Number(flags.includes('--relationship-question')),clock:'Original relative source intervals mapped to host wall clock; repeated passes retain original per-pass intervals and provenance, not new independent footage',scope:'Bounded source-clock sample, not an accuracy benchmark; fact readiness is not relationship completion',automaticResume:false,budget:{extractorSlots:2,callsPerSlot:maxExtractionCalls,usdPerSlot:.10,reviewUSD:.10,currentUSD:.15,questionUSD:.15,plannerCalls:passes+1}},null,2));
try{
 await runtime.control('capture.start');const origin=Date.now(),schedule=[];
 for(const [i,row] of rows.entries()){
  const target=origin+row.atMs-rows[0].atMs;await sleep(Math.max(0,target-Date.now()));
  const arrived=Date.now();
   await runtime.observe({id:row.id,atMs:target,sourceAtMs:row.originalSourceAtMs,recordingId:`gmod-source-pass-${row.pass+1}`,frames:row.views.map((v:any)=>v.path)},'simulator-replay');
  schedule.push({id:row.id,sourceAtMs:row.atMs,scheduledHostMs:target,arrivalLateMs:arrived-target});
   if(i%sample.length===Math.floor(sample.length/2))await runtime.submit('请根据此前实际记录的画面，简短说明我之前经过了哪些环境；没处理完的部分请明确说明。');
 }
  await service.finishInput();await runtime.idle();
  if(flags.includes('--relationship-question')){
   const started=Date.now();const answer=await service.question('此前记录能确认我重访了同一间屋子吗？证据不足请明确说无法确认。',true);
   await writeFile(join(out,'relationship-question.json'),JSON.stringify({elapsedMs:Date.now()-started,answer,status:service.store.reviewStatus()},null,2));
  }
 const interactionJournal=(await readFile(join(out,'events.jsonl'),'utf8')).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  const metrics={...streamEfficiency(service.store.efficiencyEvents(),true,interactionJournal),captureCoverage:service.store.progress().archived/rows.length};
  await writeFile(join(out,'realtime-acceptance.json'),JSON.stringify(assessRealtime(metrics,rows.length,schedule),null,2),{flag:'wx'});
 await writeFile(join(out,'efficiency-events.json'),JSON.stringify(service.store.efficiencyEvents(),null,2));
 await writeFile(join(out,'report.json'),JSON.stringify({metrics,schedule,expectedInputObservations:rows.length,state:runtime.view(),finalBackground:service.backgroundState(),accuracy:null},null,2));
 console.log(JSON.stringify({out,metrics},null,2));
}finally{await runtime.close();}
