import type {SpatialObservation} from '../../agent/incremental-spatial-memory.js';
import type {RepairQuestion} from './memory-answer-repair.js';
export interface InterleavedEvent {observations:SpatialObservation[];question:RepairQuestion|null;atMs:number}
/** Public clocks only. Questions interrupt/flush pending observations; never
 * include a frame arriving after the question. Equal-time questions use ID order. */
export function interleavedSchedule(observations:SpatialObservation[],questions:RepairQuestion[]):InterleavedEvent[]{
 if(new Set(questions.map(q=>q.id)).size!==questions.length)throw Error('Duplicate public question');
 const sorted=[...questions].sort((a,b)=>a.queryAtMs-b.queryAtMs||a.id.localeCompare(b.id)),events:InterleavedEvent[]=[],pending:SpatialObservation[]=[];
 let cursor=0,started=-Infinity,previous:SpatialObservation|undefined;
 const flush=()=>{while(pending.length){const batch=pending.splice(0,4);events.push({observations:batch,question:null,atMs:batch[batch.length-1]!.atMs});}};
 for(let i=0;i<observations.length;i++){
  const observation=observations[i]!;if(previous&&observation.atMs<previous.atMs)throw Error('Out-of-order observations');
  if(previous&&previous.recordingId!==observation.recordingId){flush();started=-Infinity;}
  pending.push(observation);
  if(observation.atMs-pending[0]!.atMs>=10000&&observation.atMs-started>=5000){const batch=pending.splice(0,4);events.push({observations:batch,question:null,atMs:observation.atMs});started=observation.atMs;}
  const next=observations[i+1]?.atMs??Infinity;
  while(cursor<sorted.length&&sorted[cursor]!.queryAtMs<next){
   const question=sorted[cursor++]!;
   if(question.queryAtMs<=observation.atMs||question.currentObservationId!==observation.id)throw Error('Question does not match latest causal observation');
   flush();const last=events[events.length-1];
   if(last&&!last.question&&last.observations[last.observations.length-1]!.id===observation.id){last.question=question;last.atMs=question.queryAtMs;}
   else events.push({observations:[observation],question,atMs:question.queryAtMs});
  }
  previous=observation;
 }
 flush();if(cursor!==sorted.length)throw Error('Unscheduled questions');return events;
}
