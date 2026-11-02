import type {SpatialJsonImage} from '../agent/spatial-json-vlm.js';
import type {AgentResult} from './three-agent-store.js';

/** Provenance is bound by the request envelope, not generated or repaired by an LLM.
 * Only a single observation, no memory, no cross-observation citation choices.
 * NEVER use this decoder to recover malformed direct-claims/AgentResult JSON. */
export function sourceBoundDescription(id:string,images:SpatialJsonImage[],description:unknown):AgentResult{
 if(!id||!images.length||images.length>3||images.some(i=>i.id!==id))throw Error('Source-bound description requires exactly one observation');
 if(typeof description!=='string'||!description.trim()||description.length>1200||/^\s*(?:[\[{]|```)/.test(description))throw Error('Invalid source-bound natural language description');
 return {facts:[{text:description.trim(),sourceIds:[id],memoryRefs:[]}],summary:description.trim(),sourceIds:[id],memoryRefs:[]};
}
