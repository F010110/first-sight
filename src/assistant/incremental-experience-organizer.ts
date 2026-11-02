import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {ThreeAgentStore} from './three-agent-store.js';
import {OrganizedExperienceMemory,proposeExperienceBoundaries,type ExperienceFact} from './organized-experience-memory.js';

/** Reconcile actual committed facts, including missed callbacks and late arrivals. No model calls. */
export async function synchronizeCommittedExperience(store:ThreeAgentStore,path:string){
 const snapshot=store.snapshot(Number.MAX_SAFE_INTEGER);
 const rows=snapshot.results.filter(r=>r.lane==='memory');
 if(rows.length>5000)throw Error('Incremental organizer bounded at 5000 committed facts');
 const memory=new OrganizedExperienceMemory(path);
 try{
  const prior=memory.facts({eventAtMs:Number.MAX_SAFE_INTEGER,knownAtMs:Number.MAX_SAFE_INTEGER});
  const existing=new Map(prior.map(f=>[f.memoryRef,f]));
  const facts:ExperienceFact[]=[];
  for(const row of rows){
   const observation=store.observation(row.observation_id),ref=row.memoryRef!;
   const old=existing.get(ref);
   if(old){
    if(old.observationId!==row.observation_id||old.text!==row.result.summary||old.rawResultJSON!==JSON.stringify(row.result)||old.availableAtMs!==row.available_at_ms)throw Error('Committed source changed');
    facts.push(old);continue;
   }
   const views=await Promise.all(observation.frames.map(async(path,i)=>({direction:['front','left','right'][i]??`view-${i}`,path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
   facts.push({memoryRef:ref,observationId:observation.id,atMs:observation.atMs,sourceAtMs:observation.sourceAtMs??observation.atMs,availableAtMs:row.available_at_ms,recordingId:observation.recordingId??'source-recording',text:row.result.summary,views,rawResultJSON:JSON.stringify(row.result)});
  }
  facts.sort((a,b)=>a.atMs-b.atMs);
  return memory.synchronize(facts);
 }finally{memory.close();}
}
