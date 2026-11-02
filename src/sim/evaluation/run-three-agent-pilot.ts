import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createThreeAgentService} from '../../assistant/three-agent-factory.js';
import {AssistantRuntime} from '../../assistant/runtime.js';
import {assistantCapabilities} from '../../assistant/capabilities.js';
import {QwenPlanner} from '../../assistant/qwen-planner.js';
import {FileJournal} from '../../assistant/journal.js';

const [inputArg,outArg,...flags]=process.argv.slice(2);
if(!inputArg||!outArg||flags.length!==1||flags[0]!=='--confirm-paid')throw Error('Usage: run-three-agent-pilot INPUT NEW-OUTPUT --confirm-paid');
const raw=await readFile(resolve(inputArg));const data=JSON.parse(raw.toString());
if(data.schema!=='spatial-public-input-v1'||!data.observations.length||data.observations.length>4)throw Error('Pilot requires 1..4 observations');
for(const row of data.observations)for(const v of row.views)if(createHash('sha256').update(await readFile(v.path)).digest('hex')!==v.sha256)throw Error('Input changed');
const out=resolve(outArg);await mkdir(out,{recursive:false});
const service=await createThreeAgentService(join(out,'three-agent'),true);const planner=new QwenPlanner(join(out,'planner'),true,fetch,2);const journal=new FileJournal(out);
const capabilities=assistantCapabilities(service,true).map(c=>['task.find','task.watch'].includes(c.id)?{...c,available:false,reason:'Not integrated in pilot'}:c);
const runtime=new AssistantRuntime({plan:(...args)=>service.scheduleInteraction(()=>planner.plan(...args))},service,journal,capabilities,true);
await writeFile(join(out,'plan.json'),JSON.stringify({architecture:'three-agent-v1',inputSha256:createHash('sha256').update(raw).digest('hex'),maxObservations:4,scope:'Real AssistantRuntime + QwenPlanner; burst ingestion and one historical question, not source-clock throughput or accuracy benchmark',noPoseInput:true,automaticResume:false},null,2));
try{
 await runtime.control('capture.start');const ingestion=[];const origin=Date.now();
 for(const [i,row] of data.observations.entries()){
  const start=performance.now();
  await runtime.observe({id:row.id,atMs:origin+i,sourceAtMs:row.atMs,frames:row.views.map((v:any)=>v.path)},'simulator-replay');
  ingestion.push({id:row.id,archiveMs:performance.now()-start});
 }
 const beforeQuestion=service.backgroundState();
 await runtime.submit('请根据本会话此前实际记录的画面，说明我之前经过哪些环境；记忆尚未处理的部分请明确说明，不要猜测房间重访。');
 await runtime.idle();const afterQuestion=runtime.view();await service.idle();
 const snapshot=service.store.snapshot(Date.now());
 await writeFile(join(out,'result.json'),JSON.stringify({ingestion,beforeQuestion,state:afterQuestion,finalBackground:service.backgroundState(),memory:snapshot,accuracy:null},null,2));
 console.log(JSON.stringify({out,archived:ingestion.length,taskStatus:afterQuestion.tasks.at(-1)?.status,memoryVersion:snapshot.version,pendingMemory:snapshot.pendingMemory}));
}finally{await runtime.close();}
