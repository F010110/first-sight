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
const stories=process.argv.includes('--stories'),original90=process.argv.includes('--original90'),full90=process.argv.includes('--full90')||original90;
const budget=full90?{maxCalls:1440,maxUSD:2}:{maxCalls:128,maxUSD:.25};
const journal=new FileJournal(root),agent=new QuestionAgent(memory,join(root,'question-requests'),true,fetch,budget),service=new QuestionMemoryService(memory,agent);
const runtime=new AssistantRuntime(new QwenPlanner(join(root,'dialogue-requests'),true),service,journal,assistantCapabilities(service,true),true);
const script:Array<{id?:string;tier?:string;story?:string;reset?:boolean;index:number;text:string;capability:string}>=full90?JSON.parse(await readFile('run/campus-assistant-questions90-v1/tasks.json','utf8')):[{index:3,text:'我看不清附近，请简短说说当前环境。',capability:'visual.current'},{index:7,text:'左侧有什么？如果不能确定请说明。',capability:'visual.current'},{index:15,text:'此前的记录里见到过植物吗？请查看过去原图，不用当前画面代替。',capability:'memory.query'}];
if(full90&&(script.length!==90||['current','short','long'].some(tier=>script.filter(step=>step.tier===tier).length!==30)))throw Error('Invalid 90-task tier counts');
if(original90){
 const rows=(await readFile('run/inspect-repair-full90-v1/model-replay/observations.jsonl','utf8')).trim().split('\n').map(line=>JSON.parse(line));
 const questions=JSON.parse(await readFile('run/inspect-repair-full90-v1/model-questions.json','utf8')) as Array<{id:string;question:string;currentObservationId:string;queryAtMs:number}>;
 script.splice(0,script.length,...questions.map((q,i)=>({id:q.id,text:q.question,index:rows.findIndex(row=>row.id===q.currentObservationId),tier:i<30?'current':i<60?'short':'long',capability:i<30?'visual.current':'memory.query'})).sort((a,b)=>a.index-b.index||a.id.localeCompare(b.id)));
}
if(stories){
 const rows=(await readFile('run/inspect-repair-full90-v1/model-replay/observations.jsonl','utf8')).trim().split('\n').map(line=>JSON.parse(line));
 const turns=[
  {episode:1,seconds:66,story:'landmark',text:'刚才沿着红砖墙走的那段小路之后，我又经过了什么地方？'},
  {episode:1,seconds:90,story:'landmark',text:'你说的那个地方，是在室内还是室外？'},
  {episode:1,seconds:130,story:'comparison',text:'现在这儿和刚才那个有篮球架的场地有什么明显不一样？'},
  {episode:1,seconds:150,story:'comparison',text:'所以我已经进到室内了吗？'},
  {episode:4,seconds:130,story:'route',text:'这次恢复记录以后，我都经过了哪些地方？按顺序简单说一下。'},
  {episode:4,seconds:160,story:'route',text:'别讲那么细，告诉我几个主要地方就行。'},
  {episode:4,seconds:190,story:'relative-time',text:'两分钟前我在哪儿？那附近有什么明显特征？'},
  {episode:4,seconds:226,story:'relative-time',text:'从那里到现在这里，中间还经过了什么？'},
  {episode:7,seconds:60,story:'clarification',reset:true,text:'刚才那个地方，我是什么时候经过的？'},
  {episode:7,seconds:90,story:'clarification',text:'我说的是刚开始记录时，靠着红砖墙和铁丝网的那段小路。'},
  {episode:10,seconds:20,story:'recording-gap',reset:true,text:'刚才没记录的那段时间，我经过了哪些地方？'},
  {episode:10,seconds:56,story:'recording-gap',text:'那至少说说，没记录之前和恢复之后分别是什么地方。'}
 ];
 script.splice(0,script.length,...turns.map((turn,i)=>{const index=rows.findIndex(row=>row.episodeNumber===turn.episode&&row.sourceAtMs===turn.seconds*1000);if(index<0)throw Error('Story time not in original source');return {id:`story-${i+1}`,index,text:turn.text,story:turn.story,reset:turn.reset??false,capability:'memory.query'};}));
}
const dataset=stories?'realistic-stories-v1':original90?'original90-regression':full90?'assistant-questions90-v1':'pilot3';
const before=createHash('sha256').update(await readFile(join(memoryRoot,'memory.sqlite'))).digest('hex');
const codeHashes=Object.fromEntries(await Promise.all(['src/assistant/question-agent.ts','src/assistant/prepared-memory.ts','src/desktop/run-campus-questions.ts','src/sim/evaluation/grade-campus-questions.ts'].map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile(join(root,'frozen.json'),JSON.stringify({mode:'question-only',dataset,codeHashes,memoryRoot:resolve(memoryRoot),memorySha256:before,script,spatialModelCalls:0,questionBudgetUSD:budget.maxUSD,sourceManifestSha256:source.manifestSha256},null,2));console.log(root);
let failure:unknown;
const settledTasks:Array<ReturnType<typeof runtime.view>['tasks'][number]>=[];
try{
 await runtime.control('capture.start');
  for(const step of script){
   if(step.reset)await runtime.control('conversation.reset');
  const row=await source.read(step.index),atMs=Date.now();
  await journal.append('campus-frame',{id:row.id,atMs,scheduleAtMs:row.atMs,sourceAtMs:row.sourceAtMs,episodeNumber:row.episodeNumber,views:row.views.map(({bytes,...view})=>view)});
  await runtime.observe({id:row.id,atMs,sourceAtMs:row.sourceAtMs,frames:row.views.map(v=>v.path)},'simulator-replay');await runtime.idle();
   const taskId=await runtime.submit(step.text,step.capability);await runtime.idle();await journal.snapshot(runtime.view());
   await journal.append('story-turn-finished',{story:step.story??null,stepId:step.id,taskId,state:runtime.view().tasks.find(task=>task.id===taskId),trigger:'Fixed public user script after previous turn settled; no future/private answer supplied'});
   const task=runtime.view().tasks.find(task=>task.id===taskId);if(task)settledTasks.push(task);
   await writeFile(join(root,'progress.json'),JSON.stringify({completed:settledTasks.length,total:script.length,tasks:settledTasks.map(t=>({status:t.status,capability:t.capability}))}));
 }
}catch(error){failure=String(error);await journal.append('question-run-failed',{error:failure});}
finally{
 await runtime.close();await journal.snapshot(runtime.view());
 const after=createHash('sha256').update(await readFile(join(memoryRoot,'memory.sqlite'))).digest('hex');
  await writeFile(join(root,'report.json'),JSON.stringify({completedScript:!failure,failure,mode:'question-only',dataset,spatialModelCalls:0,memoryUnchanged:before===after,memorySha256Before:before,memorySha256After:after,tasks:settledTasks,grade:'not-independently-graded'},null,2));
 if(before!==after)throw Error('Prepared memory changed during question-only run');
}
console.log(JSON.stringify({root,spatialModelCalls:0,tasks:runtime.view().tasks.map(t=>({capability:t.capability,status:t.status}))}));
