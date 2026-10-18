import type {HistoricalEvidenceSession} from '../agent/spatial-evidence-retrieve.js';
/** Caller must hash-verify and actually deliver these current images first.
 * This records real input provenance, never repairs model citations for it.
 */
export function withCurrentEvidence(base:HistoricalEvidenceSession,currentId:string):HistoricalEvidenceSession{
 const inspected=new Set([currentId,...base.inspected]);
  return {inspected,...base.memorySummary?{memorySummary:()=>base.memorySummary!()}: {},search:q=>base.search(q),async inspect(ids){const result=await base.inspect(ids);for(const id of base.inspected)inspected.add(id);return result;},
 validateCitations(ids,abstained=false){
  if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!inspected.has(id))||!abstained&&!ids.length)throw Error('Citations require provided current frames or actually inspected historical frames');
  const historical=ids.filter(id=>id!==currentId);if(historical.length)base.validateCitations(historical,true);
 }};
}
