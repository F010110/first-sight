import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {CampusSource} from '../assistant/campus-source.js';
import {SpatialCapability} from '../assistant/spatial-capability.js';
import {FileJournal} from '../assistant/journal.js';
import {AssistantRuntime} from '../assistant/runtime.js';
import {assistantCapabilities} from '../assistant/capabilities.js';
import {QwenPlanner} from '../assistant/qwen-planner.js';

if(!process.argv.includes('--confirm-paid'))throw Error('Require --confirm-paid; actual Qwen requests, original campus images only');
const root=resolve('run/campus-assistant-pilot',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(root,{recursive:true});
const source=await CampusSource.load('run/inspect-repair-full90-v1/model-replay/observations.jsonl');
const journal=new FileJournal(root),budget={maxCalls:16,maxUSD:.15};
const memory=await SpatialCapability.create(join(root,'spatial'),true,value=>journal.append('vlm-language',value),budget);
let now=Date.now();const origin=now;
const runtime=new AssistantRuntime(new QwenPlanner(join(root,'dialogue-requests'),true,fetch,5),memory,journal,assistantCapabilities(memory,true),true,()=>now);
const script=[
 {kind:'control',action:'capture.start'},
 {kind:'message',text:'接下来看到植物时提醒我一次。',capability:'auto'},
 {kind:'observe',index:0},
 {kind:'message',text:'我看不清周围，请简短描述这个输入画面。不要提供通行安全保证。',capability:'auto'},
 {kind:'message',text:'你刚才提到的环境，左右两边分别有什么？如果图像不足请说明。',capability:'auto'},
 {kind:'message',text:'帮我寻找植物，找到后先告诉我候选，不要替我确认。',capability:'auto'},
 {kind:'observe',index:1},
 {kind:'control',action:'tasks.cancel'},
 {kind:'control',action:'capture.pause'},
 {kind:'message',text:'我现在周围是什么样？',capability:'auto'}
];
const paths=['src/assistant/runtime.ts','src/assistant/spatial-capability.ts','src/assistant/capabilities.ts','src/assistant/qwen-planner.ts','src/desktop/run-campus-pilot.ts'];
const sourceHashes=Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
await writeFile(join(root,'frozen.json'),JSON.stringify({script,sourceHashes,manifestSha256:source.manifestSha256,budget,dialogueMaxCalls:5,mode:'accelerated-causal-blocking',note:'Two actual campus observations, real VLM and automatic routing; scripted text user, not real-time or complete product evaluation. No independent semantic grade.'},null,2));
console.log(root);
let failure:unknown;
try{
 for(const step of script){
  await journal.append('script-event',step);
  if(step.kind==='control')await runtime.control(step.action!);
  else if(step.kind==='message'){await runtime.submit(step.text!,step.capability!);await runtime.idle();}
  else {
   const row=await source.read(step.index!);now=origin+row.atMs-source.time(0);
   await journal.append('campus-frame',{id:row.id,atMs:now,scheduleAtMs:row.atMs,episodeNumber:row.episodeNumber,sourceAtMs:row.sourceAtMs,views:row.views.map(({bytes,...view})=>view)});
   await runtime.observe({id:row.id,atMs:now,sourceAtMs:row.sourceAtMs,recordingId:runtime.view().sessionId,frames:row.views.map(v=>v.path)},'simulator-replay');await runtime.idle();
  }
  await journal.snapshot(runtime.view());
 }
}catch(error){failure=String(error);await journal.append('external-run-failure',{error:failure});}
finally{
 await runtime.close();await journal.snapshot(runtime.view());
 const state=runtime.view();await writeFile(join(root,'report.json'),JSON.stringify({completedScript:!failure,failure,tasks:state.tasks,watches:state.watches,answerCount:state.messages.filter(m=>m.role==='assistant').length,grade:'not-independently-graded',note:'Task failures remain visible; script completion does not imply all tasks succeeded.'},null,2));
}
console.log(JSON.stringify({root,failure:failure??null,tasks:runtime.view().tasks.map(t=>({capability:t.capability,status:t.status}))}));
