import type { WindowAnswer,WindowRecognizer } from './spatial-topology-service.js';

/** Independent bounded second decision for new identities. No summary-based auto merge.
 * Caller must reserve both recognizers' provider/repair budgets before enabling this.
 */
export function reviewedIdentityRecognizer(initial:WindowRecognizer,review:(...args:[...Parameters<WindowRecognizer>,WindowAnswer])=>Promise<WindowAnswer>,audit:(value:unknown)=>Promise<void>):WindowRecognizer{
 return async(batch,history)=>{
  const proposal=await initial(batch,history);
  const old=new Set(history.nodes.map(n=>n.id));
  if(!proposal.assignments.some(a=>a.placeId!==null&&!old.has(a.placeId)))return proposal;
  // Historical evidence and input observations are unchanged; proposal is untrusted.
  const answer=await review(structuredClone(batch),structuredClone(history),structuredClone(proposal));
  const ids=new Set(batch.map(o=>o.id)),declared=new Set(answer.places.map(p=>p.id));
  if(answer.assignments.length!==ids.size||new Set(answer.assignments.map(a=>a.observationId)).size!==ids.size||declared.size!==answer.places.length||answer.places.some(p=>!p.summary?.trim()||(!old.has(p.id)&&!/^new-[1-9][0-9]*$/.test(p.id)))||answer.assignments.some(a=>!ids.has(a.observationId)||!a.reason?.trim()||(a.placeId!==null&&!old.has(a.placeId)&&!declared.has(a.placeId))))throw Error('Invalid identity review; refuse commit');
  await audit({batch:[...ids],proposal,review:answer,note:'Second decision, not ground truth; no automatic summary deduplication.'});
  return answer;
 };
}
