import type {StoredState} from './contracts.js';
import type {ArchivedEvidence} from './observation-archive.js';

/** Independently bounded dynamic evidence module. Private question Session
 * compaction never owns/overwrites this projection or its original sources. */
export function questionSpatialModule(rows:ArchivedEvidence[],state:StoredState|null,softChars=24000){
 const observations=rows.map(r=>({id:r.observation.id,atMs:r.observation.atMs,facts:r.facts,omittedFromWorkingView:false}));
 const module={spatial:state?{version:state.version,atMs:state.atMs,availableAtMs:state.availableAtMs,location:state.assessment.location,visitId:state.visitId,unresolved:state.assessment.unresolved}:null,pendingCurrent:!!rows.length&&state?.observationId!==rows.at(-1)!.observation.id,observations,compression:{policy:'v3-question-spatial-module-v1',retainedTail:2,omittedFactIds:[] as string[],note:'A bounded working projection, not new facts. Omitted facts remain readable from original source IDs; null here does not mean no perception result.'}};
 for(let i=0;i<Math.max(0,observations.length-2)&&JSON.stringify(module).length>softChars;i++){
  if(!observations[i]!.facts)continue;observations[i]!.facts=null;observations[i]!.omittedFromWorkingView=true;module.compression.omittedFactIds.push(observations[i]!.id);
 }
 // validateFacts bounds each complete source, so two full sources and the small
 // spatial header have a fixed ceiling even when the preferred budget is smaller.
 if(JSON.stringify(module).length>80000)throw Error('Question evidence module exceeds hard budget');
 return module;
}
