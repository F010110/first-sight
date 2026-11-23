import type {BatchSpatialMemory} from './batch-memory.js';
import type {SpatialEvidenceBatch,SpatialBatchSegment} from './spatial-batch.js';
import type {PlaceMatcher} from './revisit-candidates.js';
import {decideUlvnRevisits,type UlvnRevisitDecision} from './ulvn-revisit-decision.js';

export async function directBatchRevisits(memory:BatchSpatialMemory,batch:SpatialEvidenceBatch,matcher:PlaceMatcher,signal?:AbortSignal){
 const history=memory.history(batch.observations[0]!.atMs-.000001),previousPlaceId=history.at(-1)?.location.placeId??null;
 const memberships=new Map<string,string>();
 for(const record of history){if(!record.location.placeId||record.location.placeId===previousPlaceId)continue;for(const id of record.window?.observations.map(o=>o.id)??[record.observationId])memberships.set(id,record.location.placeId);}
 const first=memory.archive.byIds([batch.observations[0]!.id])[0]!;
 const candidates=memory.archive.byIds([...memberships.keys()]).filter(r=>r.observation.atMs<first.observation.atMs-60000).flatMap(r=>memory.originals([r.observation.id]).map(image=>({placeId:memberships.get(r.observation.id)!,image})));
 const decisions:UlvnRevisitDecision[]=[];
 // One simultaneous three-camera query at a time; bounded request and cancellation.
 for(const observation of batch.observations){signal?.throwIfAborted();const result=await matcher.match(memory.originals([observation.id]),candidates);signal?.throwIfAborted();decisions.push(...decideUlvnRevisits(result,previousPlaceId));}
 memory.store.event('ulvn-direct-revisit',{batchId:batch.id,previousPlaceId,decisions});
 return {previousPlaceId,decisions};
}

/** VLM chooses normal segmentation/new/continuation, but cannot approve/reject a revisit. */
export function enforceDirectRevisits(segments:SpatialBatchSegment[],decisions:UlvnRevisitDecision[],previousPlaceId:string|null){
 let active=previousPlaceId;
 for(const [index,segment] of segments.entries()){
  const loc=segment.assessment.location;
  const required=decisions.filter(d=>segment.observationIds.includes(d.observationId));
  const targets=new Set(required.map(d=>d.placeId));
  if(targets.size>1)throw Error('ULVN authority: split segment at distinct detected revisit identities');
  if(targets.size){const target=required[0]!.placeId;if(loc.status!=='known'||loc.placeId!==target)throw Error('ULVN authority: detected revisit must use placeId '+target+'; VLM does not confirm or reject it');if(!required.some(d=>loc.sourceIds.includes(d.historicalObservationId)))throw Error('ULVN authority: cite and inspect one supplied matched historical source');}
  else if(loc.status==='known'&&loc.placeId!==active&&!/^batch:\d+$/.test(loc.placeId??''))throw Error('ULVN authority: no verified revisit for this historical place; use normal continuation/new/boundary instead');
  for(const revision of segment.assessment.revisions??[]){const target=revision.location;if(target.status==='known'&&target.placeId!==active&&!decisions.some(d=>d.observationId===revision.observationId&&d.placeId===target.placeId))throw Error('ULVN authority: historical identity reassignment needs verified revisit evidence');}
  if(loc.status==='known')active=loc.placeId;
  else if(loc.status==='new')active='batch:'+index;
 }
}

/** Deterministic identity projection inside the real Pi tool, before validation/memo.
 * Raw model arguments remain in Session; the tool receipt reports applied segments.
 */
export function projectDirectRevisits(segments:SpatialBatchSegment[],decisions:UlvnRevisitDecision[],names:ReadonlyMap<string,string>,previousPlaceId:string|null=null){
 const byId=new Map(decisions.map(d=>[d.observationId,d])),batchIds=new Set(segments.flatMap(s=>s.observationIds));
 const output:SpatialBatchSegment[]=[],originalToProjected=new Map<number,number>();
 let activeBinding:UlvnRevisitDecision|undefined;
 for(const [originalIndex,segment] of segments.entries()){
  const runs:Array<{ids:string[];decision:UlvnRevisitDecision|undefined}>=[];
  for(const id of segment.observationIds){const decision=byId.get(id),last=runs.at(-1);if(last&&last.decision?.placeId===decision?.placeId)last.ids.push(id);else runs.push({ids:[id],decision});}
  let newIndex:number|undefined;
  for(const [runIndex,run] of runs.entries()){
   const assessment=structuredClone(segment.assessment),location=assessment.location,tail=run.ids.at(-1)!;
   location.sourceIds=[...new Set([...location.sourceIds.filter(id=>!batchIds.has(id)||run.ids.includes(id)),tail])];
   const binding=run.decision??(location.status==='known'&&(location.placeId===previousPlaceId||location.placeId===activeBinding?.placeId)?activeBinding:undefined);
   if(binding){
    activeBinding=binding;
    location.status='known';location.placeId=binding.placeId;location.name=names.get(binding.placeId)??location.name;
    location.reason=('ULVN direct revisit: '+run.ids.filter(id=>byId.has(id)).map(id=>id+' -> '+byId.get(id)!.historicalObservationId).join('; ')+'. Original current-scene explanation: '+location.reason).slice(0,1600);
    location.sourceIds=[...new Set([...location.sourceIds,binding.historicalObservationId,...run.ids.flatMap(id=>byId.get(id)?[byId.get(id)!.historicalObservationId]:[])])];
    delete location.contextRefs;delete location.boundary;delete location.regionChangeEvidence;
   }else if(location.status==='new'){
    activeBinding=undefined;
    if(newIndex===undefined)newIndex=output.length;
    else{location.status='known';location.placeId='batch:'+newIndex;location.sourceIds.push(output[newIndex]!.observationIds.at(-1)!);}
   }else{
    if(location.status==='unknown')activeBinding=undefined;
    const local=/^batch:(\d+)$/.exec(location.placeId??'');if(local){const mapped=originalToProjected.get(Number(local[1]));if(mapped===undefined)throw Error('ULVN projection: local place lost to a detected historical revisit');location.placeId='batch:'+mapped;}
   }
   // Keep non-location effects exactly once, at the original segment's tail.
   if(runIndex<runs.length-1){assessment.relations=[];delete assessment.revisions;delete assessment.memoryNotes;delete assessment.placeUpdates;delete assessment.placeRename;}
   output.push({observationIds:run.ids,assessment});
  }
  if(newIndex!==undefined)originalToProjected.set(originalIndex,newIndex);
 }
 return output;
}
