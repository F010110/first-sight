import { randomUUID } from 'node:crypto';
import { SpatialSqliteStore } from './spatial-sqlite-store.js';
import { SpatialVisualRecall } from './spatial-visual-recall.js';
import type { SpatialObservation } from './incremental-spatial-memory.js';
import type { TopologyNode,WindowRecognizer } from './spatial-topology-service.js';
import { DatabaseSync } from 'node:sqlite';

/** Explicit opt-in development service. Does not alter frozen v1 source or default API. */
export class SpatialV2Service{
  private store:SpatialSqliteStore;
  private evidence:DatabaseSync;
 private busy:Promise<void>|null=null;
 private lastStarted=-Infinity;
 private loaded=false;
  constructor(path:string,private recognize:WindowRecognizer,private recall:SpatialVisualRecall,private trace:(value:unknown)=>void=()=>{},private temporalOverlap=false){this.store=new SpatialSqliteStore(path);this.evidence=new DatabaseSync(path,{readOnly:true});}
 async load(){
  // Explicit startup backfill, bounded pages and zero model calls. Safe after revision/restart.
  let cursor=0;while(true){const page=this.store.page(100,cursor);if(!page.observations.length)break;await this.recall.index(page.observations);cursor=page.nextCursor;}
  this.loaded=true;
 }
 summary(){return this.store.summary();}
 hasObservation(id:string){return this.store.hasObservation(id);}
 page(limit=100,after=0){return this.store.page(limit,after);}
 context(){return this.store.context();}
 async ingest(row:SpatialObservation){if(!this.loaded)throw Error('Load service first');this.store.ingest(row);}
 tick(now:number,flush=false):Promise<void>{
  if(!this.loaded)return Promise.reject(Error('Load service first'));if(this.busy)return this.busy;
  const task=this.run(now,flush);this.busy=task;void task.finally(()=>{if(this.busy===task)this.busy=null;}).catch(()=>{});return task;
 }
 private async run(now:number,flush:boolean){
  const batch=this.store.pending(4);if(!batch.length||(!flush&&(now-batch[0]!.atMs<10000||now-this.lastStarted<5000)))return;
  this.lastStarted=now;
  const original=this.store.context();const recall=await this.recall.query(batch,Math.min(...batch.map(o=>o.atMs)),2);
  // At most three historical nodes ensures all three original references reach frozen recognizer.
  const matched=new Map(recall.hits.map(h=>[h.placeId,h.node]));const seen=new Set<string>();
  const nodes=[...original.nodes.slice(0,1),...recall.hits.map(h=>h.node),...original.nodes].filter(n=>{if(seen.has(n.id))return false;seen.add(n.id);return true;}).slice(0,3).map(n=>matched.get(n.id)??n);
   const before=Math.min(...batch.map(o=>o.atMs));const recording=batch[0]!.recordingId;
   // Two prior committed groups overlap windows so a boundary is not forgotten at flush.
   // Same recording only, strict historical cutoff; never pending/current or evaluator poses.
   const recent=!this.temporalOverlap||recording===undefined?[]:this.evidence.prepare('SELECT o.raw FROM observations o JOIN assignments a ON a.observation_id=o.id WHERE o.pending=0 AND o.recording_id=? AND o.at_ms<? ORDER BY o.at_ms DESC,o.seq DESC LIMIT 2').all(recording,before) as Array<{raw:string}>;
   const observations=recent.map(r=>JSON.parse(r.raw) as SpatialObservation).reverse();
   const history={...original,nodes,observations};this.trace({batch:batch.map(o=>o.id),asOfExclusiveMs:before,recentEvidenceIds:observations.map(o=>o.id),recall:recall.hits.map(({node,...hit})=>hit),scanned:recall.scanned,candidateIds:nodes.map(n=>n.id),method:recall.method});
  const answer=await this.recognize(batch,history);
  const existing=new Map(nodes.map(n=>[n.id,n]));const mapping=new Map(nodes.map(n=>[n.id,n.id]));const changed=new Map<string,TopologyNode>();
  if(!answer||!Array.isArray(answer.places)||!Array.isArray(answer.assignments))throw Error('Invalid recognition answer');
  for(const place of answer.places){
   if(typeof place.id!=='string'||!place.summary?.trim()||changed.has(mapping.get(place.id)??place.id))throw Error('Invalid/duplicate place');
   if(existing.has(place.id))changed.set(place.id,structuredClone(this.store.place(place.id)!));
   else{if(!/^new-[1-9][0-9]*$/.test(place.id))throw Error('Unsupplied place identity');const id=randomUUID();mapping.set(place.id,id);changed.set(id,{id,summary:place.summary,status:'candidate',representatives:[],lastSeenMs:0});}
  }
  if(answer.assignments.length!==batch.length||new Set(answer.assignments.map(a=>a.observationId)).size!==batch.length)throw Error('Incomplete assignments');
  const assignments=batch.map(o=>{
   const a=answer.assignments.find(a=>a.observationId===o.id);if(!a||!a.reason?.trim()||(a.placeId!==null&&!mapping.has(a.placeId)))throw Error('Invalid assignment');
   const placeId=a.placeId===null?null:mapping.get(a.placeId)!;
   if(placeId){
    // Persist original representatives, not temporary matched-evidence candidate view.
    const node=changed.get(placeId)??structuredClone(this.store.place(placeId)!);
    if(!node)throw Error('Missing place');node.lastSeenMs=o.atMs;node.representatives.push(o);if(node.representatives.length>2)node.representatives.splice(1,1);changed.set(placeId,node);
   }
   return {...a,placeId};
  });
  // Index before commit; pending/unassigned features cannot appear in recall JOIN.
  await this.recall.index(batch);this.store.commit(assignments,[...changed.values()]);
 }
 async revise(...args:Parameters<SpatialSqliteStore['revise']>){if(this.busy)throw Error('Stop worker before revisions');return this.store.revise(...args);}
 async undo(...args:Parameters<SpatialSqliteStore['undo']>){if(this.busy)throw Error('Stop worker before undo');return this.store.undo(...args);}
  close(){if(this.busy)throw Error('Processing in flight');this.recall.close();this.evidence.close();this.store.close();}
}
