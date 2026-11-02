import {createCompactionSummaryMessage,createBranchSummaryMessage,type AgentMessage} from '@earendil-works/pi-agent-core';
import type {Entry} from '@earendil-works/pi-agent-core';

/** Materialized view for inspection/checkpoints. Original Pi entries remain authoritative. */
export function projectSessionContext(entries:Entry[]):AgentMessage[]{
 let cut=-1;for(let i=entries.length-1;i>=0;i--)if(entries[i]!.type==='compaction'){cut=i;break;}
 const visible=cut<0?entries:entries.slice(cut);
 const valid=(m:AgentMessage)=>m.role!=='assistant'||!['error','aborted','deferred'].includes(m.stopReason);
 return visible.flatMap(e=>{
  if(e.type==='message')return valid(e.message)?[e.message]:[];
  if(e.type==='compaction')return [createCompactionSummaryMessage(e.summary,e.tokensBefore,e.timestamp),...e.retainedTail.filter(valid)];
  if(e.type==='branch_summary')return e.summary?[createBranchSummaryMessage(e.summary,e.fromId,e.timestamp)]:[];
  if(e.type==='custom'&&e.customType==='question_context')return [{role:'user' as const,content:JSON.stringify({type:'completed-question-context',data:e.data}),timestamp:e.timestamp}];
  return [];
 });
}
