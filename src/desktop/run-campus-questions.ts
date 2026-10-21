import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {PreparedMemory} from '../assistant/prepared-memory.js';
import {QuestionAgent,QuestionMemoryService} from '../assistant/question-agent.js';
import {CampusSource} from '../assistant/campus-source.js';
import {FileJournal} from '../assistant/journal.js';
import {AssistantRuntime} from '../assistant/runtime.js';
import {assistantCapabilities} from '../assistant/capabilities.js';
import {QwenPlanner} from '../assistant/qwen-planner.js';

if(!process.argv.includes('--confirm-paid'))throw Error('Require --confirm-paid for question-only requests');
let memoryRoot=process.env.FIRST_SIGHT_PREPARED_MEMORY;
if(!memoryRoot)for(const name of (await readdir(resolve('run/campus-spatial-memory'))).sort().reverse()){
 const candidate=resolve('run/campus-spatial-memory',name);try{await readFile(join(candidate,'complete.json'));memoryRoot=candidate;break;}catch{}
}
if(!memoryRoot)throw Error('No complete spatial producer artifact; this command never builds one');
const memory=await PreparedMemory.open(resolve(memoryRoot));
const source=await CampusSource.load('run/inspect-repair-full90-v1/model-replay/observations.jsonl');
const root=resolve('run/campus-assistant-pilot',new Date().toISOString().replace(/[:.]/g,'-')+'-questions-'+randomUUID().slice(0,8));await mkdir(root,{recursive:true});
const full90=process.argv.includes('--full90');
const budget=full90?{maxCalls:720,maxUSD:2}:{maxCalls:128,maxUSD:.25};
const journal=new FileJournal(root),agent=new QuestionAgent(memory,join(root,'question-requests'),true,fetch,budget),service=new QuestionMemoryService(memory,agent);
const runtime=new AssistantRuntime(new QwenPlanner(join(root,'dialogue-requests'),true),service,journal,assistantCapabilities(service,true),true);
const script:Array<{id?:string;tier?:string;index:number;text:string;capability:string}>=full90?JSON.parse(await readFile('run/campus-assistant-questions90-v1/tasks.json','utf8')):[{index:3,text:'我看不清附近，请简短说说当前环境。',capability:'visual.current'},{index:7,text:'左侧有什么？如果不能确定请说明。',capability:'visual.current'},{index:15,text:'此前的记录里见到过植物吗？请查看过去原图，不用当前画面代替。',capability:'memory.query'}];
if(full90&&(script.length!==90||['current','short','long'].some(tier=>script.filter(step=>step.tier===tier).length!==30)))throw Error('Invalid 90-task tier counts');
const before=createHash('sha256').update(await readFile(join(memoryRoot,'memory.sqlite'))).digest('hex');
await writeFile(join(root,'frozen.json'),JSON.stringify({mode:'question-only',dataset:full90?'assistant-questions90-v1':'pilot3',memoryRoot:resolve(memoryRoot),memorySha256:before,script,spatialModelCalls:0,questionBudgetUSD:budget.maxUSD,sourceManifestSha256:source.manifestSha256},null,2));console.log(root);
let failure:unknown;
const settledTasks:Array<ReturnType<typeof runtime.view>['tasks'][number]>=[];
try{
 await runtime.control('capture.start');
 for(const step of script){
  const row=await source.read(step.index),atMs=Date.now();
  await journal.append('campus-frame',{id:row.id,atMs,scheduleAtMs:row.atMs,sourceAtMs:row.sourceAtMs,episodeNumber:row.episodeNumber,views:row.views.map(({bytes,...view})=>view)});
  await runtime.observe({id:row.id,atMs,sourceAtMs:row.sourceAtMs,frames:row.views.map(v=>v.path)},'simulator-replay');await runtime.idle();
   const taskId=await runtime.submit(step.text,step.capability);await runtime.idle();await journal.snapshot(runtime.view());
   const task=runtime.view().tasks.find(task=>task.id===taskId);if(task)settledTasks.push(task);
   await writeFile(join(root,'progress.json'),JSON.stringify({completed:settledTasks.length,total:script.length,tasks:settledTasks.map(t=>({status:t.status,capability:t.capability}))}));
 }
}catch(error){failure=String(error);await journal.append('question-run-failed',{error:failure});}
finally{
 await runtime.close();await journal.snapshot(runtime.view());
 const after=createHash('sha256').update(await readFile(join(memoryRoot,'memory.sqlite'))).digest('hex');
  await writeFile(join(root,'report.json'),JSON.stringify({completedScript:!failure,failure,mode:'question-only',dataset:full90?'assistant-questions90-v1':'pilot3',spatialModelCalls:0,memoryUnchanged:before===after,memorySha256Before:before,memorySha256After:after,tasks:settledTasks,grade:'not-independently-graded'},null,2));
 if(before!==after)throw Error('Prepared memory changed during question-only run');
}
console.log(JSON.stringify({root,spatialModelCalls:0,tasks:runtime.view().tasks.map(t=>({capability:t.capability,status:t.status}))}));
