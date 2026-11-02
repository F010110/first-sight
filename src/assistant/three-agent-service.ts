import type {SpatialObservation} from '../agent/incremental-spatial-memory.js';
import type {ObservationService,CapabilityResult} from './contracts.js';
import {ThreeAgentStore,type AgentResult,type Lane} from './three-agent-store.js';
import {AdaptiveExtractionLimit} from './adaptive-extraction.js';

type Context=ReturnType<ThreeAgentStore['snapshot']>;
export interface ThreeAgentModels{
 current(observation:SpatialObservation):Promise<AgentResult>;
 memory(observation:SpatialObservation,context:Context):Promise<AgentResult>;
 memoryWindow?(observations:SpatialObservation[],context:Context):Promise<Array<{observationId:string;result?:AgentResult;error?:string}>>;
 extractWindow?(observations:SpatialObservation[],workerSlot:number):Promise<Array<{observationId:string;result?:AgentResult;error?:string}>>;
 associateWindow?(observations:SpatialObservation[],extracted:Array<{observationId:string;result:AgentResult}>,context:Context):Promise<Array<{observationId:string;result?:AgentResult;error?:string}>>;
  question(text:string,historical:boolean,observation:SpatialObservation,context:Context):Promise<CapabilityResult>;
  afterMemoryCommit?():Promise<void>;
}
/** Shared finite request slots. Questions are preferred, background gets a turn after 3. */
export class AgentSlots{
 private active=0;private backgroundActive=0;private highStreak=0;
 private pending:Array<{role:string;run:()=>void}>=[];
 constructor(private capacity=5){if(!Number.isInteger(capacity)||capacity<1)throw Error('Invalid slots');}
 run<T>(role:string,fn:()=>Promise<T>):Promise<T>{
  return new Promise<T>((resolve,reject)=>{this.pending.push({role,run:()=>{this.active++;if(role!=='question')this.backgroundActive++;void Promise.resolve().then(fn).then(resolve,reject).finally(()=>{this.active--;if(role!=='question')this.backgroundActive--;this.pump();});}});this.pump();});
 }
 private pump(){
  while(this.active<this.capacity&&this.pending.length){
   const allowed=(p:{role:string})=>p.role==='question'||this.capacity<3||this.backgroundActive<this.capacity-1;
   let i=this.highStreak<3?this.pending.findIndex(p=>allowed(p)&&p.role==='question'):this.pending.findIndex(p=>allowed(p)&&p.role==='memory');
   if(i<0)i=this.pending.findIndex(allowed);if(i<0)break;
   const next=this.pending.splice(i,1)[0]!;this.highStreak=next.role==='question'?this.highStreak+1:0;next.run();
  }
 }
}

