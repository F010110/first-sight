import type {AgentResult,ThreeAgentStore} from './three-agent-store.js';

type Memory=ReturnType<ThreeAgentStore['snapshot']>['results'][number];

/** Do not hand transitive raw citations to a model as if their images were delivered. */
export function memoryContext(row:Memory){
 if(row.lane!=='memory'||!row.memoryRef)throw Error('Not a historical memory result');
 return {memoryRef:row.memoryRef,sourceAtMs:row.source_at_ms,evidenceKind:'historical-interpretation-not-direct-vision',
  temporalScope:'Only this past observation time. This is NOT a prediction of the new current location. Any CURRENT/S0 in this text belongs to its old request, not the new request.',
  summary:row.result.summary,verified:false};
}

/** Whitelists describe exactly this request, independently of what exists in the database. */
export function validateAgentEvidence(result:AgentResult,deliveredIds:string[],deliveredMemoryRefs:string[]=[]){
  if(!result||typeof result.summary!=='string'||!result.summary.trim()||!Array.isArray(result.facts)||result.facts.some(f=>!f||typeof f!=='object'||typeof f.text!=='string'||!f.text.trim()))throw Error('Invalid agent result structure: facts must be objects with text, not strings');
 const direct=new Set(deliveredIds),indirect=new Set(deliveredMemoryRefs);
 if(!Array.isArray(result?.sourceIds)||result.sourceIds.some(id=>!direct.has(id)))throw Error('Undelivered evidence cited');
 if(result.memoryRefs!==undefined&&(!Array.isArray(result.memoryRefs)||result.memoryRefs.some(ref=>!indirect.has(ref))))throw Error('Undelivered memory cited');
 for(const fact of result.facts??[]){
  if(!Array.isArray(fact.sourceIds)||fact.sourceIds.some(id=>!direct.has(id)))throw Error('Undelivered fact evidence cited');
  if(fact.memoryRefs!==undefined&&(!Array.isArray(fact.memoryRefs)||fact.memoryRefs.some(ref=>!indirect.has(ref))))throw Error('Undelivered fact memory cited');
 }
 return result;
}
