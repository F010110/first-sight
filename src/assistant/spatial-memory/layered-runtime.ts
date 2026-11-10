import {validateFacts,type Observation,type SpatialModels} from './contracts.js';
import {ObservationArchive,type ArchivedEvidence} from './observation-archive.js';
import type {LaneBudget} from './serial-lane.js';
import {statSync} from 'node:fs';
import {validateBatchCoverage,type SpatialEvidenceBatch,type SpatialBatchSegment} from './spatial-batch.js';

export type SpatialBatchProcessor={
 judge(batch:SpatialEvidenceBatch,signal?:AbortSignal):Promise<SpatialBatchSegment[]>;
 /** Must atomically commit every segment and bind the real durable Session tip. */
 commit(batch:SpatialEvidenceBatch,segments:SpatialBatchSegment[]):Promise<void>;
 committed?(id:string):boolean;
 pending?():string[];
 skipGaps?(ids:string[]):void;
 lateRepairs?():Array<{batchId:string;sequences:number[];versions:number[];missing:string[]}>;
 repairVersions?(jobId:string):number[]|undefined;
};
export type LayeredRuntimeOptions={perceptionMs:number;spatialMs:number;maxBufferedObservations:number;perceptionBudget:LaneBudget;spatialBudget:LaneBudget;requestTimeoutMs?:number;spatialTaskTimeoutMs?:number;coalesce?:boolean};

/** Durable, independently scheduled lanes. Only one spatial pump may be alive,
 * including all tool continuations, transaction finalization and recovery. */
