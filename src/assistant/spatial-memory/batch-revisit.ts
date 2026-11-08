import type {SpatialEvidenceBatch} from './spatial-batch.js';
import {BatchSpatialMemory} from './batch-memory.js';
import {revisitProjection,summarizeRevisitRecall,revisitRecallUnavailable,type PlaceMatcher,type RevisitPlace} from './revisit-candidates.js';

/** Recall each fast evidence range, not just the tail of a 40-second batch. */
export async function recallBatchRevisits(memory:BatchSpatialMemory,batch:Pick<SpatialEvidenceBatch,'id'> & {observations:Array<{id:string;atMs:number}>},matcher:PlaceMatcher,options:{maxPlaces:number;limit:number;imagesPerPlace:number;fastMs:number;version?:number;knownAtMs?:number;audit?:boolean},signal?:AbortSignal){
 const grouped=new Map<string,{name:string;ids:string[]}>();
 for(const record of memory.history(batch.observations[0]!.atMs-0.000001,options.knownAtMs??Number.MAX_SAFE_INTEGER,options.version??memory.store.version())){
  if(!record.location.placeId)continue;
  const entry=grouped.get(record.location.placeId)??{name:record.location.name,ids:[]};entry.name=record.location.name;entry.ids.push(record.observationId);grouped.delete(record.location.placeId);grouped.set(record.location.placeId,entry);
 }
 const places:RevisitPlace[]=[...grouped].reverse().slice(0,options.maxPlaces).map(([placeId,entry])=>{
  const picks:string[]=[];for(let i=0;i<Math.min(entry.ids.length,options.imagesPerPlace);i++)picks.push(entry.ids[Math.round(i*(entry.ids.length-1)/Math.max(1,Math.min(entry.ids.length,options.imagesPerPlace)-1))]!);
  return {placeId,name:entry.name,members:memory.archive.byIds([...new Set(picks)]).flatMap(r=>r.observation.views.map(v=>({observationId:r.observation.id,atMs:r.observation.atMs,...v}))).map(v=>({observationId:v.observationId,atMs:v.atMs,path:v.path,sha256:v.sha256,direction:v.direction}))};
 });
 const ranges=new Map<number,string[]>();for(const observation of batch.observations){const key=Math.floor(observation.atMs/options.fastMs);ranges.set(key,[...(ranges.get(key)??[]),observation.id]);}
 const output=[];
 for(const [bucket,ids] of ranges){
  signal?.throwIfAborted();
  const queryIds=[...new Set([ids[0]!,ids.at(-1)!])],query=memory.originals(queryIds);
  let recall;
  if(!places.length)recall=summarizeRevisitRecall([],null,{ok:true,best:null,nearest:null,results:[]},options.limit);
  else try{recall=summarizeRevisitRecall(places,null,await matcher.match(query,places.flatMap(p=>p.members.map(m=>({placeId:p.placeId,image:{id:m.observationId,direction:m.direction,path:m.path,sha256:m.sha256}})))),options.limit);}catch(error){recall=revisitRecallUnavailable(places,null,String(error),options.limit);}
  signal?.throwIfAborted();
  if(options.audit!==false)memory.store.event('batch-revisit-recall',{batchId:batch.id,bucket,observationIds:ids,...recall});
  output.push({observationIds:ids,...revisitProjection(recall)});
 }
 return output;
}
