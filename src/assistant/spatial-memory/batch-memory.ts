import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {Assessment,HistoryRecord,Observation,StoredState,WorkingContext,AgentCheckpoint} from './contracts.js';
import {validateAssessment} from './contracts.js';
import {SpatialLongTermStore} from './long-term-store.js';
import {SpatialWorkingMemory} from './working-context.js';
import {ObservationArchive} from './observation-archive.js';
import {validateBatchCoverage,type SpatialEvidenceBatch,type SpatialBatchSegment} from './spatial-batch.js';

export type BatchReceipt={id:string;inputHash:string;segmentsHash:string;versions:number[];checkpoint:AgentCheckpoint;availableAtMs:number;knowledgeCutoffMs:number;missingFactIds:string[];sources:Array<{id:string;archivedAtMs:number;factsAvailableAtMs:number|null;hashes:string[]}>};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** Reuses every v4 place/visit/note/rename/profile/revision table. A savepoint
 * around all segments prevents half a batch and its Context from being published. */
export class BatchSpatialMemory{
 readonly store:SpatialLongTermStore;
 private working=new SpatialWorkingMemory();
 constructor(root:string,readonly archive:ObservationArchive,private now=Date.now){
  this.store=new SpatialLongTermStore(root,now);this.store.initializeBatches();
 }
 restore(){
  const version=this.store.version();if(!version)return;
  const state=this.store.state(version)!,view=this.store.checkpoint(version);if(!view)throw Error('Missing working checkpoint');
  this.working.restore(this.store.observation(state.observationId)!,view);
 }
 context(batch:SpatialEvidenceBatch):WorkingContext{
  const copy=new SpatialWorkingMemory(),base=batch.revisionOfVersions?.[0],last=base?this.store.state(base):this.store.state(this.store.version());
  if(last)copy.restore(this.store.observation(last.observationId)!,this.store.checkpoint(last.version)!);
  const row=this.archive.byIds([batch.observations.at(-1)!.id])[0]!.observation;copy.begin(row,!!base);return copy.view();
 }
 history(beforeMs=Number.MAX_SAFE_INTEGER,knownAtMs=Number.MAX_SAFE_INTEGER,version=this.store.version()){return this.store.history(version,beforeMs,knownAtMs);}
 receipt(id:string):BatchReceipt|null{return this.store.batch(id);}
 receipts():BatchReceipt[]{return this.store.batches();}
 originals(ids:string[]){
  return this.archive.byIds(ids).flatMap(row=>row.observation.views.map(image=>{
   if(createHash('sha256').update(readFileSync(image.path)).digest('hex')!==image.sha256)throw Error('Archived source changed');return structuredClone(image);
  }));
 }
 validate(batch:SpatialEvidenceBatch,segments:SpatialBatchSegment[],delivered:ReadonlySet<string>,inspected:ReadonlySet<string>){
  validateBatchCoverage(batch,segments);
  const history=this.history(batch.observations[0]!.atMs-0.000001),byId=new Map<string,HistoryRecord>();
  for(const r of history){byId.set(r.observationId,r);for(const m of r.window?.observations??[])byId.set(m.id,r);}
  const context=this.context(batch),refs=[...context.recent,...context.anchors];
  const facts=new Set(batch.observations.map(o=>o.id));
  const available=new Set([...facts,...inspected]);
  let offset=0;
  for(let i=0;i<segments.length;i++){
   const segment=segments[i]!,a=segment.assessment,loc=a.location,tail=segment.observationIds.at(-1)!;
   // Source facts are delivered as facts, not falsely labelled inspected images.
   // validateAssessment's source set is an authorization set in this adapter.
   validateAssessment(a,tail,available);
   const missing=new Set(batch.missingFactIds??[]);
   const tailMissing=missing.has(segment.observationIds.at(-1)!);
   if(tailMissing&&loc.status!=='unknown')throw Error('Missing tail-independent facts require an explicit unknown segment; do not infer a known/new current place from absent evidence');
   if(loc.status==='unknown'&&!loc.boundary&&!tailMissing)throw Error('Bare unknown is not a legal final spatial segment');
   if(loc.contextRefs?.some(id=>!refs.some(r=>r.observationId===id)))throw Error('Undelivered working context reference');
   if(loc.status==='known'){
    const local=/^batch:(\d+)$/.exec(loc.placeId??'');
    if(local){const n=Number(local[1]);if(n>=i||segments[n]?.assessment.location.status!=='new')throw Error('Local place reference must refer to an earlier new segment');if(!loc.sourceIds.some(id=>segments[n]!.observationIds.includes(id)))throw Error('Local revisit requires prior segment evidence');}
    else{
     if(!this.store.placeProfile(loc.placeId!))throw Error('Unknown persistent place');
     const fromContext=loc.contextRefs?.some(id=>refs.some(r=>r.observationId===id&&r.assessment.location.placeId===loc.placeId))||refs.some(r=>r.assessment.location.placeId===loc.placeId);
     const fromHistory=loc.sourceIds.some(id=>delivered.has(id)&&inspected.has(id)&&byId.get(id)?.location.placeId===loc.placeId);
     if(!fromContext&&!fromHistory)throw Error(`Known identity requires current Context support or inspected and cited history of that place. Historical source candidates for this place: ${JSON.stringify([...byId.entries()].filter(([,record])=>record.location.placeId===loc.placeId).map(([id])=>id))}. Cite an inspected historical observation ID in location.sourceIds; merely inspecting without citing is insufficient.`);
    }
   }
   // Current facts may support attribution. Historical claims still require actual
   // delivered image evidence; old Session mentions do not grant source permission.
   for(const id of loc.sourceIds)if(!facts.has(id)&&(!delivered.has(id)||!inspected.has(id)))throw Error('Historical evidence was not inspected in this operation');
   const previous=i?segments[i-1]!.assessment.location:history.at(-1)?.location;
   const first=batch.observations[offset]!,prevAt=i?batch.observations[offset-1]!.atMs:history.at(-1)?.atMs;
   const currentRecording=this.archive.byIds([first.id])[0]!.observation.recordingId;
   const priorRecording=i?currentRecording:history.length?this.store.observation(history.at(-1)!.observationId)?.recordingId:undefined;
   if(previous&&previous.status!=='unknown'&&prevAt!==undefined&&(i>0||!batch.coverage?.gapBefore)&&first.atMs-prevAt<=8000&&currentRecording===priorRecording&&loc.status==='new'&&!loc.regionChangeEvidence?.length)throw Error('New adjacent region needs positive regionChangeEvidence');
   for(const revision of a.revisions??[])if(!byId.has(revision.observationId)||revision.location.status==='known'&&!revision.location.sourceIds.some(id=>inspected.has(id)&&byId.get(id)?.location.placeId===revision.location.placeId))throw Error('Historical revision needs inspected target and destination evidence');
   offset+=segment.observationIds.length;
  }
 }
 commit(batch:SpatialEvidenceBatch,segments:SpatialBatchSegment[],checkpoint:AgentCheckpoint,delivered:ReadonlySet<string>,inspected:ReadonlySet<string>):StoredState[]{
  const existing=this.receipt(batch.id);if(existing){if(existing.inputHash!==hash(batch)||existing.segmentsHash!==hash(segments)||existing.checkpoint.sessionId!==checkpoint.sessionId||existing.checkpoint.tipId!==checkpoint.tipId)throw Error('Conflicting batch replay');return existing.versions.map(v=>this.store.state(v)!);}
  if(!checkpoint.sessionId||!checkpoint.tipId||!Object.keys(checkpoint.skillVersions).length)throw Error('Real Session checkpoint required');
  const revisions=batch.revisionOfVersions;
  if(revisions&&(revisions.length!==segments.length||revisions.some(v=>!Number.isInteger(v)||v<1)))throw Error('Invalid batch revision versions');
  this.validate(batch,segments,delivered,inspected);
  this.originals(batch.observations.map(o=>o.id)); // Integrity check only; never injected into the model.
  const rows=this.archive.byIds(batch.observations.map(o=>o.id));
  for(let i=0;i<rows.length;i++)if(JSON.stringify(rows[i]!.facts)!==JSON.stringify(batch.observations[i]!.facts)||rows[i]!.observation.atMs!==batch.observations[i]!.atMs)throw Error('Batch independent facts changed');
  const working=new SpatialWorkingMemory(),last=this.store.state(this.store.version());if(last&&!revisions)working.restore(this.store.observation(last.observationId)!,this.store.checkpoint(last.version)!);
  const result=this.store.atomicBatch(batch.id,()=>{
   for(const row of rows){this.store.archive(row.observation);if(row.facts)this.store.saveFacts(row.observation.id,row.facts);}
   const states:StoredState[]=[];
   for(let segmentIndex=0;segmentIndex<segments.length;segmentIndex++){
    const segment=segments[segmentIndex]!;
    const a=structuredClone(segment.assessment),local=/^batch:(\d+)$/.exec(a.location.placeId??'');if(local)a.location.placeId=states[Number(local[1])]!.assessment.location.placeId;
    const members=rows.filter(r=>segment.observationIds.includes(r.observation.id)),tail=members.at(-1)!.observation;
    const missingFactIds=members.filter(r=>!r.facts).map(r=>r.observation.id);
    const window={startMs:members[0]!.observation.atMs,endExclusiveMs:tail.atMs+1,observations:members.map(r=>({id:r.observation.id,atMs:r.observation.atMs,facts:r.facts})),missingFactIds,batch:{id:batch.id,knowledgeCutoffMs:batch.observations.at(-1)!.atMs,segmentIndex,segmentCount:segments.length,...segmentIndex===0&&batch.coverage?.gapBefore?{gapBefore:true}:{}},...revisions?{revisionOfVersion:revisions[segmentIndex]}:{}};
    if(revisions){const base=this.store.state(revisions[segmentIndex]!);if(!base||JSON.stringify(base.window?.observations.map(o=>o.id))!==JSON.stringify(segment.observationIds))throw Error('Revision base does not match original segment members');const prior=this.store.checkpoint(revisions[segmentIndex]!);if(!prior)throw Error('Missing revision base Context');working.restore(this.store.observation(base.observationId)!,prior);working.begin(tail,true);}
    else working.begin(tail);
    const state=this.store.add(tail,a,s=>{working.commit(s);return working.view();},window);states.push(state);
   }
   const availableAtMs=Math.max(this.now(),last?.availableAtMs??0,...states.map(s=>s.availableAtMs),...rows.map(r=>Math.max(r.archivedAtMs,r.factsAvailableAtMs??0)));this.store.publishBatchAvailability(batch.id,states,availableAtMs);
   const receipt:BatchReceipt={id:batch.id,inputHash:hash(batch),segmentsHash:hash(segments),versions:states.map(s=>s.version),checkpoint,availableAtMs,knowledgeCutoffMs:batch.observations.at(-1)!.atMs,missingFactIds:batch.missingFactIds??[],sources:rows.map(r=>({id:r.observation.id,archivedAtMs:r.archivedAtMs,factsAvailableAtMs:r.factsAvailableAtMs,hashes:r.observation.views.map(v=>v.sha256)}))};
   return {value:states,receipt};
  });
  this.working=new SpatialWorkingMemory();const tail=result.at(-1)!;this.working.restore(this.store.observation(tail.observationId)!,this.store.checkpoint(tail.version)!);return result;
 }
 latest(knownAtMs=Number.MAX_SAFE_INTEGER){return this.store.latestAvailableState(knownAtMs);}
 pendingIds(){return this.store.pending().map(row=>row.id);}
 skipSpatialGaps(ids:string[]){
  const rows=this.archive.byIds(ids).map(r=>r.observation);
  if(!rows.length)return;
  this.store.skipWindow(rows,8000);
  this.store.event('spatial-gap-skipped',{observationIds:ids,reason:'bounded-overflow'});
 }
 /** Append a sourced revision of the current segment without creating a new
  * visit. This uses the same v4 revision transaction as the old service. */
 reviseCurrent(id:string,assessment:Assessment,checkpoint:AgentCheckpoint,delivered:ReadonlySet<string>,inspected:ReadonlySet<string>):StoredState{
  const previous=this.store.maintenance(id);
  if(previous){if(previous.assessmentHash!==hash(assessment)||previous.checkpoint.sessionId!==checkpoint.sessionId||previous.checkpoint.tipId!==checkpoint.tipId)throw Error('Conflicting maintenance replay');const state=this.store.state(previous.version);if(!state)throw Error('Maintenance state missing');return state;}
  const base=this.latest();if(!base?.window||base.assessment.location.status!=='known'||!base.assessment.location.placeId)throw Error('Current confirmed place required for maintenance');
  if(assessment.location.status!=='known'||assessment.location.placeId!==base.assessment.location.placeId)throw Error('Current-place maintenance cannot silently change location identity');
  const currentIds=new Set(base.window.observations.map(o=>o.id)),available=new Set([...currentIds,...inspected]);
  validateAssessment(assessment,base.observationId,available);
  for(const id of assessment.location.sourceIds)if(!currentIds.has(id)&&(!delivered.has(id)||!inspected.has(id)))throw Error('Historical maintenance evidence not actually inspected');
  const context=this.store.checkpoint(base.version)!;
  if(assessment.location.contextRefs?.some(id=>![...context.recent,...context.anchors].some(s=>s.observationId===id)))throw Error('Undelivered maintenance context reference');
  const history=this.history(base.atMs-0.000001),byId=new Map<string,HistoryRecord>();for(const record of history){byId.set(record.observationId,record);for(const member of record.window?.observations??[])byId.set(member.id,record);}
  for(const revision of assessment.revisions??[])if(!byId.has(revision.observationId)||revision.location.status==='known'&&!revision.location.sourceIds.some(id=>inspected.has(id)&&byId.get(id)?.location.placeId===revision.location.placeId))throw Error('Historical revision needs inspected target and destination evidence');
  const row=this.store.observation(base.observationId)!;this.originals(base.window.observations.map(o=>o.id));
  return this.store.atomicMaintenance(id,()=>{
   const working=new SpatialWorkingMemory();working.restore(row,context);working.begin(row,true);
   const state=this.store.add(row,assessment,s=>{working.commit(s);return working.view();},{...base.window!,revisionOfVersion:base.version});
   return {value:state,receipt:{id,version:state.version,baseVersion:base.version,assessmentHash:hash(assessment),checkpoint}};
  });
 }
 close(){this.store.close();}
}
