import type {AgentMessage} from '@earendil-works/pi-agent-core';

/** Candidate request projection, not a rewrite of stored session/history.
 * Retain original observations; do not feed generated hypotheses back as current evidence. */
export function projectRecentSourceContext(messages:readonly AgentMessage[],cutoff:number,limit=4):AgentMessage[]{
 const sources:AgentMessage[]=[];
 for(const message of messages){
  if(message.role!=='toolResult'||message.toolName!=='record_context'||message.isError)continue;
  for(const block of message.content){
   if(block.type!=='text')continue;
   const value=JSON.parse(block.text);
   if(!value.update?.observations||!value.memoryRef||!value.observationId)continue;
   if(!Number.isFinite(value.atMs)||value.atMs>cutoff)throw Error('Historical source outside current cutoff');
   sources.push({role:'user',timestamp:message.timestamp,content:JSON.stringify({kind:'historical-source-observation',memoryRef:value.memoryRef,observationId:value.observationId,atMs:value.atMs,observations:value.update.observations,scope:'Past source-backed model observations, not current visual evidence or certified identity'})});
  }
 }
 const tail=[...messages].reverse().find(m=>m.role==='user');
 return [...sources.slice(-limit),...tail?[structuredClone(tail)]:[]];
}
