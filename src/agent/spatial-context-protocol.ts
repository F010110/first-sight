import type {SpatialObservation} from './incremental-spatial-memory.js';

/** Model protocol failures are recoverable within the existing call budget.
 * This validator grants no identity, retrieval or citation permission. */
export function spatialProtocolError(value:unknown,observations:SpatialObservation[],question:string|null,inspected:ReadonlySet<string>,allowed:ReadonlySet<string>):string|null{
 const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(s=>typeof s==='string');
 if(!object(value))return 'Return one JSON object with assessments and next.';
 const assessments=value.assessments??[value.assessment];
 if(!Array.isArray(assessments)||assessments.length!==observations.length)return 'Return exactly one assessment for EVERY window observation.';
 const seen=new Set<string>();
 for(const a of assessments){
  if(!object(a)||typeof a.observationId!=='string'||seen.has(a.observationId))return 'Each assessment needs a unique exact window observationId.';
  seen.add(a.observationId);const target=observations.find(o=>o.id===a.observationId);
  if(!target||a.atMs!==target.atMs||typeof a.reason!=='string'||!a.reason.trim()||(a.placeId!==null&&typeof a.placeId!=='string'))return 'Each assessment needs exact observationId/atMs, nonempty reason and string or null placeId.';
  if(!strings(a.sourceIds)||!a.sourceIds.includes(target.id)||a.sourceIds.some(id=>!inspected.has(id)||id.startsWith('model-output:')))return 'Assessment sources must include its own window image and only actually delivered visual sources. Statements are not visual evidence.';
 }
 if(value.next===undefined||value.next===null)return question===null?null:'Active user question requires next=search/inspect/answer, not only spatial judgments.';
 if(!object(value.next))return 'next must be an object with kind=finish/search/inspect/answer.';
 const action=value.next;
 if(action.kind==='finish')return question===null?null:'finish cannot complete an active user question: answer or explicitly abstain.';
 if(action.kind==='search')return typeof action.query==='string'&&action.query.trim()&&action.query.length<=200?null:'search requires one nonempty query, at most 200 characters.';
 if(action.kind==='inspect'){
  if(!strings(action.ids)||!action.ids.length||action.ids.length>4||new Set(action.ids).size!==action.ids.length)return 'inspect requires 1–4 unique source IDs.';
  if(action.ids.some(id=>!allowed.has(id)))return 'inspect ID not available: first search for it, or use an older source explicitly present in recent/anchors.';
  return new Set([...inspected,...action.ids]).size<=observations.length+4?null:'Inspection source budget exhausted; answer with available evidence or explicitly abstain.';
 }
 if(action.kind==='answer'){
  if(question===null)return null; // Retained as a statement, never delivered.
  return typeof action.answer==='string'&&!!action.answer.trim()&&typeof action.abstained==='boolean'&&strings(action.sourceIds)&&action.sourceIds.every(id=>inspected.has(id))&&(action.abstained||action.sourceIds.length>0)?null:'answer requires nonempty answer, boolean abstained and sourceIds citing only delivered evidence; nonabstaining answers need citations.';
 }
 return `Unknown next.kind=${JSON.stringify(action.kind)}. Only finish/search/inspect/answer are supported. New locations belong in assessments[].placeId as new-1 etc, never in a new-place control action.`;
}
