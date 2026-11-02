import {mkdir,writeFile,appendFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
import type {ThreeAgentStore} from '../three-agent-store.js';
import {SpatialContextModule,type SpatialContextVersion} from './layered-context.js';
/** Publishes the existing real-time fact writer, without a model call or fabricated Pi spatial session. */
export class RealtimeSpatialContext {
 readonly module=new SpatialContextModule();readonly versions:SpatialContextVersion[]=[];
 private records:any[]=[];failure:string|null=null;
 constructor(private root:string,private expectedIds:readonly string[]){this.root=resolve(root);}
 async synchronize(store:Pick<ThreeAgentStore,'snapshot'>){
  if(this.failure)throw Error(this.failure);
  try{
   const committed=store.snapshot(Number.MAX_SAFE_INTEGER).results.filter(r=>r.lane==='memory');
   for(const record of committed.slice(this.records.length)){
    const index=this.records.length+1;
    if(record.observation_id!==this.expectedIds[index-1]||record.memoryRef!==`memory-v${index}`||this.records.length&&record.source_at_ms<=this.records.at(-1).source_at_ms)throw Error('Noncontiguous realtime fact publication');
    this.records.push(structuredClone(record));
    const sources=this.records.slice(-5).map(r=>({memoryRef:r.memoryRef,observationId:r.observation_id,atMs:r.source_at_ms,summary:r.result.summary,observations:r.result.facts.map((f:any)=>f.text)}));
    const content={kind:'realtime-source-context',currentObservation:sources.at(-1),sourceObservations:sources,interpretations:[],scope:'Original realtime fact producer; source observations are model descriptions, not certified identities'};
    const bytes=JSON.stringify({schema:'realtime-spatial-context-v1',observationId:record.observation_id,atMs:record.source_at_ms,sourceObservations:sources,messages:[{role:'user',timestamp:Date.now(),content:JSON.stringify(content)}]},null,2);
    await mkdir(join(this.root,'contexts'),{recursive:true});const contextPath=join(this.root,'contexts',String(index).padStart(4,'0')+'.json');await writeFile(contextPath,bytes,{flag:'wx'});
    const version:SpatialContextVersion={index,observationId:record.observation_id,atMs:record.source_at_ms,memoryRef:record.memoryRef!,tipId:`realtime-facts-v${index}`,contextPath,contextSHA256:createHash('sha256').update(bytes).digest('hex')};
    this.versions.push(version);this.module.publish(version);await appendFile(join(this.root,'publications.jsonl'),JSON.stringify(version)+'\n');
   }
  }catch(error){this.failure=String(error);throw error;}
 }
 snapshotAt(version:SpatialContextVersion):ReturnType<ThreeAgentStore['snapshot']>{
  if(!this.versions.some(v=>v.index===version.index&&v.contextSHA256===version.contextSHA256))throw Error('Unknown realtime context version');
  // Paused causal evaluation projection. Real availability remains in the raw SQLite store and timing report.
  const results=this.records.slice(0,version.index).map(r=>({...structuredClone(r),available_at_ms:r.source_at_ms,host_available_at_ms:r.available_at_ms}));
  return {asOfMs:version.atMs,version:version.index,pendingMemory:0,completeness:'processed-not-verified',memoryLayer:'observation-facts-not-confirmed-identities',relationshipReviews:{},evidence:[],results} as unknown as ReturnType<ThreeAgentStore['snapshot']>;
 }
}
