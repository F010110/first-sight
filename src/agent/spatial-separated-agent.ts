import {randomUUID} from 'node:crypto';
import type {SpatialObservation} from './incremental-spatial-memory.js';
import type {SpatialLoopMemory} from './spatial-context-loop.js';
import type {ContextJudgment} from './spatial-working-context.js';
import {parseSpatialPerception,parseSpatialIdentityAction,type SpatialPerception,type SpatialReference} from './spatial-separated-protocol.js';

export interface SeparatedSpatialModels {
 perceive(input:{current:{id:string;atMs:number};feedback?:string}):Promise<unknown>;
 identify(input:{current:{id:string;atMs:number};perception:SpatialPerception;references:SpatialReference[];feedback?:string}):Promise<unknown>;
}
export class SeparatedSpatialAgent {
 private previous:{observation:SpatialObservation;judgment:ContextJudgment;segmentId:string}|null=null;
 private anchors=new Map<string,{id:string;atMs:number}>();
 private busy=false;
 constructor(private readonly memory:SpatialLoopMemory,private readonly models:SeparatedSpatialModels){}
 async observe(observation:SpatialObservation){
  if(this.busy)throw Error('Separated spatial agent is busy');this.busy=true;
  try{
   if(this.previous&&observation.atMs<=this.previous.observation.atMs)throw Error('Separated observations must advance monotonically');
   await this.memory.writeObservation(observation);
   const previous=this.previous&&this.previous.observation.recordingId===observation.recordingId&&observation.atMs-this.previous.observation.atMs<=60000?this.previous:null;
   // Explicit projections: no old reason, model output, identity or user question.
   const perception=await this.validated('perception',observation,async feedback=>parseSpatialPerception(await this.models.perceive({current:{id:observation.id,atMs:observation.atMs},...feedback?{feedback}:{}}),observation.id));
   const selected:Array<SpatialReference&{placeId:string|null}>=[];
   if(previous)selected.push({id:previous.observation.id,atMs:previous.observation.atMs,role:'previous',hasIdentity:previous.judgment.placeId!==null,placeId:previous.judgment.placeId});
   const anchor=previous?.judgment.placeId?this.anchors.get(previous.judgment.placeId):null;
   if(anchor&&anchor.id!==previous!.observation.id)selected.push({...anchor,role:'anchor',hasIdentity:true,placeId:previous!.judgment.placeId});
   for(const query of perception.retrievalQueries){
    const hits=await this.memory.search(query,observation.atMs);
    for(const hit of hits){
     if(selected.length>=3)break;
     if(hit.kind==='model-statement'||hit.id.startsWith('model-output:')||hit.atMs>=observation.atMs||!hit.placeId||selected.some(r=>r.id===hit.id||r.placeId===hit.placeId))continue;
     selected.push({id:hit.id,atMs:hit.atMs,role:'retrieved',hasIdentity:true,placeId:hit.placeId});
    }
   }
   if(selected.length){
    const evidence=await this.memory.inspect(selected.map(r=>r.id),observation.atMs);
    if(evidence.length!==selected.length||new Set(evidence.map(e=>e.id)).size!==selected.length||evidence.some(e=>!selected.some(r=>r.id===e.id&&r.atMs===e.atMs&&r.placeId===e.placeId)||e.atMs>=observation.atMs||!e.images?.length||e.kind==='model-statement')||evidence.reduce((n,e)=>n+e.images!.length,0)>9)throw Error('Separated identity references must be causal inspected originals');
   }
   const references=selected.map(({placeId,...reference})=>reference);
   const decision=await this.validated('identity',observation,async feedback=>{
    const decision=parseSpatialIdentityAction(await this.models.identify({current:{id:observation.id,atMs:observation.atMs},perception:structuredClone(perception),references:structuredClone(references),...feedback?{feedback}:{}}),observation.id,references,perception);
    const identity=selected.find(r=>r.id===decision.referenceId)?.placeId;
    const contradiction=identity&&selected.find(r=>r.placeId===identity&&decision.comparisons.find(c=>c.referenceId===r.id)?.relation==='different');
    if(contradiction)throw Error(`Selected identity has a positive layout contradiction at reference ${contradiction.id}; reassess original images or choose unknown, do not ignore the conflict.`);
    return decision;
   });
   const placeId=decision.action==='establish_candidate'?'new':decision.action==='unknown'?null:selected.find(r=>r.id===decision.referenceId)!.placeId;
   const persisted=await this.memory.writeAssessment({observationId:observation.id,atMs:observation.atMs,placeId,reason:`${perception.region}；${perception.layoutEvidence.join('；')}`.slice(0,400),sourceIds:decision.sourceIds});
   if(!persisted)throw Error('Separated memory must return the committed identity');
   const previousSame=previous&&decision.comparisons.some(c=>c.referenceId===previous.observation.id&&c.relation==='same');
   const segmentId=previousSame?previous.segmentId:randomUUID();
   if(persisted.placeId&&!this.anchors.has(persisted.placeId)){this.anchors.set(persisted.placeId,{id:observation.id,atMs:observation.atMs});if(this.anchors.size>8)this.anchors.delete(this.anchors.keys().next().value!);}
   const supportingReferenceIds=selected.filter(r=>persisted.placeId!==null&&r.placeId===persisted.placeId&&decision.comparisons.find(c=>c.referenceId===r.id)?.relation==='same').map(r=>r.id);
   const unconfirmedReferenceIds=selected.filter(r=>persisted.placeId!==null&&r.placeId===persisted.placeId&&decision.comparisons.find(c=>c.referenceId===r.id)?.relation==='uncertain').map(r=>r.id);
   const identitySupport=decision.action==='unknown'?'unresolved':decision.action==='establish_candidate'?'new-candidate':supportingReferenceIds.length>1?'multiple-references':'single-reference';
   const result={observationId:observation.id,atMs:observation.atMs,perception,decision,judgment:persisted,segmentId,identitySupport,supportingReferenceIds,unconfirmedReferenceIds,referenceIds:references.map(r=>r.id),recordingGap:!!this.previous&&!previous,status:'candidate-interpretation-not-ground-truth'};
   await this.memory.writeOutput?.(observation.atMs,{...result,status:'separated-spatial-committed'});
   this.previous={observation:structuredClone(observation),judgment:persisted,segmentId};return result;
  }finally{this.busy=false;}
 }
 private async validated<T>(phase:string,observation:SpatialObservation,operation:(feedback?:string)=>Promise<T>):Promise<T>{
  // Retry protocol errors only. Transport/provider errors stop this run intact.
  let feedback:string|undefined;
  for(let attempt=0;attempt<2;attempt++){
   let value:T;
   try{value=await operation(feedback);}catch(error){
    await this.memory.writeOutput?.(observation.atMs,{status:'separated-stage-failed',phase,attempt,error:String(error)});
    // Model ports expose protocol parse errors and provider errors uniformly;
    // provider failures must never be retried as an unbounded new operation.
    if(error instanceof Error&&error.name==='SpatialProviderError')throw error;
    if(attempt===1)throw error;feedback=String(error);continue;
   }
   return value;
  }
  throw Error('Unreachable separated stage');
 }
}
