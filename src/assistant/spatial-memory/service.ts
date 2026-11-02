import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {SpatialLongTermStore} from './long-term-store.js';
import {SpatialWorkingMemory} from './working-context.js';
import {validateFacts,validateAssessment,type Observation,type SpatialModels,type StoredState,type WorkingContext,type HistoryRecord} from './contracts.js';

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
 private extractionTasks:Promise<unknown>[]=[];
 private published:StoredState|null=null;
 private constructor(readonly root:string,private models:SpatialModels,private store:SpatialLongTermStore,private options:{extractionConcurrency:number;maxReasonCalls:number;now:()=>number}){}
 static async create(rootArg:string,models:SpatialModels,options:{resume?:boolean;extractionConcurrency?:number;maxReasonCalls?:number;now?:()=>number}={}){
  const root=resolve(rootArg),concurrency=options.extractionConcurrency??2,max=options.maxReasonCalls??8;
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8||!Number.isInteger(max)||max<1||max>32)throw Error('Invalid spatial execution budget');
  if(!options.resume)await mkdir(root,{recursive:false});
  else await readFile(join(root,'spatial.sqlite')); // Explicit same-session recovery only.
  const store=new SpatialLongTermStore(root,options.now??Date.now),service=new SpatialMemoryService(root,models,store,{extractionConcurrency:concurrency,maxReasonCalls:max,now:options.now??Date.now});
  try{if(options.resume&&store.version()){
   const state=store.state(store.version())!,context=store.checkpoint(state.version);if(!context)throw Error('Missing durable working checkpoint');
   service.working.restore(store.observation(state.observationId)!,context);service.published=state;
  }}catch(e){store.close();throw e;}
  return service;
 }
 async observe(source:Observation){
  if(this.closed)throw Error('Spatial service closed');
  const archive=this.archiveTail.then(async()=>{
   // Spatial failure stops ordered reasoning, never independent raw archival.
   if(!source.id||!Number.isFinite(source.atMs)||source.atMs<0||source.views.length!==3||new Set(source.views.map(v=>v.direction)).size!==3||source.views.some(v=>v.id!==source.id||!['front','left','right'].includes(v.direction)))throw Error('Require source-bound three-camera observation');
   const row:Observation={id:source.id,atMs:source.atMs,...source.recordingId?{recordingId:source.recordingId}:{},views:source.views.map(v=>({id:source.id,direction:v.direction,path:v.path,sha256:v.sha256}))};
   for(const view of row.views){const bytes=await readFile(view.path);if(createHash('sha256').update(bytes).digest('hex')!==view.sha256)throw Error('Original source hash mismatch');const path=join(this.root,'originals',view.sha256+'.png');await mkdir(join(this.root,'originals'),{recursive:true});try{await writeFile(path,bytes,{flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(createHash('sha256').update(await readFile(path)).digest('hex')!==view.sha256)throw Error('Archived source changed');}view.path=path;}
   this.store.archive(row);this.schedule(row);
  });
  this.archiveTail=archive.catch(()=>{});return archive;
 }
 private schedule(row:Observation){
  if(this.scheduled.has(row.id))return;this.scheduled.add(row.id);
  const extract=this.extract(row);this.extractionTasks.push(extract);void extract.catch(()=>{});
  this.commitTail=this.commitTail.then(async()=>{if(this.failure)return;try{await extract;await this.associate(row);}catch(e){this.failure=String(e);this.store.fail(row.id,e);}});
 }
 private async extract(row:Observation){
  if(this.extractionActive>=this.options.extractionConcurrency)await new Promise<void>(r=>this.waiters.push(r));
  this.extractionActive++;
  try{
   if(!this.store.facts(row.id))this.store.saveFacts(row.id,validateFacts(await this.models.perceive(structuredClone(row))));
  }finally{this.extractionActive--;this.waiters.shift()?.();}
 }
 private async associate(row:Observation){
  for(const view of row.views)if(createHash('sha256').update(await readFile(view.path)).digest('hex')!==view.sha256)throw Error('Archived current source changed');
  this.working.begin(row);
  const prior=this.store.history(this.store.version(),row.atMs-0.000001,this.options.now());
  const byId=new Map(prior.map(r=>[r.observationId,r]));
  const delivered=new Map<string,HistoryRecord>();
  for(const s of [...this.working.view().recent,...this.working.view().anchors]){const r=byId.get(s.observationId);if(r)delivered.set(r.observationId,r);}
  const inspected=new Set([row.id]);let imageWindow=row.views,toolResult:unknown=null,feedback:string|null=null;
  for(let call=0;call<this.options.maxReasonCalls;call++){
   const action=await this.models.reason({current:structuredClone(row),facts:this.store.facts(row.id)!,context:this.working.view(),toolResult,inspectedIds:[...inspected],remainingCalls:this.options.maxReasonCalls-call,feedback},structuredClone(imageWindow));
   this.store.event('spatial-action',{observationId:row.id,call,action});feedback=null;
   let committing=false;
   try{
    const provisional=validateAssessment(action.assessment,row.id,inspected);
    const contextSources=[...this.working.view().recent,...this.working.view().anchors];
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
     const assessment=provisional;
     for(const revision of assessment.revisions??[])if(revision.location.status==='known'&&!revision.location.sourceIds.some(id=>id!==row.id&&byId.get(id)?.location.placeId===revision.location.placeId))throw Error('Revised identity requires inspected evidence of the destination place');
     committing=true;
     const state=this.store.commit(row,assessment,s=>{const next=new SpatialWorkingMemory();next.restore(row,this.working.view());next.commit(s);return next.view();});
     // Publish only after SQLite atomically commits both state and checkpoint.
     this.working.commit(state);this.published=structuredClone(state);return;
    }
    if(action.kind==='find'){
     if(!Array.isArray(action.terms)||!action.terms.length||action.terms.length>6||action.terms.some(t=>typeof t!=='string'||!t.trim()))throw Error('Invalid literal search terms');
     const terms=action.terms.map(t=>t.toLowerCase());const matches=prior.filter(r=>terms.some(t=>JSON.stringify(r).toLowerCase().includes(t))).slice(0,12);
     for(const r of matches)delivered.set(r.observationId,r);
     toolResult={kind:'previews',records:matches.map(r=>({...r,facts:{summary:r.facts.summary.slice(0,240),details:[]}})),semanticCompleteness:false};
    }else if(action.kind==='read'){
     const after=action.afterMs??0,before=action.beforeMs??row.atMs-0.000001,cursor=action.cursor??0;
     if(!Number.isFinite(after)||!Number.isFinite(before)||after<0||before<after||before>=row.atMs||!Number.isInteger(cursor)||cursor<0)throw Error('Invalid causal read range');
     const range=prior.filter(r=>r.atMs>=after&&r.atMs<=before),records=range.slice(cursor,cursor+24);
     for(const r of records)delivered.set(r.observationId,r);this.working.deliver(records);
     toolResult={kind:'records',records,nextCursor:cursor+records.length<range.length?cursor+records.length:null,semanticCompleteness:false};
    }else if(action.kind==='inspect'){
     if(!Array.isArray(action.observationIds)||!action.observationIds.length||action.observationIds.length>3||new Set(action.observationIds).size!==action.observationIds.length||action.observationIds.some(id=>!delivered.has(id)))throw Error('Inspect only delivered historical sources');
     const originals=action.observationIds.map(id=>this.store.observation(id)!);
     imageWindow=[...row.views,...originals.flatMap(o=>o.views)]; // <=12 original images.
     for(const image of imageWindow)if(createHash('sha256').update(await readFile(image.path)).digest('hex')!==image.sha256)throw Error('Inspection source changed');
     inspected.clear();inspected.add(row.id);for(const original of originals)inspected.add(original.id);
     const records=action.observationIds.map(id=>delivered.get(id)!);this.working.deliver(records);toolResult={kind:'inspected-originals',records};
    }else throw Error('Unknown spatial action');
   }catch(e){if(committing)throw e;feedback=String(e);this.store.event('rejected-spatial-action',{observationId:row.id,error:feedback});}
  }
  throw Error('Spatial reasoning budget exhausted without a durable location judgment');
 }
 async resumePending(){
  if(this.closed||this.scheduled.size||this.failure)throw Error('Resume requires a newly reopened service');
  for(const row of this.store.pending())this.schedule(row);
 }
 async finishInput(){await this.archiveTail;await Promise.allSettled(this.extractionTasks);await this.commitTail;if(this.failure)throw Error(this.failure);return this.store.counts();}
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
  type Visit={placeId:string;recording:string|undefined;observationIds:string[];lastAtMs:number};
  let active:Visit|null=null;
  const visits:Visit[]=[];
  for(const r of history){
   const recording=this.store.observation(r.observationId)?.recordingId;
   if(!r.location.placeId){active=null;continue;}
   if(!active||active.placeId!==r.location.placeId||active.recording!==recording||r.atMs-active.lastAtMs>60000){
    active={placeId:r.location.placeId,recording,observationIds:[],lastAtMs:r.atMs};visits.push(active);
   }
   active.observationIds.push(r.observationId);active.lastAtMs=r.atMs;
  }
  const transitions=history.slice(1).map((r,i)=>({fromObservationId:history[i]!.observationId,toObservationId:r.observationId,fromPlaceId:history[i]!.location.placeId,toPlaceId:r.location.placeId,kind:'observed-order-not-traversability' as const}));
  return structuredClone({state,context:this.store.checkpoint(version)!,history,visits,transitions});
 }
 reader(){return Object.freeze({latest:()=>this.latest(),snapshotAt:(version:number,knownAtMs:number)=>this.snapshotAt(version,knownAtMs),inspectAt:async(version:number,knownAtMs:number,ids:string[])=>{
  const snapshot=this.snapshotAt(version,knownAtMs),allowed=new Set(snapshot.history.map(r=>r.observationId));
  if(!Array.isArray(ids)||!ids.length||ids.length>3||new Set(ids).size!==ids.length||ids.some(id=>!allowed.has(id)))throw Error('Read-only image access outside committed snapshot');
  const images=ids.flatMap(id=>this.store.observation(id)!.views);for(const image of images)if(createHash('sha256').update(await readFile(image.path)).digest('hex')!==image.sha256)throw Error('Read-only source changed');return structuredClone(images);
 }});}
 progress(){return {...this.store.counts(),failure:this.failure};}
 async close(){if(this.closed)return;try{await this.finishInput();}finally{this.closed=true;this.store.close();}}
}
