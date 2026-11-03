import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {SpatialLongTermStore} from './long-term-store.js';
import {SpatialWorkingMemory} from './working-context.js';
import {validateFacts,validateAssessment,type Observation,type SpatialModels,type SpatialReasoner,type Assessment,type StoredState,type WorkingContext,type HistoryRecord,type SpatialWindow} from './contracts.js';
import {SpatialOutputProtocolError} from '../../agent/spatial-protocol-retry.js';

/** Parallel perception, one ordered spatial writer. No questions or oracle input. */
export class SpatialMemoryService{
 private working=new SpatialWorkingMemory();
 private archiveTail=Promise.resolve();
 private commitTail=Promise.resolve();
 private extractionActive=0;
 private waiters:Array<()=>void>=[];
 private failure:string|null=null;
 private closed=false;
 private scheduled=new Set<string>();
 private extractionTasks=new Set<Promise<unknown>>();
 private bucket:Array<{row:Observation;extract:Promise<void>}>=[];
 private admitted=0;
 private windowExtractionTail=Promise.resolve();
 private evidenceWaitMs=8000;
 private evidencePolicy:'wait'|'deadline'='wait';
 private busyPolicy:'queue'|'skip-obsolete'='queue';
 private queuedWindows=new Set<string>();
 private deferredReleases:Array<()=>void>=[];
 private bucketTimer:ReturnType<typeof setTimeout>|null=null;
 private deliveredAt=new Map<string,number>();
 private sealedAt=new Map<string,number>();
 private perceptionTiming=new Map<string,{start:number;end?:number;calls:number}>();
 private judgmentStartedAt=new Map<string,number>();
 private peakAdmitted=0;
 private backpressureRejections=0;
 private published:StoredState|null=null;
 private constructor(readonly root:string,private models:SpatialModels,private reasoner:SpatialReasoner|null,private store:SpatialLongTermStore,private options:{extractionConcurrency:number;maxReasonCalls:number;now:()=>number;maxPending:number;cooldownMs:number;activeLimit:number;coolUntil:number;windowMs:number}){}
  static async create(rootArg:string,models:SpatialModels,options:{resume?:boolean;extractionConcurrency?:number;maxReasonCalls?:number;now?:()=>number;reasoner?:SpatialReasoner;maxPending?:number;cooldownMs?:number;windowMs?:number;evidenceWaitMs?:number;evidencePolicy?:'wait'|'deadline';busyPolicy?:'queue'|'skip-obsolete'}={}){
  const root=resolve(rootArg),concurrency=options.extractionConcurrency??2,max=options.maxReasonCalls??8,maxPending=options.maxPending??64,cool=options.cooldownMs??30000;
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8||!Number.isInteger(max)||max<1||max>32||!Number.isInteger(maxPending)||maxPending<1||maxPending>1024||!Number.isFinite(cool)||cool<0||cool>300000)throw Error('Invalid spatial execution budget');
  const windowMs=options.windowMs??0;
  if(![0,8000].includes(windowMs)||windowMs&&(!options.reasoner||maxPending<4))throw Error('8-second windows require Pi reasoner and capacity >=4');
  if(!options.resume){
   await mkdir(root,{recursive:true});
   // A new run may pre-create its Pi session directory, but it must not reuse
   // an existing spatial database without the explicit resume flag.
   try{await readFile(join(root,'spatial.sqlite'));throw Error('Existing spatial memory requires --resume');}
   catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  } else await readFile(join(root,'spatial.sqlite')); // Explicit same-session recovery only.
  const store=new SpatialLongTermStore(root,options.now??Date.now),service=new SpatialMemoryService(root,models,options.reasoner??null,store,{extractionConcurrency:concurrency,maxReasonCalls:max,now:options.now??Date.now,maxPending,cooldownMs:cool,activeLimit:concurrency,coolUntil:0,windowMs});
  if(windowMs&&!store.supportsWindowRevisions()){store.close();throw Error('Window memory requires a new schema-v4 database; legacy runs are preserved');}
  service.evidenceWaitMs=options.evidenceWaitMs??8000;
  service.evidencePolicy=options.evidencePolicy??'wait';
  service.busyPolicy=options.busyPolicy??'queue';
  if(!['wait','deadline'].includes(service.evidencePolicy)||!['queue','skip-obsolete'].includes(service.busyPolicy)||service.busyPolicy==='skip-obsolete'&&(!windowMs||service.evidencePolicy!=='wait')){store.close();throw Error('Busy skip requires complete-fact window mode');}
  if(!Number.isFinite(service.evidenceWaitMs)||service.evidenceWaitMs<0||service.evidenceWaitMs>120000){store.close();throw Error('Invalid evidence deadline');}
  const incomplete=store.history(store.version(),Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER).filter(r=>r.window?.missingFactIds?.length);
  service.admitted=store.pending().length+store.counts().deferredObservations+incomplete.reduce((n,r)=>n+r.window!.observations.length,0);
  const recoveredDeferred=store.counts().deferredObservations;if(recoveredDeferred)service.deferredReleases.push(()=>{service.admitted-=recoveredDeferred;});
  if(service.admitted>maxPending){store.close();throw Error('Recovered pending exceeds configured capacity');}
   try{if(options.resume){await service.reasoner?.recover?.(Array.from({length:store.version()},(_,i)=>store.state(i+1)!));}if(options.resume&&store.version()){
   const latest=store.history(store.version(),Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER).at(-1)!;
   const state=store.state(latest.version)!,context=store.checkpoint(state.version);if(!context)throw Error('Missing durable working checkpoint');
   service.working.restore(store.observation(state.observationId)!,context);service.published=state;
  }}catch(e){store.close();throw e;}
  return service;
 }
  async observe(source:Observation){
   if(this.closed)throw Error('Spatial service closed');
   // Reserve before joining archiveTail: callers cannot build an unbounded
   // queue of waiting observe promises. The caller must await capacity/retry.
   if(this.admitted>=this.options.maxPending){this.backpressureRejections++;throw Error('Spatial backpressure: capacity full; retry after progress');}
   this.admitted++;
   this.peakAdmitted=Math.max(this.peakAdmitted,this.admitted);
   let archived=false;
   const archive=this.archiveTail.then(async()=>{
   // Spatial failure stops ordered reasoning, never independent raw archival.
    if(this.options.windowMs&&this.store.latestObservation()&&source.atMs-this.store.latestObservation()!.atMs<2000)throw Error('8-second mode requires observations at least 2 seconds apart');
   if(!source.id||!Number.isFinite(source.atMs)||source.atMs<0||source.views.length!==3||new Set(source.views.map(v=>v.direction)).size!==3||source.views.some(v=>v.id!==source.id||!['front','left','right'].includes(v.direction)))throw Error('Require source-bound three-camera observation');
    const row:Observation={id:source.id,atMs:source.atMs,...source.sourceAtMs!==undefined?{sourceAtMs:source.sourceAtMs}:{},...source.recordingId?{recordingId:source.recordingId}:{},views:source.views.map(v=>({id:source.id,direction:v.direction,path:v.path,sha256:v.sha256}))};
   for(const view of row.views){const bytes=await readFile(view.path);if(createHash('sha256').update(bytes).digest('hex')!==view.sha256)throw Error('Original source hash mismatch');const path=join(this.root,'originals',view.sha256+'.png');await mkdir(join(this.root,'originals'),{recursive:true});try{await writeFile(path,bytes,{flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(createHash('sha256').update(await readFile(path)).digest('hex')!==view.sha256)throw Error('Archived source changed');}view.path=path;}
     this.store.archive(row);archived=true;this.deliveredAt.set(row.id,this.options.now());this.store.event('spatial-observation-archived',{id:row.id});this.schedule(row);
   });
   this.archiveTail=archive.catch(()=>{});try{return await archive;}catch(error){if(!archived)this.admitted--;throw error;}
 }
 private schedule(row:Observation){
  if(this.scheduled.has(row.id))return;this.scheduled.add(row.id);
   const extract=this.options.windowMs&&this.models.perceiveWindow?Promise.resolve():this.trackExtraction(this.extract(row));
   if(this.options.windowMs){
    if(this.bucket.length&&(Math.floor(this.bucket[0]!.row.atMs/8000)!==Math.floor(row.atMs/8000)||this.bucket[0]!.row.recordingId!==row.recordingId))this.flushWindow();
    this.bucket.push({row,extract});
    if(this.bucket.length===1){this.bucketTimer=setTimeout(()=>this.flushWindow(),this.options.windowMs);this.bucketTimer.unref();}
    if(this.bucket.length===4)this.flushWindow();
   }else this.enqueue([{row,extract}]);
  }
 private trackExtraction(task:Promise<void>){this.extractionTasks.add(task);void task.finally(()=>this.extractionTasks.delete(task)).catch(()=>{});return task;}
 private flushWindow(){if(this.bucketTimer){clearTimeout(this.bucketTimer);this.bucketTimer=null;}if(this.bucket.length){const batch=this.bucket;this.bucket=[];this.sealedAt.set(batch.at(-1)!.row.id,this.options.now());if(this.models.perceiveWindow){const task=this.trackExtraction(this.extractWindow(batch.map(b=>b.row)));for(const item of batch)item.extract=task;}this.enqueue(batch);}}
 private extractWindow(rows:Observation[]){
  const task=this.windowExtractionTail.then(async()=>{
   let missing=rows.filter(r=>!this.store.facts(r.id));if(!missing.length)return;
   const timing=this.perceptionTiming.get(rows.at(-1)!.id)??{start:this.options.now(),calls:0};timing.calls++;
   this.perceptionTiming.set(rows.at(-1)!.id,timing);
   this.extractionActive++;
   try{
    let feedback:string|undefined;
    for(let protocolAttempt=0;protocolAttempt<2;protocolAttempt++){
     try{
      let result:Array<{id:string;facts:import('./contracts.js').Facts}>|undefined;
      for(let attempt=0;attempt<3;attempt++){try{result=await this.models.perceiveWindow!(structuredClone(missing),feedback);break;}catch(error){if(attempt===2||!await this.congest(error))throw error;}}
      if(!Array.isArray(result)||!result.length||new Set(result.map(r=>r.id)).size!==result.length||result.some(r=>!missing.some(row=>row.id===r.id)))throw new SpatialOutputProtocolError('Batch perception returned missing, duplicate or foreign source IDs');
      let validated;try{validated=result.map(r=>({id:r.id,facts:validateFacts(r.facts)}));}catch(error){throw new SpatialOutputProtocolError(String(error));}
      for(const r of validated)this.store.saveFacts(r.id,r.facts);
      missing=missing.filter(r=>!this.store.facts(r.id));if(!missing.length)return;
      feedback='Incomplete batch. Return every supplied remaining source exactly once: '+JSON.stringify(missing.map(r=>r.id));
      this.store.event('partial-window-perception',{remainingIds:missing.map(r=>r.id),protocolAttempt});
     }catch(error){if(!(error instanceof SpatialOutputProtocolError)||protocolAttempt===1)throw error;feedback=String(error);}
    }
    throw new SpatialOutputProtocolError('Batch perception incomplete after bounded feedback: '+missing.map(r=>r.id).join(','));
   }catch(error){for(const row of missing.filter(r=>!this.store.facts(r.id)))this.store.fail(row.id,error);throw error;}
   finally{timing.end=this.options.now();this.extractionActive--;}
  });
  this.windowExtractionTail=task.catch(()=>{});return task;
 }
 private enqueue(batch:Array<{row:Observation;extract:Promise<void>}>){
  const settled=Promise.allSettled(batch.map(b=>b.extract));let done=false,initialVersion:number|null=null,released=false,repairQueued=false;
  const tailId=batch.at(-1)!.row.id;
  this.queuedWindows.add(tailId);
  if(!this.sealedAt.has(tailId))this.sealedAt.set(tailId,this.options.now());
   const release=()=>{if(released)return;released=true;this.admitted-=batch.length;this.clearTaskTiming(batch.map(b=>b.row.id));for(const b of batch)this.scheduled.delete(b.row.id);};
  const finish=()=>{
   if(!done||initialVersion===null)return;
   const state=this.store.state(initialVersion)!;
   if(state.window?.observations.some(o=>o.facts===null&&this.store.facts(o.id))&&!repairQueued){repairQueued=true;this.enqueueRepair(batch.map(b=>b.row),initialVersion,release);}
   else if(!repairQueued)release();
  };
  void settled.then(()=>{done=true;finish();});
   this.commitTail=this.commitTail.then(async()=>{
    this.queuedWindows.delete(tailId);
   if(this.failure)return;
   try{
    if(this.options.windowMs&&this.evidencePolicy==='deadline'){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([settled,new Promise<void>(resolve=>{timer=setTimeout(resolve,this.evidenceWaitMs);})]);}finally{if(timer)clearTimeout(timer);}}
    else if(this.options.windowMs){await settled;if(batch.some(b=>!this.store.facts(b.row.id)))throw Error('Independent window facts unavailable; no spatial judgment was run');}
    else await Promise.all(batch.map(b=>b.extract));
    if(this.busyPolicy==='skip-obsolete'&&this.queuedWindows.size){
     this.store.skipWindow(batch.map(b=>b.row));this.store.event('spatial-call-skipped',{tailId,reason:'busy-superseded',observationIds:batch.map(b=>b.row.id)});
     // Skipped evidence still occupies capacity until the successor receives it.
     this.deferredReleases.push(release);
     for(const b of batch)this.deliveredAt.delete(b.row.id);
     this.sealedAt.delete(tailId);this.perceptionTiming.delete(tailId);return;
    }
    await this.associate(batch.at(-1)!.row,this.options.windowMs?batch.map(b=>b.row):undefined);initialVersion=this.store.version();finish();
    for(const free of this.deferredReleases.splice(0))free();
   }
   catch(e){this.failure=String(e);this.store.fail(batch[0]!.row.id,e);}
  });
 }
 private enqueueRepair(rows:Observation[],version:number,release:()=>void){
  this.commitTail=this.commitTail.then(async()=>{
   if(this.failure)return;
   const working=this.working,published=this.published;
   try{
    const tail=rows.at(-1)!,latest=this.store.history(this.store.version(),Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER).find(r=>r.observationId===tail.id);
    if(latest&&!latest.window?.missingFactIds?.length)return;
    const targetVersion=latest?.version??version;this.working=new SpatialWorkingMemory();this.working.restore(tail,this.store.checkpoint(targetVersion)!);
    await this.associate(tail,rows,targetVersion);
    if(published&&published.atMs>tail.atMs){
     this.working=working;this.published=published;
     this.working.reconcile(this.store.state(this.store.version())!);
     const latestRow=this.store.observation(published.observationId)!;
     await this.associate(latestRow,published.window!.observations.map(o=>this.store.observation(o.id)!),published.version);
    }
   }catch(error){this.working=working;this.published=published;this.failure=String(error);this.store.fail(rows.at(-1)!.id,error);}
   finally{release();}
  });
 }
 private async extract(row:Observation){
   const timing=this.perceptionTiming.get(row.id)??{start:this.options.now(),calls:0};timing.calls++;
   this.perceptionTiming.set(row.id,timing);
  while(this.options.now()<this.options.coolUntil)await sleep(20);
   while(this.extractionActive>=this.options.activeLimit)await new Promise<void>(r=>this.waiters.push(r));
  this.extractionActive++;
  try{
   if(!this.store.facts(row.id)){
    let last:unknown=null;
    for(let attempt=0;attempt<3;attempt++){
     try{this.store.saveFacts(row.id,validateFacts(await this.models.perceive(structuredClone(row))));last=null;break;}
     catch(error){last=error;if(!(await this.congest(error)))break;}
    }
    if(last)throw last;
   }
  }finally{timing.end=this.options.now();this.extractionActive--;this.waiters.shift()?.();}
 }
 private async congest(error:unknown){
  if(!/HTTP 429|rate.?limit/i.test(String(error)))return false;
  const until=this.options.now()+this.options.cooldownMs;
  this.options.coolUntil=Math.max(this.options.coolUntil,until);this.options.activeLimit=1;
  this.store.event('congestion-429',{until,error:String(error)});
  while(this.options.now()<this.options.coolUntil)await sleep(Math.max(5,Math.min(1000,this.options.coolUntil-this.options.now())));
  // Recover one lane at a time after the cooling period; a further 429 will
  // cool down again. This is application concurrency, not an account quota claim.
  this.options.activeLimit=Math.min(this.options.extractionConcurrency,this.options.activeLimit+1);
  return true;
 }
  private async associate(row:Observation,rows?:Observation[],revisionOfVersion?:number){
    this.judgmentStartedAt.set(row.id,this.options.now());
    const skipped=rows&&revisionOfVersion===undefined?this.store.skippedBefore(rows[0]!.atMs):[];
    const window:SpatialWindow|undefined=rows?{startMs:rows[0]!.atMs,endExclusiveMs:(Math.floor(row.atMs/8000)+1)*8000,observations:rows.map(r=>({id:r.id,atMs:r.atMs,facts:this.store.facts(r.id)})),missingFactIds:rows.filter(r=>!this.store.facts(r.id)).map(r=>r.id),...skipped.length?{skippedBefore:skipped}:{},...revisionOfVersion!==undefined?{revisionOfVersion}:{}}:undefined;
   for(const view of (rows??[row]).flatMap(r=>r.views))if(createHash('sha256').update(await readFile(view.path)).digest('hex')!==view.sha256)throw Error('Archived current source changed');
   this.working.begin(row,revisionOfVersion!==undefined);
   const prior=this.store.history(this.store.version(),(window?.startMs??row.atMs)-0.000001,this.options.now());
   const byId=new Map(prior.map(r=>[r.observationId,r]));
   // Member source IDs resolve to their window record, not invented per-frame judgments.
    for(const record of prior)for(const member of record.window?.observations??[])byId.set(member.id,record);
    const skippedSourceIds=new Set([...(window?.skippedBefore??[]),...prior.flatMap(r=>r.window?.skippedBefore??[])].flatMap(w=>w.observations.map(o=>o.id)));
  const contextSources=[...this.working.view().recent,...this.working.view().anchors];
   const commit=(assessment:Assessment,inspected:ReadonlySet<string>)=>this.commitValidated(row,assessment,inspected,byId,contextSources,window);
  if(this.reasoner){
   let feedback:string|null=null,lastError:unknown=null;
    let committed:StoredState|null=null;
    for(let attempt=0;attempt<3;attempt++){
    try{
     const assessment=await this.reasoner.judge({
        row:structuredClone(row),facts:this.store.facts(row.id)!,context:this.working.view(),history:structuredClone(prior),expectedVersion:this.store.version()+1,...this.previousRegion(row,window)?{previousRegion:this.previousRegion(row,window)!}:{},...window&&rows?{window,windowViews:rows.flatMap(r=>r.views)}:{},
       evaluate:(a,evidence)=>{validateAssessment(a,row.id,evidence.inspected);this.validateIdentity(a,byId,contextSources);this.validateContinuity(row,a,window);if(a.relations.length||a.revisions?.length)throw Error('Interim assessment cannot submit relations or revisions');this.working.evaluate(a.location);this.store.event('spatial-interim',{observationId:row.id,assessment:a});},
        readPlace:(id,cursor,noteCursor)=>this.store.placeMemory(id,this.store.version(),this.options.now(),cursor,noteCursor,(window?.startMs??row.atMs)-0.000001),
        inspect:async ids=>{
        const originals=ids.map(id=>{if(!byId.has(id)&&!skippedSourceIds.has(id))throw Error('Inspection source outside committed history or explicitly skipped inputs');return this.store.observation(id)!;});
       const images=originals.flatMap(o=>o.views);if(images.length>9)throw Error('Inspection image limit');
       for(const image of images)if(createHash('sha256').update(await readFile(image.path)).digest('hex')!==image.sha256)throw Error('Inspection source changed');
        this.working.deliver(ids.flatMap(id=>byId.has(id)?[byId.get(id)!]:[]));return structuredClone(images);
      },
      commit:async (a,evidence)=>{if(committed)throw Error('Only one spatial commit per observation');committed=commit(a,evidence.inspected);return committed;},
      feedback
     });
     if(!committed)throw Error('Spatial reasoner returned without committing a location judgment');
     return;
     }catch(error){
      if(committed)throw Error('Spatial state committed; checkpoint/agent finalization failed, explicit recovery required: '+String(error));
      lastError=error;feedback=String(error);this.store.event('spatial-agent-failure',{observationId:row.id,attempt,error:String(error)});
      if(await this.congest(error))continue;
      if(!/Invalid declared Pi tool call|SpatialOutputProtocolError|not valid JSON|Invalid bounded assessment/i.test(String(error)))throw error;
     }
   }
   throw lastError;
  }
   let imageWindow=row.views,toolResult:unknown=null,feedback:string|null=null,inspected=new Set([row.id]);
   const delivered=new Set(contextSources.map(s=>s.observationId));
  const reason=this.models.reason;if(!reason)throw Error('Spatial service requires a reasoner or a reason model');
  for(let call=0;call<this.options.maxReasonCalls;call++){
   let action;
   try{action=await reason({current:structuredClone(row),facts:this.store.facts(row.id)!,context:this.working.view(),toolResult,inspectedIds:[...inspected],remainingCalls:this.options.maxReasonCalls-call,feedback},structuredClone(imageWindow));}
   catch(error){
    if(await this.congest(error)){feedback='Provider was rate limited; continue with a complete action.';continue;}
    if(error instanceof SpatialOutputProtocolError){feedback='Previous response was not a valid spatial action. Return exactly one JSON action with a complete assessment. '+String(error);this.store.event('rejected-spatial-action',{observationId:row.id,error:feedback});continue;}
    throw error;
   }
   this.store.event('spatial-action',{observationId:row.id,call,action});feedback=null;
   let committing=false;
   try{
    const provisional=validateAssessment(action.assessment,row.id,inspected);
    if(provisional.location.contextRefs?.some(id=>!contextSources.some(s=>s.observationId===id)))throw Error('Undelivered working context reference');
    const contextSupport=provisional.location.contextRefs?.some(id=>contextSources.some(s=>s.observationId===id&&s.assessment.location.placeId===provisional.location.placeId));
    if(provisional.location.status==='known'&&!contextSupport&&!provisional.location.sourceIds.some(id=>id!==row.id&&byId.get(id)?.location.placeId===provisional.location.placeId))throw Error('Known identity requires delivered working context or inspected historical evidence of that place');
    // Every tool continuation has a source-bound current judgment. Interim
    // judgments stay in the durable action journal, not the published state.
    if(action.kind!=='commit'){
     if(provisional.revisions?.length||provisional.relations.length)throw Error('Relations and revisions require final atomic commit');
     this.working.evaluate(provisional.location);
    }
    if(action.kind==='commit'){
     committing=true;commit(provisional,inspected);return;
    }
    if(action.kind==='find'){
     if(!Array.isArray(action.terms)||!action.terms.length||action.terms.length>6||action.terms.some(t=>typeof t!=='string'||!t.trim()))throw Error('Invalid literal search terms');
     const terms=action.terms.map(t=>t.toLowerCase());const matches=prior.filter(r=>terms.some(t=>JSON.stringify(r).toLowerCase().includes(t))).slice(0,12);
     for(const r of matches)delivered.add(r.observationId);
     toolResult={kind:'previews',records:matches.map(r=>({...r,facts:r.facts?{summary:r.facts.summary.slice(0,240),details:[]}:null})),semanticCompleteness:false};
    }else if(action.kind==='read'){
     const after=action.afterMs??0,before=action.beforeMs??row.atMs-0.000001,cursor=action.cursor??0;
     if(!Number.isFinite(after)||!Number.isFinite(before)||after<0||before<after||before>=row.atMs||!Number.isInteger(cursor)||cursor<0)throw Error('Invalid causal read range');
     const range=prior.filter(r=>r.atMs>=after&&r.atMs<=before),records=range.slice(cursor,cursor+24);
     for(const r of records)delivered.add(r.observationId);
     this.working.deliver(records);
     toolResult={kind:'records',records,nextCursor:cursor+records.length<range.length?cursor+records.length:null,semanticCompleteness:false};
    }else if(action.kind==='inspect'){
     if(!Array.isArray(action.observationIds)||!action.observationIds.length||action.observationIds.length>3||new Set(action.observationIds).size!==action.observationIds.length||action.observationIds.some(id=>!byId.has(id)||!delivered.has(id)))throw Error('Inspect only delivered committed historical sources');
     const originals=action.observationIds.map(id=>this.store.observation(id)!);
     imageWindow=[...row.views,...originals.flatMap(o=>o.views)]; // <=12 original images.
     for(const image of imageWindow)if(createHash('sha256').update(await readFile(image.path)).digest('hex')!==image.sha256)throw Error('Inspection source changed');
     inspected=new Set([row.id,...action.observationIds]);
     const records=action.observationIds.map(id=>byId.get(id)!);this.working.deliver(records);toolResult={kind:'inspected-originals',records};
    }else throw Error('Unknown spatial action');
   }catch(e){if(committing)throw e;feedback=String(e);this.store.event('rejected-spatial-action',{observationId:row.id,error:feedback});}
  }
  throw Error('Spatial reasoning budget exhausted without a durable location judgment');
 }
  private validateIdentity(assessment:Assessment,byId:Map<string,HistoryRecord>,contextSources:Array<{observationId:string;assessment:{location:{placeId:string|null}}}>){
  const contextSupport=assessment.location.contextRefs?.some(id=>contextSources.some(s=>s.observationId===id&&s.assessment.location.placeId===assessment.location.placeId));
  if(assessment.location.contextRefs?.some(id=>!contextSources.some(s=>s.observationId===id)))throw Error('Undelivered working context reference');
   if(assessment.location.status==='known'&&!contextSupport&&!assessment.location.sourceIds.some(id=>byId.get(id)?.location.placeId===assessment.location.placeId))throw Error('Known identity requires delivered working context or inspected historical evidence of that place');
   for(const revision of assessment.revisions??[])if(revision.location.status==='known'&&!revision.location.sourceIds.some(id=>byId.get(id)?.location.placeId===revision.location.placeId))throw Error('Revised identity requires inspected evidence of the destination place');
  }
  private commitValidated(row:Observation,assessment:Assessment,inspected:ReadonlySet<string>,byId:Map<string,HistoryRecord>,contextSources:Array<{observationId:string;assessment:{location:{placeId:string|null}}}>,window?:SpatialWindow){
   validateAssessment(assessment,row.id,inspected);this.validateIdentity(assessment,byId,contextSources);
   if(window?.missingFactIds?.includes(row.id)&&assessment.location.status!=='unknown')throw Error('Tail observation facts unavailable: current location must remain unknown');
   this.validateContinuity(row,assessment,window);
   const state=this.store.add(row,assessment,s=>{const next=new SpatialWorkingMemory();next.restore(row,this.working.view(),true);next.commit(s);return next.view();},window);
   this.finalizeTask(row.id,state);
   this.working.commit(state);if(!this.published||state.atMs>=this.published.atMs)this.published=structuredClone(state);return state;
 }
 /** Per-window latency facts; wall-clock only, no semantic claim. */
 private finalizeTask(tailId:string,state:StoredState){
  const members=state.window?.observations.map(o=>o.id)??[state.observationId];
  const delivered=members.map(id=>this.deliveredAt.get(id)).filter((v):v is number=>typeof v==='number');
  const sealed=this.sealedAt.get(tailId),perception=this.perceptionTiming.get(tailId),judgment=this.judgmentStartedAt.get(tailId);
  const committed=state.availableAtMs;
   const previous=this.store.lastTaskTiming(tailId),priorNumber=(key:string)=>typeof previous?.[key]==='number'?previous[key] as number:undefined;
   const oldest=delivered.length?Math.min(...delivered):priorNumber('deliveredAtMs'),tailDelivery=delivered.length?Math.max(...delivered):priorNumber('tailDeliveredAtMs');
   const originalSeal=sealed??priorNumber('sealedAtMs'),perceptionStart=perception?.start??priorNumber('perceptionStartMs'),perceptionEnd=perception?.end??priorNumber('perceptionEndMs');
   this.store.event('spatial-task-timing',{taskId:tailId,version:state.version,observationIds:members,
   ...state.window?.revisionOfVersion!==undefined?{repairOfVersion:state.window.revisionOfVersion}:{},
    deliveredAtMs:oldest??null,tailDeliveredAtMs:tailDelivery??null,
    sealedAtMs:originalSeal??null,perceptionStartMs:perceptionStart??null,perceptionEndMs:perceptionEnd??null,
    perceptionCalls:perception?.calls??priorNumber('perceptionCalls')??0,judgmentStartMs:judgment??null,committedAtMs:committed,
    phase:state.window?.revisionOfVersion===undefined?'initial':'revision',
    sealedToCommitMs:originalSeal===undefined?null:committed-originalSeal,
    oldestDeliveryToCommitMs:oldest===undefined?null:committed-oldest,
    tailDeliveryToCommitMs:tailDelivery===undefined?null:committed-tailDelivery,
    perceptionToCommitMs:perceptionEnd===undefined?null:committed-perceptionEnd,
   missingFactCount:state.window?.missingFactIds?.length??0,
   missingFactIds:state.window?.missingFactIds??[]});
   this.judgmentStartedAt.delete(tailId);
  }
  private clearTaskTiming(members:string[]){for(const id of members){this.deliveredAt.delete(id);this.sealedAt.delete(id);this.perceptionTiming.delete(id);this.judgmentStartedAt.delete(id);}}
 /** Copy of completed task timings. */
  taskTimings(){return this.store.taskTimings();}
  async resumePending(){
   if(this.closed||this.scheduled.size||this.failure)throw Error('Resume requires a newly reopened service');
    for(const row of this.store.pending()){const archived=this.store.archivedAt(row.id);if(archived!==undefined)this.deliveredAt.set(row.id,archived);this.schedule(row);}
   for(const record of this.store.history(this.store.version(),Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER).filter(r=>r.window?.missingFactIds?.length)){
    const rows=record.window!.observations.map(o=>this.store.observation(o.id)!);for(const row of rows)this.scheduled.add(row.id);
    const task=this.trackExtraction(this.models.perceiveWindow?this.extractWindow(rows):Promise.all(rows.map(row=>this.extract(row))).then(()=>{}));
     void task.then(()=>this.enqueueRepair(rows,record.version,()=>{this.admitted-=rows.length;this.clearTaskTiming(rows.map(row=>row.id));for(const row of rows)this.scheduled.delete(row.id);}),error=>{this.failure=String(error);});
   }
  }
 private previousRegion(row:Observation,window?:SpatialWindow){
  if(!window)return null;
  const previous=this.working.view().recent.filter(s=>s.atMs<window.startMs).at(-1);
  if(!previous?.window||previous.window.endExclusiveMs!==window.startMs||this.store.observation(previous.observationId)?.recordingId!==row.recordingId||previous.window.missingFactIds?.includes(previous.observationId)||previous.assessment.location.boundary)return null;
  const location=previous.assessment.location,placeId=location.placeId??location.continuityCandidate?.placeId;
  return placeId?{observationId:previous.observationId,placeId,name:location.name,uncertain:location.status!=='known'}:null;
 }
 private validateContinuity(row:Observation,assessment:Assessment,window?:SpatialWindow){
  const previous=this.previousRegion(row,window),location=assessment.location;
  if(previous&&location.status==='new'&&!location.regionChangeEvidence?.length)throw Error('New region requires positive regionChangeEvidence, not merely a new view or failure to match. Continue the supported previous identity, or remain unknown.');
  const candidate=location.continuityCandidate;
  if(candidate&&(!previous||candidate.referenceId!==previous.observationId||candidate.placeId!==previous.placeId||window?.missingFactIds?.includes(row.id)))throw Error('Continuity candidate must reference the adjacent same-recording context region with available current evidence; gaps, boundaries and missing tail facts cannot inherit identity');
 }
 knows(id:string){return !!this.store.observation(id);}
  async finishInput(){await this.archiveTail;this.flushWindow();await Promise.allSettled([...this.extractionTasks]);let tail:Promise<void>;do{tail=this.commitTail;await tail;}while(tail!==this.commitTail);if(this.failure)throw Error(this.failure);return this.store.counts();}
 latest(){
  if(!this.published)return null;
  const current=this.store.latestObservation()!,pending=current.id!==this.published.observationId;
  return structuredClone({state:this.published,context:this.store.checkpoint(this.published.version)!,current:{id:current.id,atMs:current.atMs},currentLocation:pending?null:this.published.assessment.location,pendingCurrent:pending});
 }
 /** Question/evaluation facade returns copies only; no writable store escapes. */
 snapshotAt(version:number,knownAtMs:number){
  const state=this.store.state(version);
  if(!state||!Number.isFinite(knownAtMs)||state.availableAtMs>knownAtMs)throw Error('Uncommitted or not yet available spatial version');
  const history=this.store.history(version,state.atMs,knownAtMs);
   type Visit={visitId:string|null;placeId:string;recording:string|undefined;observationIds:string[];provisionalObservationIds:string[];lastAtMs:number};
  let active:Visit|null=null;
  const visits:Visit[]=[];
  for(const r of history){
   const recording=this.store.observation(r.observationId)?.recordingId;
    if(!r.location.placeId){if(active&&r.location.continuityCandidate?.placeId===active.placeId&&r.provisionalVisitId===active.visitId&&active.recording===recording){active.provisionalObservationIds.push(r.observationId);active.lastAtMs=r.atMs;}else active=null;continue;}
    if(!active||active.placeId!==r.location.placeId||active.recording!==recording||r.atMs-active.lastAtMs>60000||r.visitId&&active.visitId!==r.visitId){
     active={visitId:r.visitId??null,placeId:r.location.placeId,recording,observationIds:[],provisionalObservationIds:[],lastAtMs:r.atMs};visits.push(active);
   }
   active.observationIds.push(r.observationId);active.lastAtMs=r.atMs;
  }
  const transitions=history.slice(1).map((r,i)=>({fromObservationId:history[i]!.observationId,toObservationId:r.observationId,fromPlaceId:history[i]!.location.placeId,toPlaceId:r.location.placeId,kind:'observed-order-not-traversability' as const}));
  return structuredClone({state,context:this.store.checkpoint(version)!,history,visits,transitions});
 }
  reader(){return Object.freeze({latest:()=>this.latest(),snapshotAt:(version:number,knownAtMs:number)=>this.snapshotAt(version,knownAtMs),placeAt:(version:number,knownAtMs:number,id:string,cursor=0,noteCursor=0)=>{const snapshot=this.snapshotAt(version,knownAtMs);return structuredClone(this.store.placeMemory(id,version,knownAtMs,cursor,noteCursor,snapshot.state.atMs));},inspectAt:async(version:number,knownAtMs:number,ids:string[])=>{
   const snapshot=this.snapshotAt(version,knownAtMs),allowed=new Set(snapshot.history.flatMap(r=>[r.observationId,...r.window?.observations.map(o=>o.id)??[],...r.window?.skippedBefore?.flatMap(w=>w.observations.map(o=>o.id))??[]]));
  if(!Array.isArray(ids)||!ids.length||ids.length>3||new Set(ids).size!==ids.length||ids.some(id=>!allowed.has(id)))throw Error('Read-only image access outside committed snapshot');
  const images=ids.flatMap(id=>this.store.observation(id)!.views);for(const image of images)if(createHash('sha256').update(await readFile(image.path)).digest('hex')!==image.sha256)throw Error('Read-only source changed');return structuredClone(images);
 }});}
  progress(){return {...this.store.counts(),admitted:this.admitted,capacity:this.options.maxPending,peakAdmitted:this.peakAdmitted,backpressureRejections:this.backpressureRejections,activeExtractions:this.extractionActive,bufferedObservations:this.bucket.length,failure:this.failure};}
 async close(){if(this.closed)return;try{await this.finishInput();}finally{this.closed=true;await this.reasoner?.close().catch(()=>{});this.store.close();}}
}