/** Two resident workers + on-demand questions. Archive completion never waits for a VLM. */
export class ThreeAgentService implements ObservationService{
 readonly independentObservationLane=true;
 private paused=false;private closed=false;private questionBusy=false;
 private workers=new Map<Lane,Promise<void>>();private closing:Promise<void>|null=null;
 private archiveTail:Promise<void>=Promise.resolve();
 private flushRequested=false;
  private adaptive:AdaptiveExtractionLimit;
  private nextExtractionSlot=0;
 private wakeTimer:ReturnType<typeof setInterval>;
  constructor(readonly store:ThreeAgentStore,private models:ThreeAgentModels,private slots=new AgentSlots(),private now=Date.now,private enabled=true,private prepare:(row:SpatialObservation)=>Promise<SpatialObservation>=async row=>row,private options:{continuousCurrent?:boolean;extractionMax?:1|2;relationshipMode?:'on-demand'|'per-window';eagerExtraction?:boolean}={}){
   this.adaptive=new AdaptiveExtractionLimit(options.extractionMax??2,options.eagerExtraction??false);
  if(options.continuousCurrent===false)this.store.useOnDemandCurrent();
  this.wakeTimer=setInterval(()=>this.kick(),1000);this.wakeTimer.unref();
 }
 async observe(observation:SpatialObservation){
  if(this.closed)throw Error('Service closed');
  const receivedAtMs=this.now(),started=performance.now();
  const pending=this.archiveTail.then(async()=>{this.store.archive(await this.prepare(observation),this.options.continuousCurrent!==false);this.store.metric('archive',{id:observation.id,sourceAtMs:observation.atMs,receivedAtMs,archiveMs:performance.now()-started});this.store.metric('progress',this.store.progress());this.kick();});
  this.archiveTail=pending.catch(()=>{});await pending;
 }
 resume(){if(this.closed)return;this.paused=false;this.kick();}
 requestCurrent(){if(this.paused||this.closed||!this.enabled)throw Error('Immediate inspection not authorized');const row=this.store.latest();if(!row||this.now()-row.atMs>2500)throw Error('No fresh input');this.store.requestCurrent(row.id);this.kick();}
 private kick(){
  if(this.paused||this.closed||!this.enabled)return;
  for(const lane of ['current','memory'] as Lane[])if(!this.workers.has(lane)&&(lane==='memory'&&this.models.extractWindow&&this.models.associateWindow?this.store.parallelReady(this.flushRequested):lane==='memory'&&this.models.memoryWindow?this.store.memoryBatchReady(6000,this.flushRequested):this.store.ready(lane))){
   const worker=Promise.resolve().then(()=>this.drain(lane)).finally(()=>{this.workers.delete(lane);this.kick();});
   this.workers.set(lane,worker);
  }
 }
  private async drain(lane:Lane){
  if(lane==='memory'&&this.models.extractWindow&&this.models.associateWindow)return this.drainParallelWindows();
  if(lane==='memory'&&this.models.memoryWindow)return this.drainWindows();
  while(!this.paused&&!this.closed){
   const work=this.store.claim(lane);if(!work)return;
   const heartbeat=setInterval(()=>this.store.renew(work),20000);heartbeat.unref();
   const queuedAtMs=this.now();
   try{
    const observation=this.store.observation(work.observationId);const context=this.store.snapshot(observation.atMs);
    const result=await this.slots.run(lane,()=>{
     if(this.paused||this.closed)throw Error('Cancelled before model start');
     if(lane==='current'&&(this.store.latest()?.id!==observation.id||this.now()-observation.atMs>2500)){
      this.store.supersede(work);throw Error('Immediate observation superseded before model start');
     }
     if(lane==='current')this.store.metric('current-started',{id:observation.id,sourceAtMs:observation.atMs,schedulerWaitMs:this.now()-queuedAtMs});
     return lane==='current'?this.models.current(observation):this.models.memory(observation,context);
    });
     this.store.commit(work,result,context.version);
     if(lane==='memory')await this.organizeCommitted();
    if(lane==='current')this.store.metric('current-finished',{id:observation.id,sourceAtMs:observation.atMs,ageMs:this.now()-observation.atMs,fresh:this.store.latest()?.id===observation.id&&this.now()-observation.atMs<=2500});
    else{this.store.metric('memory-committed',{id:observation.id,sourceAtMs:observation.atMs,completedAtMs:this.now()});this.store.metric('progress',this.store.progress());}
   }catch(error){this.store.fail(work,error);if(lane==='current')this.store.metric(String(error).includes('superseded before model start')?'current-skipped':'current-failed',{id:work.observationId,error:String(error)});}
   finally{clearInterval(heartbeat);}
  }
 }
 private async drainParallelWindows(){
  const active=new Map<number,Promise<void>>();let association:Promise<void>|null=null;let lastLimit=1;
  while(true){
   if(!this.paused&&!this.closed){
    if(!association){
     const next=this.store.claimAssociation();
     if(next?.work.length){
      const promise=(async()=>{
        const rows=next.work.map(w=>this.store.observation(w.observationId));
        const context:Context=this.options.relationshipMode==='on-demand'?{asOfMs:rows[0]!.atMs,version:this.store.version(),pendingMemory:0,completeness:'write-context-only',memoryLayer:'observation-facts-not-confirmed-identities',relationshipReviews:this.store.reviewStatus(),evidence:[],results:[]}:this.store.snapshot(rows[0]!.atMs);let version=context.version;
       const heartbeat=setInterval(()=>{for(const w of next.work)this.store.renew(w);},20000);heartbeat.unref();
       try{
        const output=await this.slots.run('memory',async()=>{
         if(this.paused||this.closed)throw Error('Association paused before start');
          const phase=this.options.relationshipMode==='on-demand'?'fact-finalize':'association';
          const start=performance.now();this.store.metric(phase+'-started',{windowId:next.windowId,ids:rows.map(r=>r.id),baseVersion:version});
         try{return await this.models.associateWindow!(rows,next.extracted,context);}
          finally{this.store.metric(phase==='fact-finalize'?'fact-finalize-duration':'association-inference',{windowId:next.windowId,inferenceMs:performance.now()-start});}
        });
        if(!Array.isArray(output)||new Set(output.map(r=>r.observationId)).size!==output.length||output.some(r=>!rows.some(o=>o.id===r.observationId)))throw Error('Invalid association coverage');
        for(const w of next.work){
          try{const item=output.find(r=>r.observationId===w.observationId);if(!item?.result||item.error)throw Error(item?.error??'Missing association');this.store.commit(w,item.result,version,next.evidenceUntilMs);version++;await this.organizeCommitted();this.store.metric('memory-committed',{id:w.observationId,sourceAtMs:this.store.observation(w.observationId).atMs});}
         catch(error){this.store.fail(w,error);this.store.metric('memory-failed',{id:w.observationId,error:String(error)});}
        }
       }catch(error){for(const w of next.work)this.store.fail(w,error);this.store.metric('batch-failed',{ids:rows.map(r=>r.id),error:String(error)});}
       finally{clearInterval(heartbeat);this.store.finishAssociation(next.windowId,next.work[0]!.token);this.store.metric('progress',this.store.progress());}
      })();
      association=promise;void promise.finally(()=>{association=null;});
     }
    }
    const progress=this.store.progress();const limit=this.adaptive.choose(this.store.pendingExtractionCount(),progress.oldestUnfinishedAgeMs,this.store.preparedWindows()+active.size,this.now());
    if(limit!==lastLimit){this.store.metric('extraction-limit',{limit,reason:this.options.eagerExtraction?'available-independent-capacity-with-congestion-hold':'backlog-and-cooldown'});lastLimit=limit;}
    for(let offset=0;offset<2&&active.size<limit&&this.store.preparedWindows()+active.size<3;offset++){
     const slot=(this.nextExtractionSlot+offset)%2;
     if(active.has(slot))continue;
     const next=this.store.claimExtraction(this.flushRequested);if(!next)break;
     const promise=(async()=>{
      const rows=next.work.map(w=>this.store.observation(w.observationId));const heartbeat=setInterval(()=>{for(const w of next.work)this.store.renew(w);},20000);heartbeat.unref();
      const claimedAtMs=this.now();this.store.metric('batch-claimed',{windowId:next.windowId,ids:rows.map(r=>r.id),firstSourceAtMs:rows[0]!.atMs,lastSourceAtMs:rows.at(-1)!.atMs,collectionSpanMs:next.work.at(-1)!.receivedAtMs!-next.work[0]!.receivedAtMs!,collectionAndQueueMs:claimedAtMs-next.work[0]!.receivedAtMs!});
      try{
       const output=await this.slots.run('memory-extract',async()=>{
        if(this.paused||this.closed)throw Error('Extraction paused before start');
        const start=performance.now();this.store.metric('extraction-started',{windowId:next.windowId,slot,ids:rows.map(r=>r.id),schedulerWaitMs:this.now()-claimedAtMs});
        try{return await this.models.extractWindow!(rows,slot);}
        finally{this.store.metric('extraction-inference',{windowId:next.windowId,slot,inferenceMs:performance.now()-start});}
       });
       this.store.saveExtraction(next.windowId,next.work,output);
      }catch(error){this.store.failExtraction(next.windowId,next.work,error);this.store.metric('batch-failed',{ids:rows.map(r=>r.id),error:String(error)});if(/429|503|timeout/i.test(String(error)))this.adaptive.congested(this.now());}
      finally{clearInterval(heartbeat);this.store.metric('progress',this.store.progress());}
     })();
      active.set(slot,promise);void promise.finally(()=>{active.delete(slot);});
      this.nextExtractionSlot=(slot+1)%2;
      break; // Re-enter after the asynchronous boundary; rotate ledgers fairly.
    }
   }
   if(!active.size&&!association)break;
   await Promise.race([...active.values(),...(association?[association]:[]),new Promise<void>(resolve=>setTimeout(resolve,100))]);
  }
 }
 private async drainWindows(){
  while(!this.paused&&!this.closed){
   const work=this.store.claimMemoryBatch(6000,this.flushRequested);if(!work.length)return;
   const rows=work.map(w=>this.store.observation(w.observationId));const end=rows.at(-1)!.atMs;
   const context=this.store.snapshot(rows[0]!.atMs);let version=context.version;
   const claimedAtMs=this.now();const heartbeat=setInterval(()=>{for(const w of work)this.store.renew(w);},20000);heartbeat.unref();
   this.store.metric('batch-claimed',{ids:rows.map(r=>r.id),firstSourceAtMs:rows[0]!.atMs,lastSourceAtMs:end,collectionSpanMs:work.at(-1)!.receivedAtMs!-work[0]!.receivedAtMs!,collectionAndQueueMs:claimedAtMs-work[0]!.receivedAtMs!});
   try{
    const output=await this.slots.run('memory',async()=>{
     if(this.paused||this.closed)throw Error('Cancelled before batch model start');
     const modelStartedAtMs=this.now();const start=performance.now();
     this.store.metric('batch-started',{ids:rows.map(r=>r.id),schedulerWaitMs:modelStartedAtMs-claimedAtMs,modelStartedAtMs});
     try{return await this.models.memoryWindow!(rows,context);}
     finally{this.store.metric('batch-inference',{ids:rows.map(r=>r.id),inferenceMs:performance.now()-start});}
    });
    if(!Array.isArray(output)||new Set(output.map(o=>o.observationId)).size!==output.length||output.some(o=>!rows.some(r=>r.id===o.observationId)))throw Error('Invalid batch observation coverage');
    for(const w of work){
     try{
      const item=output.find(o=>o.observationId===w.observationId);
      if(!item?.result||item.error)throw Error(item?.error??'Missing observation in batch');
       this.store.commit(w,item.result,version,end);version++;
       await this.organizeCommitted();
      this.store.metric('memory-committed',{id:w.observationId,sourceAtMs:this.store.observation(w.observationId).atMs,evidenceUntilMs:end,completedAtMs:this.now()});
     }catch(error){this.store.fail(w,error);this.store.metric('memory-failed',{id:w.observationId,error:String(error)});}
    }
   }catch(error){for(const w of work)this.store.fail(w,error);this.store.metric('batch-failed',{ids:rows.map(r=>r.id),error:String(error)});}
   finally{clearInterval(heartbeat);this.store.metric('progress',this.store.progress());}
  }
 }
  private async organizeCommitted(){
   try{await this.models.afterMemoryCommit?.();}
   catch(error){this.store.metric('organization-sync-failed',{error:String(error),memoryVersion:this.store.version()});}
  }
   async question(text:string,historical:boolean){
  if(this.closed||!this.enabled)throw Error('Models disabled or service closed');
  if(this.questionBusy)throw Error('Question already running');
  const observation=this.store.latest(this.now());if(!observation)throw Error('No visual evidence');
  if(!historical&&(this.paused||this.now()-observation.atMs>2500))throw Error('No fresh current evidence');
  const context=this.store.snapshot(this.now());this.questionBusy=true;const askedAtMs=this.now();
  try{
    const result=await this.slots.run('question',()=>{this.store.metric('question-started',{askedAtMs,sourceAtMs:observation.atMs});return this.models.question(text,historical,observation,context);});
   if(!result||typeof result.text!=='string'||!result.text.trim()||!Array.isArray(result.sourceIds)||result.sourceIds.some(id=>this.store.observation(id).atMs>context.asOfMs))throw Error('Invalid question evidence');
   if(!result.abstained&&!result.sourceIds.length)throw Error('Uncited answer');
    if(!historical&&(this.paused||this.store.latest()?.id!==observation.id||this.now()-observation.atMs>2500))return {...result,source:'historical' as const,text:'以下仅描述提问时的画面，不能代表现在：'+result.text};
   return result;
  }finally{this.store.metric('question-finished',{askedAtMs,elapsedMs:this.now()-askedAtMs});this.questionBusy=false;}
  }
  /** Explicit paused-replay entry: source time is not host freshness. No future ingestion permitted. */
  async questionForReplay(text:string,atMs:number){
   if(this.closed||!this.enabled||this.questionBusy)throw Error('Replay question unavailable');
   if(this.store.latest()?.atMs!==atMs)throw Error('Replay question must precede future ingestion');
   const observation=this.store.observation(this.store.latest()!.id),context=this.store.snapshot(atMs);
   this.questionBusy=true;const started=Date.now();
   try{
    const answer=await this.slots.run('question',()=>this.models.question(text,false,observation,context));
    if(!answer||typeof answer.text!=='string'||!answer.text.trim()||!Array.isArray(answer.sourceIds)||answer.sourceIds.some(id=>this.store.observation(id).atMs>atMs))throw Error('Invalid replay evidence');
    return answer;
   }finally{this.store.metric('replay-question-finished',{atMs,wallElapsedMs:Date.now()-started});this.questionBusy=false;}
  }
 discardPending(){this.paused=true;}
 async idle(){
  this.flushRequested=true;this.kick();
  try{while(this.workers.size)await Promise.all([...this.workers.values()]);}
  finally{this.flushRequested=false;}
 }
 async finishInput(){this.store.metric('source-ended',this.store.progress());await this.idle();this.store.metric('drain-finished',this.store.progress());}
 scheduleInteraction<T>(fn:()=>Promise<T>){if(this.closed||!this.enabled)return Promise.reject<T>(Error('Models disabled or service closed'));return this.slots.run('question',fn);}
   backgroundState(){return this.closed?{closed:true}:{architecture:'three-agent-v1',currentMode:this.options.continuousCurrent===false?'on-demand':'continuous',relationshipMode:this.options.relationshipMode??'per-window',parallelExtraction:!!this.models.extractWindow,extractionMax:this.options.extractionMax??2,paused:this.paused,enabled:this.enabled,memoryBatchMax:this.models.extractWindow?this.store.extractionPolicy().batchMax:this.models.memoryWindow?4:1,memoryMaxWaitMs:this.models.extractWindow?this.store.extractionPolicy().maxWaitMs:null,workers:[...this.workers.keys()],questionBusy:this.questionBusy,tasks:this.store.status(),memoryLayer:'observation-facts-not-confirmed-identities',relationshipReviews:this.store.reviewStatus(),memoryVersion:this.store.version(),progress:this.store.progress()};}
 close(){void this.shutdown();}
 shutdown(){
  if(this.closing)return this.closing;
  this.closed=true;this.paused=true;clearInterval(this.wakeTimer);
  this.closing=(async()=>{await this.archiveTail;await this.idle();while(this.questionBusy)await new Promise(r=>setTimeout(r,10));this.store.close();})();
  return this.closing;
 }
}
