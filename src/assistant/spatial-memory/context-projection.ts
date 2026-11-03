import type {StoredState,WorkingContext} from './contracts.js';

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