export class LayeredMemoryRuntime{
 private perceptionTask:Promise<void>|null=null;
 private spatialTask:Promise<void>|null=null;
 private stopped:string|null=null;
 private fatal:string|null=null;
 private lastObserved=0;
 private closed=false;
 private consecutiveJudgmentFailures=0;
 private judgmentFailureSkips=0;
 constructor(private archive:ObservationArchive,private models:Pick<SpatialModels,'perceiveWindow'>,private processor:SpatialBatchProcessor,private options:LayeredRuntimeOptions,recovery:{retryFailures?:boolean}={}){
  if(!models.perceiveWindow||!Number.isFinite(options.perceptionMs)||options.perceptionMs<4000||options.perceptionMs>8000||!Number.isFinite(options.spatialMs)||options.spatialMs<options.perceptionMs||!Number.isInteger(options.maxBufferedObservations)||options.maxBufferedObservations<1||!Number.isFinite(options.requestTimeoutMs??120000)||(options.requestTimeoutMs??120000)<1)throw Error('Invalid layered schedule');
  if(!Number.isFinite(options.spatialTaskTimeoutMs??1)||(options.spatialTaskTimeoutMs??1)<1)throw Error('Invalid spatial task deadline');
  for(const b of [options.perceptionBudget,options.spatialBudget])if(!Number.isInteger(b.maxTasks)||b.maxTasks<1||!Number.isFinite(b.maxSpanMs)||b.maxSpanMs<=0||!Number.isSafeInteger(b.maxBytes)||b.maxBytes<1)throw Error('Invalid finite lane budget');
  archive.configure(options);
  this.lastObserved=archive.latest()?.sequence??0;
  archive.recoverJobs();
  for(const lane of ['perception','spatial'] as const)archive.validateRecoveryBudget(lane,{...this.budget(lane),maxTasks:(lane==='perception'?options.perceptionBudget:options.spatialBudget).maxTasks});
  // A crash after atomic spatial commit but before queue acknowledgement never reruns inference.
  for(const job of [...archive.jobs('spatial'),...archive.jobs('spatial','failed')])if(processor.committed?.(job.id))archive.jobStatus(job.id,'done');
  if(archive.jobs('spatial','failed').length)this.stopped='Failed spatial prefix requires explicit bounded retry';
  // Capture may crash after archive append but before admission. Recover these rows
  // through exactly the same bounded admission, never silently drop or enqueue all.
  for(let cursor=0;;){const rows=archive.read(cursor,256);if(!rows.length)break;for(const row of rows){this.admit(row);cursor=row.sequence;}}
  if(recovery.retryFailures)this.retryFailures();else this.kick();
 }
 private budget(lane:'perception'|'spatial'){const b=lane==='perception'?this.options.perceptionBudget:this.options.spatialBudget;return {maxObservations:b.maxTasks*(lane==='perception'?Math.min(8,this.options.maxBufferedObservations):this.options.maxBufferedObservations),maxBytes:b.maxBytes,maxSpanMs:b.maxSpanMs};}
 private admit(row:ArchivedEvidence){
  for(const lane of ['perception','spatial'] as const){
   if(this.archive.workStatus(row.sequence,lane)!==null)continue;
   if(this.fatal)this.archive.reject(row.sequence,lane,'runtime-infrastructure-failure: '+this.fatal);
   else if(this.stopped&&lane==='spatial')this.archive.reject(row.sequence,lane,'spatial-stopped: '+this.stopped);
   else this.archive.admit(row.sequence,lane,this.budget(lane));
  }
 }
 observe(input:Observation){
  if(this.closed)throw Error('Runtime closed');
  const row=this.archive.append(input);if(row.sequence<=this.lastObserved)return row.sequence;
  this.lastObserved=row.sequence;this.admit(row);
  this.seal('perception',input.atMs);this.seal('spatial',input.atMs);this.kick();return row.sequence;
 }
 tick(sourceAtMs:number,force=false){
  if(!Number.isFinite(sourceAtMs))throw Error('Invalid source clock');
  this.seal('perception',sourceAtMs,force);this.seal('spatial',sourceAtMs,force);this.kick();
 }
 private seal(lane:'perception'|'spatial',sourceAtMs:number,force=false){
  const rows=this.archive.buffered(lane),ms=lane==='perception'?this.options.perceptionMs:this.options.spatialMs,cap=lane==='perception'?Math.min(8,this.options.maxBufferedObservations):this.options.maxBufferedObservations;
  let group:ArchivedEvidence[]=[];
  const flush=()=>{if(group.length){const budget=lane==='perception'?this.options.perceptionBudget:this.options.spatialBudget;
   const merged=lane==='spatial'&&this.options.coalesce!==false&&!!this.spatialTask&&this.archive.coalesceSpatial(group,cap,budget.maxSpanMs);
   if(!merged){if(this.archive.jobs(lane).length+this.archive.jobs(lane,'running').length>=budget.maxTasks)for(const row of group)this.archive.reject(row.sequence,lane,lane+'-task-overload');else this.archive.makeJob(lane,group);}group=[];}};
  for(const row of rows){
   if(group.length&&(Math.floor(group[0]!.observation.atMs/ms)!==Math.floor(row.observation.atMs/ms)||group[0]!.observation.recordingId!==row.observation.recordingId||row.sequence!==group.at(-1)!.sequence+1||group.length>=cap))flush();
   group.push(row);
  }
  if(group.length&&(force||sourceAtMs>=(Math.floor(group[0]!.observation.atMs/ms)+1)*ms||group.length>=cap))flush();
 }
 private kick(){
  if(this.closed||this.fatal)return;
  this.scheduleLateRepairs();
  if(!this.perceptionTask&&this.archive.jobs('perception').length){
   this.perceptionTask=Promise.resolve().then(()=>this.pumpPerception()).catch(error=>{this.fatal=String(error);}).finally(()=>{this.perceptionTask=null;this.kick();});
  }
  if(!this.spatialTask&&!this.stopped&&this.spatialReady()){
   this.spatialTask=Promise.resolve().then(()=>this.pumpSpatial()).catch(error=>{this.fatal=String(error);}).finally(()=>{this.spatialTask=null;this.kick();});
  }
 }
 private spatialReady(){
  const job=this.archive.jobs('spatial')[0];
  return !!job&&job.sequences.every(seq=>{const row=this.archive.bySequence(seq),status=this.archive.workStatus(seq,'perception');return !!row.facts||status==='failed'||status==='gap';});
 }
 private async pumpPerception(){
  for(const job of this.archive.jobs('perception')){
   this.archive.jobStatus(job.id,'running');const rows=job.sequences.map(s=>this.archive.bySequence(s));
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('Fast perception request deadline exceeded')),this.options.requestTimeoutMs??120000);
   try{
    await this.extractFacts(rows,controller.signal);
    this.archive.jobStatus(job.id,'done');
   }catch(error){this.archive.jobStatus(job.id,'failed',String(error));}
   finally{clearTimeout(timer);}
   this.kick();
  }
 }
 private async extractFacts(rows:ArchivedEvidence[],signal:AbortSignal){
  let missing=rows.filter(r=>!this.archive.bySequence(r.sequence).facts),feedback:string|undefined;
  const call=async(group:ArchivedEvidence[],feedback?:string)=>{
   signal.throwIfAborted();
   const result=await this.models.perceiveWindow!(group.map(r=>r.observation),feedback,signal);signal.throwIfAborted();
   if(!Array.isArray(result)||new Set(result.map(r=>r.id)).size!==result.length||result.some(r=>!group.some(o=>o.observation.id===r.id)))throw Error('Perception protocol: duplicate or foreign source');
   const validated=result.map(row=>({id:row.id,facts:validateFacts(row.facts)}));
   for(const row of validated)this.archive.saveFacts(row.id,row.facts);
   this.kick(); // An earlier spatial bucket need not wait for a later omitted fact.
  };
  // Keep valid neighbors, ask only for omitted sources. Provider failures are not
  // disguised as protocol failures or silently retried with a different prompt.
  for(let attempt=0;missing.length&&attempt<3;attempt++){
   const before=missing.length;
   try{await call(missing,feedback);}catch(error){
    if(signal.aborted||!/Perception protocol|Invalid independent facts/.test(String(error)))throw error;
    feedback=String(error);if(attempt===2)break;continue;
   }
   missing=missing.filter(r=>!this.archive.bySequence(r.sequence).facts);
   if(missing.length>=before)break;
   feedback='Return every remaining supplied source exactly once: '+JSON.stringify(missing.map(r=>r.observation.id));
  }
  // Same no-history semantics, at most two single-source calls per remaining
  // observation. A real task deadline bounds the whole batch, not just each call.
  for(const row of missing){
   for(let attempt=0;attempt<2&&!this.archive.bySequence(row.sequence).facts;attempt++){
    try{await call([row],feedback);}catch(error){if(signal.aborted||!/Perception protocol|Invalid independent facts/.test(String(error)))throw error;feedback=String(error);}
   }
  }
  if(rows.some(r=>!this.archive.bySequence(r.sequence).facts))throw Error('Independent facts unavailable after bounded single-source fallback');
 }
 private async pumpSpatial(){
  await this.releaseOrderedGaps();
  while(this.spatialReady()&&!this.stopped){
   const job=this.archive.jobs('spatial')[0]!;this.archive.jobStatus(job.id,'running');
   // Do not turn a per-request timeout into an accidental 120s limit on the
   // entire 24-turn agent. The outer ceiling covers all bounded HTTP retries.
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('Spatial batch deadline exceeded')),this.options.spatialTaskTimeoutMs??(this.options.requestTimeoutMs??120000)*24*3);
   try{
    const rows=job.sequences.map(s=>this.archive.bySequence(s));
    const first=rows[0]!.sequence;
    const missingFactIds=rows.filter(r=>!r.facts).map(r=>r.observation.id);
    const skippedBefore=this.archive.skippedFactsBefore(first).map(r=>({id:r.observation.id,atMs:r.observation.atMs,facts:r.facts}));
    const batch:SpatialEvidenceBatch={id:job.id,observations:rows.map(r=>({id:r.observation.id,atMs:r.observation.atMs,facts:r.facts})),...skippedBefore.length?{skippedBefore}:{},coverage:{firstSequence:first,lastSequence:rows.at(-1)!.sequence,gapBefore:first>1&&this.archive.workStatus(first-1,'spatial')!=='done'},...missingFactIds.length?{missingFactIds}:{},...(this.processor.repairVersions?.(job.id)??null)?{revisionOfVersions:this.processor.repairVersions!(job.id)!}:{}};
    const segments=validateBatchCoverage(batch,await this.processor.judge(batch,controller.signal));controller.signal.throwIfAborted();
    await this.processor.commit(batch,segments);this.archive.jobStatus(job.id,'done');
    this.consecutiveJudgmentFailures=0;
    await this.releaseOrderedGaps();this.scheduleLateRepairs();
   }catch(error){
    // Old bounded failure policy: a single failed judgment is skipped as an
    // explicit gap so later evidence can proceed; five consecutive failures
    // still stop the run instead of silently skipping everything.
    if(this.consecutiveJudgmentFailures<5&&this.processor.skipGaps){
     this.consecutiveJudgmentFailures++;this.judgmentFailureSkips++;
     try{const ids=job.sequences.map(s=>this.archive.bySequence(s).observation.id);this.processor.skipGaps(ids);this.archive.markJobSkipped(job.id,String(error));if(this.consecutiveJudgmentFailures>=5)this.stopped='Five consecutive spatial judgment failures';}
     catch{this.archive.jobStatus(job.id,'failed',String(error));this.stopped=String(error);}
    }else{this.archive.jobStatus(job.id,'failed',String(error));this.stopped=String(error);}
   }finally{clearTimeout(timer);}
  }
 }
 /** A gap may only be skipped when it is the complete pending prefix. Gaps that
  * occurred while the writer was busy wait for earlier commits, then become
  * durable skipped sources and cannot block newer spatial commits forever. */
 private async releaseOrderedGaps(){
  if(!this.processor.pending||!this.processor.skipGaps)return;
  for(;;){
   const pending=this.processor.pending(),gapIds=new Set(this.archive.spatialGaps().map(r=>r.observation.id));
   let count=0;while(count<pending.length&&gapIds.has(pending[count]!))count++;
   if(!count)return;
   this.processor.skipGaps(pending.slice(0,count));
  }
 }
 /** Late independent facts reopen the affected observation and, once ready,
  * queue a revision of the original batch instead of rewriting old snapshots. */
 private scheduleLateRepairs(){
  if(!this.processor.lateRepairs)return;
  for(const repair of this.processor.lateRepairs()){
   const jobId='repair:'+repair.batchId;
   if(this.archive.jobs('spatial').some(job=>job.id===jobId)||this.archive.jobs('spatial','running').some(job=>job.id===jobId))continue;
   const missing=repair.missing.filter(id=>!this.archive.byIds([id])[0]!.facts);
   if(missing.length){this.archive.reopenFacts(missing);this.seal('perception',this.archive.latest()?.observation.atMs??0,true);continue;}
   this.archive.makeRepairJob(jobId,repair.sequences);
  }
 }
 questionEvidence(afterSequence=0,knownAtMs=Date.now()){
  return {observations:this.archive.read(afterSequence,64,knownAtMs),progress:this.progress(),note:'Latest visual evidence, independent of spatial versions. Temporary answers never write spatial memory.'};
 }
 /** Explicit offline baseline only. Live observe never waits for these gates. */
 canAcceptForQuality(row:Observation){
  if(this.fatal||this.stopped)throw Error('Quality replay cannot advance a failed spatial prefix');
  const bytes=Buffer.byteLength(JSON.stringify(row))+row.views.reduce((n,v)=>n+statSync(v.path).size,0);
  for(const lane of ['perception','spatial'] as const){
   const b=this.budget(lane),tasks=lane==='perception'?this.options.perceptionBudget:this.options.spatialBudget,p=this.archive.workProgress(lane);
   if(bytes>b.maxBytes)throw Error('Single observation exceeds '+lane+' budget');
   if(p.pending>=b.maxObservations||p.bytes+bytes>b.maxBytes||p.oldestAtMs!==null&&row.atMs-p.oldestAtMs>b.maxSpanMs||this.archive.jobs(lane).length+this.archive.jobs(lane,'running').length>=Math.max(1,tasks.maxTasks-1))return false;
  }
  return true;
 }
 retryFailures(){if(this.fatal)throw Error('Infrastructure failure requires explicit process recovery');if(this.perceptionTask||this.spatialTask)throw Error('Retry requires idle execution lanes');for(const lane of ['perception','spatial'] as const)this.archive.retryFailed(lane,{...this.budget(lane),maxTasks:(lane==='perception'?this.options.perceptionBudget:this.options.spatialBudget).maxTasks});this.stopped=null;this.kick();}
 progress(){const p=this.archive.workProgress('perception'),s=this.archive.workProgress('spatial'),archive=this.archive.progress(),spatialThroughAtMs=s.throughSequence?this.archive.bySequence(s.throughSequence).observation.atMs:null;return {...archive,spatialThroughSequence:s.throughSequence,spatialThroughAtMs,spatialLagMs:spatialThroughAtMs!==null&&archive.archivedThroughAtMs!==null?archive.archivedThroughAtMs-spatialThroughAtMs:null,fatal:this.fatal,judgmentFailureSkips:this.judgmentFailureSkips,consecutiveJudgmentFailures:this.consecutiveJudgmentFailures,perception:{...p,active:!!this.perceptionTask},spatial:{...s,...this.archive.schedulingSummary(),active:!!this.spatialTask,stopped:this.stopped}};}
 async drain(){
  this.tick(0,true);
  while(this.perceptionTask||this.spatialTask){if(this.perceptionTask)await this.perceptionTask;if(this.spatialTask)await this.spatialTask;this.kick();}
 }
 async close(){await this.drain();this.closed=true;}
}
