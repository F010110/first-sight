import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {SpatialSqliteStore} from './spatial-sqlite-store.js';
import {SpatialRetriever,type RetrievalSession} from './spatial-retrieve.js';
import type {SpatialObservation} from './incremental-spatial-memory.js';
import type {SpatialLoopMemory} from './spatial-context-loop.js';
import type {ContextJudgment} from './spatial-working-context.js';
import type {MemoryClock} from './memory-clock.js';

/** New databases only. Uses the actual topology retriever, not an archive scan. */
export class SpatialContextMemory implements SpatialLoopMemory {
 private store:SpatialSqliteStore;
 private retriever:SpatialRetriever;
 private observation:SpatialObservation|null=null;
 private session:RetrievalSession|null=null;
 private last:ContextJudgment|null=null;
 private outputs:DatabaseSync;
 private aliases=new Map<string,string>();
 private candidates=new Map<string,{id:string;atMs:number;placeId:string|null;reason:string}>();
 constructor(path:string,private readonly clock?:MemoryClock){this.store=new SpatialSqliteStore(path);this.retriever=new SpatialRetriever(path);this.outputs=new DatabaseSync(path);this.outputs.exec('CREATE TABLE IF NOT EXISTS model_outputs(seq INTEGER PRIMARY KEY,at_ms REAL NOT NULL,kind TEXT NOT NULL,raw TEXT NOT NULL);CREATE INDEX IF NOT EXISTS model_output_time ON model_outputs(at_ms);');}
 close(){this.outputs.close();this.retriever.close();this.store.close();}
 counts(){return this.store.counts();}
 async writeOutput(atMs:number,value:unknown){this.outputs.prepare('INSERT INTO model_outputs(at_ms,kind,raw) VALUES(?,?,?)').run(atMs,'unverified-model-output',JSON.stringify(value));}
 async writeObservation(observation:SpatialObservation){
  if(!this.store.observation(observation.id)&&observation.atMs<this.store.lastObservationTime())throw Error('Cannot replay older observations into live memory');
  const existing=this.store.observation(observation.id);if(existing){if(JSON.stringify(existing)!==JSON.stringify(observation))throw Error('Observation identity collision');}else this.store.ingest(observation);
  this.observation=structuredClone(observation);this.last=null;this.candidates.clear();this.aliases.clear();
  const assignment=this.store.assignment(observation.id);if(assignment)this.last={observationId:observation.id,atMs:observation.atMs,placeId:assignment.placeId,reason:assignment.reason,sourceIds:[observation.id]};
  this.session=this.retriever.session({asOfMs:observation.atMs-1,...this.clock?{clock:this.clock}:{}},12,16);
 }
 async writeAssessment(assessment:ContextJudgment){
  const observation=this.store.observation(assessment.observationId);if(!observation)throw Error('No active observation');
  const previous=this.store.assignment(observation.id);this.last=previous?{...assessment,placeId:previous.placeId,reason:previous.reason}:null;
  let placeId=assessment.placeId;
  const alias=placeId&&/^new(?:-[1-9][0-9]*)?$/.test(placeId)?placeId:null;
  if(alias){const key=alias==='new'?observation.id:alias;placeId=this.aliases.get(key)??(alias==='new'?this.last?.placeId:null)??randomUUID();this.aliases.set(key,placeId);}
  const known=placeId?this.store.place(placeId):null;
  if(placeId&&!known&&!alias)throw Error('Unknown identity; use new or a retrieved/context place');
  const persisted={...assessment,placeId};
  const node=placeId?{id:placeId,summary:known?.summary??assessment.reason,status:known?.status??'candidate' as const,lastSeenMs:observation.atMs,representatives:[...(known?.representatives??[]).filter(o=>o.id!==observation.id),observation].slice(-2)}:undefined;
  const assignment={observationId:observation.id,placeId,reason:assessment.reason,sourceIds:[...assessment.sourceIds]};
  if(this.store.pending(1)[0]?.id===observation.id)this.store.commit([assignment],node?[node]:[]);
  else if(this.last?.placeId!==placeId||this.last?.reason!==assessment.reason)this.store.reassess(assignment,node);
  this.last=persisted;return persisted;
 }
 async search(query:string,cutoffMs:number){
  if(!this.session||cutoffMs!==this.observation?.atMs)throw Error('Invalid active query');
  const result=this.session.search(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(query)?{placeId:query,limit:4}:{query,limit:4});
  const candidates=result.hits.map(h=>({id:h.id,atMs:h.atMs,placeId:h.placeId,reason:h.reason,kind:'observation' as 'observation'|'model-statement'}));
  const records=this.outputs.prepare('SELECT seq,at_ms,raw FROM model_outputs WHERE at_ms<? AND instr(raw,?)>0 ORDER BY seq DESC LIMIT 2').all(cutoffMs,query) as Array<{seq:number;at_ms:number;raw:string}>;
  candidates.push(...records.map(r=>({id:`model-output:${r.seq}`,atMs:r.at_ms,placeId:null,reason:'UNVERIFIED MODEL STATEMENT, NOT VISUAL EVIDENCE: '+r.raw.slice(0,1200),kind:'model-statement' as const})));
  for(const c of candidates)this.candidates.set(c.id,c);return candidates;
 }
 async inspect(ids:string[],cutoffMs:number){
  if(!this.session||cutoffMs!==this.observation?.atMs)throw Error('Invalid inspection scope');
  for(const id of ids)if(!this.candidates.has(id)){
   const observation=this.store.observation(id);if(!observation||observation.atMs>=cutoffMs)throw Error('Unknown/future context source');
   const hit=this.session.search({afterMs:observation.atMs,beforeMs:observation.atMs,limit:4}).hits.find(h=>h.id===id);if(!hit)throw Error('Context source unavailable to retriever');
   this.candidates.set(id,{id,atMs:hit.atMs,placeId:hit.placeId,reason:hit.reason});
  }
  const visualIds=ids.filter(id=>!id.startsWith('model-output:'));const images=visualIds.length?await this.session.inspect(visualIds):[];
  return [...new Set(ids)].map(id=>{const candidate=this.candidates.get(id);if(!candidate)throw Error('Missing retrieved source');return {...candidate,kind:id.startsWith('model-output:')?'model-statement' as const:'observation' as const,images:images.filter(i=>i.id===id).map(i=>({mimeType:i.mimeType,data:i.data}))};});
 }
}
