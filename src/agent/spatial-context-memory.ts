import {randomUUID} from 'node:crypto';
import {SpatialSqliteStore} from './spatial-sqlite-store.js';
import {SpatialRetriever,type RetrievalSession} from './spatial-retrieve.js';
import type {SpatialObservation} from './incremental-spatial-memory.js';
import type {SpatialLoopMemory} from './spatial-context-loop.js';
import type {ContextJudgment} from './spatial-working-context.js';

/** New databases only. Uses the actual topology retriever, not an archive scan. */
export class SpatialContextMemory implements SpatialLoopMemory {
 private store:SpatialSqliteStore;
 private retriever:SpatialRetriever;
 private observation:SpatialObservation|null=null;
 private session:RetrievalSession|null=null;
 private last:ContextJudgment|null=null;
 private candidates=new Map<string,{id:string;atMs:number;placeId:string|null;reason:string}>();
 constructor(path:string){this.store=new SpatialSqliteStore(path);this.retriever=new SpatialRetriever(path);}
 close(){this.retriever.close();this.store.close();}
 async restore(cutoffMs:number){return this.store.workingHistory(cutoffMs).map(({observation,assignment})=>({observation,assessment:{observationId:observation.id,atMs:observation.atMs,placeId:assignment.placeId,reason:assignment.reason,sourceIds:(assignment as typeof assignment&{sourceIds?:string[]}).sourceIds??[observation.id]}}));}
 async writeObservation(observation:SpatialObservation){
  if(observation.atMs<this.store.lastObservationTime())throw Error('Cannot replay older observations into live memory');
  const existing=this.store.observation(observation.id);if(existing){if(JSON.stringify(existing)!==JSON.stringify(observation))throw Error('Observation identity collision');}else this.store.ingest(observation);
  this.observation=structuredClone(observation);this.last=null;this.candidates.clear();
  const assignment=this.store.assignment(observation.id);if(assignment)this.last={observationId:observation.id,atMs:observation.atMs,placeId:assignment.placeId,reason:assignment.reason,sourceIds:[observation.id]};
  this.session=this.retriever.session({asOfMs:observation.atMs-1},12);
 }
 async writeAssessment(assessment:ContextJudgment){
  const observation=this.observation;if(!observation||assessment.observationId!==observation.id)throw Error('No active observation');
  let placeId=assessment.placeId;
  if(placeId==='new')placeId=this.last?.placeId??randomUUID();
  const known=placeId?this.store.place(placeId):null;
  if(placeId&&!known&&assessment.placeId!=='new')throw Error('Unknown identity; use new or a retrieved/context place');
  const persisted={...assessment,placeId};
  const node=placeId?{id:placeId,summary:known?.summary??assessment.reason,status:known?.status??'candidate' as const,lastSeenMs:observation.atMs,representatives:[...(known?.representatives??[]).filter(o=>o.id!==observation.id),observation].slice(-2)}:undefined;
  const assignment={observationId:observation.id,placeId,reason:assessment.reason,sourceIds:[...assessment.sourceIds]};
  if(this.store.pending(1)[0]?.id===observation.id)this.store.commit([assignment],node?[node]:[]);
  else if(this.last?.placeId!==placeId||this.last?.reason!==assessment.reason)this.store.reassess(assignment,node);
  this.last=persisted;return persisted;
 }
 async search(query:string,cutoffMs:number){
  if(!this.session||cutoffMs!==this.observation?.atMs)throw Error('Invalid active query');
  const result=this.session.search({query,limit:4});
  const candidates=result.hits.map(h=>({id:h.id,atMs:h.atMs,placeId:h.placeId,reason:h.reason}));for(const c of candidates)this.candidates.set(c.id,c);return candidates;
 }
 async inspect(ids:string[],cutoffMs:number){
  if(!this.session||cutoffMs!==this.observation?.atMs)throw Error('Invalid inspection scope');
  for(const id of ids)if(!this.candidates.has(id)){
   const observation=this.store.observation(id);if(!observation||observation.atMs>=cutoffMs)throw Error('Unknown/future context source');
   const hit=this.session.search({afterMs:observation.atMs,beforeMs:observation.atMs,limit:4}).hits.find(h=>h.id===id);if(!hit)throw Error('Context source unavailable to retriever');
   this.candidates.set(id,{id,atMs:hit.atMs,placeId:hit.placeId,reason:hit.reason});
  }
  const images=await this.session.inspect(ids);
  return [...new Set(ids)].map(id=>{const candidate=this.candidates.get(id);if(!candidate)throw Error('Missing retrieved source');return {...candidate,images:images.filter(i=>i.id===id).map(i=>({mimeType:i.mimeType,data:i.data}))};});
 }
}
