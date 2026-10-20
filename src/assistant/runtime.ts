import {randomUUID} from 'node:crypto';
import type {SpatialObservation} from '../agent/incremental-spatial-memory.js';
import type {AssistantView,Capability,Journal,Message,Mode,ObservationService,OutputCandidate,Planner,Task} from './contracts.js';
import {OutputPolicy} from './output-policy.js';

/** Product orchestration. Knows ports, not SQLite, camera drivers, browser or model provider. */
export class AssistantRuntime {
 private readonly registry=new Map<string,Capability>();
 private readonly policy=new OutputPolicy();
 private tail:Promise<void>=Promise.resolve();
 private idleTasks=0;
 private epoch=0;
 private captureEpoch=0;
 private closed=false;
 private state:AssistantView;
 constructor(private readonly planner:Planner,private readonly observations:ObservationService,private readonly journal:Journal,capabilities:Capability[],modelEnabled:boolean,private readonly now=Date.now){
  for(const capability of capabilities){if(this.registry.has(capability.id))throw Error('Duplicate capability');this.registry.set(capability.id,capability);}
  this.state={sessionId:randomUUID(),capture:'stopped',mode:'daily',outputPaused:false,modelEnabled,messages:[],tasks:[],watches:[],capabilities:capabilities.map(({id,title,available,reason})=>({id,title,available,...reason?{reason}:{}})),latestObservation:null,processing:0,lastError:null};
 }
 view(){return structuredClone(this.state);}
 private async emit(candidate:OutputCandidate,cancelled=false){
  const decision=this.policy.decide(candidate,{mode:this.state.mode,outputPaused:this.state.outputPaused,cancelled},this.now());
  await this.journal.append('output-decision',{candidate,decision});
  const invalidated=this.closed||this.state.outputPaused||candidate.expiresAtMs!==undefined&&candidate.expiresAtMs<this.now()||this.state.tasks.some(t=>t.id===candidate.taskId&&t.status==='cancelled')||this.state.watches.some(w=>w.id===candidate.taskId&&w.status==='cancelled');
  if(decision.deliver&&!invalidated){this.state.messages.push({id:randomUUID(),role:'assistant',atMs:this.now(),text:candidate.text,source:candidate.source,sourceIds:candidate.sourceIds,action:candidate.action,...candidate.taskId?{taskId:candidate.taskId}:{}});this.state.messages=this.state.messages.slice(-100);}
  if(decision.deliver&&!invalidated)await this.journal.append('message-delivered',this.state.messages.at(-1));
  if(decision.deliver&&invalidated)await this.journal.append('output-invalidated-before-delivery',{taskId:candidate.taskId});
  return decision.deliver&&!invalidated;
 }
 private queue(work:()=>Promise<void>){
  if(this.closed)throw Error('Session closed');
  this.idleTasks++;this.state.processing=this.idleTasks;
  const result=this.tail.then(work);
  this.tail=result.catch(async error=>{this.state.lastError=String(error);await this.journal.append('background-error',{error:String(error)});}).finally(()=>{this.idleTasks--;this.state.processing=this.idleTasks;});
  return result;
 }
 async idle(){await this.tail;}
 async control(action:string,value?:string){
  if(this.closed)throw Error('Session closed');
  // These effects happen BEFORE any await: long inference cannot block control.
  if(action==='capture.start')this.state.capture='recording';
  else if(action==='capture.pause'||action==='capture.stop'){
   this.state.capture=action==='capture.pause'?'paused':'stopped';this.captureEpoch++;
   this.observations.discardPending();
   for(const task of this.state.tasks)if(['queued','running'].includes(task.status)&&this.registry.get(task.capability)?.requiresFreshObservation)task.status='cancelled';
   }else if(action==='tasks.cancel'||action==='output.interrupt'||action==='conversation.reset'){
   this.epoch++;for(const task of this.state.tasks)if(['queued','running'].includes(task.status))task.status='cancelled';
   if(action==='tasks.cancel'||action==='conversation.reset')for(const watch of this.state.watches)if(['active','candidate'].includes(watch.status))watch.status='cancelled';
   if(action==='conversation.reset')this.state.messages=[];
   if(action==='output.interrupt')this.state.outputPaused=true;
  }else if(action==='watch.cancel'||action==='watch.confirm'){
   const watch=this.state.watches.find(w=>w.id===value);if(!watch)throw Error('Unknown watch');
   if(action==='watch.confirm'){
    if(watch.kind!=='find'||watch.status!=='candidate'||watch.expiresAtMs<=this.now())throw Error('No valid finding candidate to confirm');
    watch.status='completed';
   }else if(['active','candidate'].includes(watch.status))watch.status='cancelled';
  }else if(action==='output.resume')this.state.outputPaused=false;
  else if(action==='mode.set'){
   if(!['daily','explore','focus','quiet'].includes(value??''))throw Error('Invalid mode');this.state.mode=value as Mode;
  }else if(action==='output.repeat'){
   const last=[...this.state.messages].reverse().find(m=>m.role==='assistant'&&m.source!=='system');
   this.state.outputPaused=false;
   await this.emit({action:'ANSWER',text:last?`重复上一条（非新的观察）：${last.text}`:'暂无可重复的回答。',source:'system',sourceIds:last?.sourceIds??[],userInitiated:true});
  }else throw Error('Unsupported control');
  await this.journal.append('control',{action,value,state:this.view()});
 }
 async submit(text:string,requested='auto'){
  text=text.trim();if(!text||text.length>2000)throw Error('Message must contain 1..2000 characters');
  const direct:Record<string,string>={'停止记录':'capture.stop','暂停记录':'capture.pause','开始记录':'capture.start','停止输出':'output.interrupt','取消任务':'tasks.cancel','重复上一句':'output.repeat'};
  const control=direct[text];if(control){await this.control(control);return null;}
  if(this.idleTasks>=120)throw Error('Assistant backlog full');
  if(requested!=='auto'&&!this.registry.has(requested))throw Error('Unknown capability');
  this.epoch++;for(const task of this.state.tasks)if(['queued','running'].includes(task.status))task.status='cancelled';
  const task:Task={id:randomUUID(),text,capability:requested,status:'queued',createdAtMs:this.now()};
  this.state.tasks.push(task);this.state.tasks=this.state.tasks.slice(-50);
  this.state.messages.push({id:randomUUID(),role:'user',text,atMs:this.now(),source:'user',sourceIds:[],taskId:task.id});
  this.state.messages=this.state.messages.slice(-100);this.state.outputPaused=false;
  await this.journal.append('task-created',task);
  const epoch=this.epoch;
  void this.queue(async()=>{
   const cancelled=()=>task.status==='cancelled'||epoch!==this.epoch||this.closed;
   if(cancelled())return;
   task.status='running';await this.journal.append('task-running',{taskId:task.id});
   try{
    const history=this.state.messages.filter(m=>m.taskId!==task.id).slice(-12);
    const plan=requested!=='auto'&&requested!=='conversation'?{capability:requested}:await this.planner.plan(text,history,requested==='auto'?this.state.capabilities:this.state.capabilities.filter(c=>c.id===requested));
    await this.journal.append('plan-candidate',{taskId:task.id,plan});
    if(cancelled())return;
    if(requested!=='auto'&&plan.capability!==requested)throw Error('Planner attempted to override explicitly selected capability');
    const capability=this.registry.get(plan.capability);
    if(!capability)throw Error('Model selected an unregistered capability');
    task.capability=capability.id;
    if(!capability.available)throw Error(capability.reason??'Capability unavailable');
    if(capability.requiresFreshObservation&&(this.state.capture!=='recording'||!this.state.latestObservation||this.now()-this.state.latestObservation.atMs>30000))throw Error('没有新鲜且获准观察的图像。请开始观察并导入图片；旧记录不能当作现在。');
    const observationAt=this.state.latestObservation?.atMs;
    const captureEpoch=this.captureEpoch;
    const result=await capability.execute(text,{taskId:task.id,isCancelled:cancelled,history,...plan.reply?{draft:plan.reply}:{}});
    if(!result.text)throw Error('Capability returned no answer');
    await this.journal.append('capability-result',{taskId:task.id,result,status:'unverified-assistant-statement'});
    if(cancelled()){await this.emit({action:'ANSWER',text:result.text,source:result.source,sourceIds:result.sourceIds,userInitiated:true,taskId:task.id},true);return;}
    if(capability.requiresFreshObservation&&(captureEpoch!==this.captureEpoch||observationAt===undefined||this.now()-observationAt>30000))throw Error('回答返回时观察已停止或图像已过期；结果保留在审计中，不作为当前事实交付。');
    if(capability.id==='task.watch'||capability.id==='task.find'){
     if(!this.observations.checkTarget)throw Error('Target inspection service unavailable');
     if(this.state.watches.filter(w=>['active','candidate'].includes(w.status)).length>=3)throw Error('最多同时关注三个目标，请先取消旧目标。');
     if(this.now()>=task.createdAtMs+120000)throw Error('目标请求处理太久，已超过默认有效期，请重新发起。');
     const watch={id:task.id,condition:text,kind:capability.id==='task.find'?'find' as const:'watch' as const,status:'active' as const,createdAtMs:task.createdAtMs,expiresAtMs:task.createdAtMs+120000,sourceIds:[],notificationCount:0};
     this.state.watches.push(watch);this.state.watches=this.state.watches.slice(-50);await this.journal.append('watch-created',watch);
    }
    await this.emit({action:'ANSWER',text:result.text,source:result.source,sourceIds:result.sourceIds,userInitiated:true,taskId:task.id});
    if(!cancelled())task.status='completed';
   }catch(error){
    if(cancelled()){await this.journal.append('cancelled-task-failure',{taskId:task.id,error:String(error)});return;}
    task.status='failed';task.error=String(error);this.state.lastError=String(error);
    await this.emit({action:'FAIL_NOTICE',text:`未完成：${String(error).replace(/^Error: /,'')}`,source:'system',sourceIds:[],userInitiated:true,taskId:task.id});
   }finally{await this.journal.append('task-settled',task);}
  }).catch(()=>{});
  return task.id;
 }
 async observe(observation:SpatialObservation,source:'manual-import'|'simulator-replay'='manual-import'){
  if(this.state.capture!=='recording')throw Error('Observation is not authorized: start capture first');
  if(this.idleTasks>=120)throw Error('Observation backlog full');
  if(this.state.latestObservation&&observation.atMs<=this.state.latestObservation.atMs)throw Error('Observation time must increase');
  this.state.latestObservation={id:observation.id,atMs:observation.atMs,views:observation.frames.length,source,captureTimeKnown:false};
  const epoch=this.captureEpoch;
  await this.journal.append('observation-received',{observation,source,captureTimeKnown:false});
  void this.queue(async()=>{
   if(epoch!==this.captureEpoch||this.state.capture!=='recording'){await this.journal.append('observation-inference-skipped',{id:observation.id,reason:'capture-permission-changed'});return;}
    try{await this.observations.observe(observation);await this.journal.append('observation-processed',{id:observation.id});await this.checkWatches(observation,epoch);}
   catch(error){this.state.lastError=String(error);await this.journal.append('observation-failed',{id:observation.id,error:String(error)});}
  }).catch(()=>{});
 }
 async expireWatches(){
  for(const watch of this.state.watches)if(['active','candidate'].includes(watch.status)&&this.now()>=watch.expiresAtMs){watch.status='expired';await this.journal.append('watch-expired',watch);}
 }
 private async checkWatches(observation:SpatialObservation,captureEpoch:number){
  for(const watch of this.state.watches){
   if(!['active','candidate'].includes(watch.status))continue;
   if(this.now()>=watch.expiresAtMs){watch.status='expired';await this.journal.append('watch-expired',watch);continue;}
   if(watch.status==='candidate'&&watch.notificationCount)continue;
   if(observation.atMs<watch.createdAtMs||watch.lastObservationId===observation.id||captureEpoch!==this.captureEpoch||this.state.capture!=='recording'||this.now()-observation.atMs>30000)continue;
   watch.lastObservationId=observation.id;
   try{
    const result=await this.observations.checkTarget!(observation.id,watch.condition);
    await this.journal.append('watch-check',{id:watch.id,observationId:observation.id,result});
    if(String(watch.status)==='cancelled'||captureEpoch!==this.captureEpoch||this.closed)continue;
    if(this.now()>=watch.expiresAtMs){watch.status='expired';continue;}
    if(result.status!=='observed')continue;
    if(!result.sourceIds.includes(observation.id))throw Error('Target check must cite the current observation');
    const delivered=await this.emit({action:'SHORT',text:`${watch.kind==='find'?'发现目标候选，尚需你确认':'关注目标出现'}（依据输入画面，并非真实现场）：${result.description}`,source:'visual',sourceIds:result.sourceIds,userInitiated:true,taskId:watch.id,expiresAtMs:Math.min(watch.expiresAtMs,observation.atMs+30000)},String(watch.status)==='cancelled');
    if(delivered){watch.notificationCount++;watch.sourceIds=result.sourceIds;watch.status=watch.kind==='find'?'candidate':'completed';await this.journal.append('watch-notified',watch);}
   }catch(error){
    if(String(watch.status)==='cancelled')continue;
    watch.status='failed';watch.error=String(error);await this.journal.append('watch-failed',watch);
    await this.emit({action:'FAIL_NOTICE',text:'目标检查失败，关注已停止；请重新发起。',source:'system',sourceIds:[],userInitiated:true,taskId:watch.id});
   }
  }
 }
 async close(){this.closed=true;this.epoch++;this.captureEpoch++;await this.idle();this.observations.close();}
}
