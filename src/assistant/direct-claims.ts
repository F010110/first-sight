import type {AgentResult} from './three-agent-store.js';

/** A new wire protocol, not a repair of malformed AgentResult output.
 * Every claim carries an explicit model-selected direct source. Summary and
 * duplicate top-level references are projections, never inferred citations. */
export function decodeDirectClaims(value:unknown,ids:string[]){
 if(!value||typeof value!=='object'||!Array.isArray((value as any).claims))throw Error('Expected direct-claims-v1 claims array');
 const claims=(value as any).claims as unknown[];
 if(!ids.length||new Set(ids).size!==ids.length||claims.length>ids.length*2)throw Error('Invalid direct claim coverage');
 const grouped=new Map(ids.map(id=>[id,[] as Array<{text:string;sourceIds:string[];memoryRefs:string[]}>]));
 for(const raw of claims){
  if(!raw||typeof raw!=='object')throw Error('Direct claim must be an object');
  const c=raw as Record<string,unknown>;
  if(Object.keys(c).some(k=>!['text','sourceIds'].includes(k))||typeof c.text!=='string'||!c.text.trim()||c.text.length>320||!Array.isArray(c.sourceIds)||c.sourceIds.length!==1||typeof c.sourceIds[0]!=='string'||!grouped.has(c.sourceIds[0]))throw Error('Invalid direct claim text or explicit sourceIds');
  const facts=grouped.get(c.sourceIds[0])!;
  if(facts.length>=2)throw Error('Too many claims for observation');
  facts.push({text:c.text,sourceIds:[c.sourceIds[0]],memoryRefs:[]});
 }
 return ids.map(observationId=>{
  const facts=grouped.get(observationId)!;
  if(!facts.length)return {observationId,error:'No explicitly cited direct claim for observation'};
  const result:AgentResult={facts,summary:facts.map(f=>f.text).join('；'),sourceIds:[observationId],memoryRefs:[]};
  return {observationId,result};
 });
}
