import type {StoredState,WorkingContext} from './contracts.js';

/** Transaction/identity references only. Session messages carry work history. */
export function spatialStateHead(context:WorkingContext){
 const ref=(s:StoredState)=>({observationId:s.observationId,atMs:s.atMs,version:s.version,visitId:s.visitId,assessment:{location:{status:s.assessment.location.status,placeId:s.assessment.location.placeId,name:s.assessment.location.name}},decisionAtThatTime:s.locationDecision});
 return {policy:'spatial-state-head-v1',current:context.current,location:context.location,recent:context.recent.map(ref),anchors:context.anchors.filter(a=>!context.recent.some(r=>r.observationId===a.observationId)).map(ref),unresolved:context.unresolved??[],note:'Identity reference index only; Session holds work history. References do not authorize historical image citations.'};
}

/** Model input only. Full observations, reasons and checkpoints stay immutable in SQLite. */
export function projectSpatialContext(context:WorkingContext){
 const seen=new Set<string>();
 const record=(state:StoredState)=>{
  const {reason,...location}=state.assessment.location;
  return {observationId:state.observationId,atMs:state.atMs,version:state.version,
   interpretationRole:'historical-not-current',decisionAtThatTime:state.locationDecision??'unrecorded',
   assessment:{location},historicalReason:reason.slice(0,240),
   visibleSummary:state.facts?.summary??null,unresolved:state.assessment.unresolved,
   windowSourceIds:state.window?.observations.map(o=>o.id)??[state.observationId]};
 };
 const unique=(states:StoredState[])=>states.filter(s=>{if(seen.has(s.observationId))return false;seen.add(s.observationId);return true;}).map(record);
 const recent=unique(context.recent),anchors=unique(context.anchors);
 return {policy:'spatial-model-projection-v1',current:context.current,location:context.location,recent,anchors,
  anchorRefs:context.anchors.map(s=>s.observationId),retrieved:context.retrieved,
  summary:context.summary,unresolved:context.unresolved??[],
  note:'Historical reasons explain decisions at their recorded times, not this turn. Full sources remain available through memory_read/inspect.'};
}
