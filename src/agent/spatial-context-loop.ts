import type {SpatialObservation} from './incremental-spatial-memory.js';
import {SpatialWorkingContext,type ContextJudgment,type ContextEvidence,type SpatialContextView} from './spatial-working-context.js';

/** Explicit ports keep persistence, inference and retrieval independently testable.
 * Implementations must journal raw calls/failures and make writes idempotent. */
export interface SpatialLoopMemory {
 restore?(cutoffMs:number):Promise<Array<{observation:SpatialObservation;assessment:ContextJudgment}>>;
 writeObservation(observation:SpatialObservation):Promise<void>;
 writeAssessment(assessment:ContextJudgment):Promise<ContextJudgment|void>;
 search(query:string,cutoffMs:number):Promise<ContextEvidence[]>;
 inspect(ids:string[],cutoffMs:number):Promise<Array<ContextEvidence&{images?:Array<{mimeType:string;data:string}>}>>;
}
export interface SpatialLoopDecision {
 assessment:ContextJudgment;
 next:{kind:'finish'}|{kind:'search';query:string}|{kind:'inspect';ids:string[]}|{kind:'answer';answer:string;sourceIds:string[];abstained:boolean};
}
export type SpatialLoopModel=(input:{context:SpatialContextView;question:string|null;candidates:ContextEvidence[];inspectedIds:string[];evidenceImages:Array<{id:string;mimeType:string;data:string}>;remainingCalls:number})=>Promise<SpatialLoopDecision>;

/** New experimental control loop. No legacy path is silently replaced.
 * Each inference, including retrieval continuations, must assess current space.
 * The callback receives metadata only; an actual VLM adapter must also supply
 * current/inspected image bytes. Never label this interface an image inspection. */
export class SpatialContextLoop {
 readonly context=new SpatialWorkingContext();
 private busy=false;
 private initialized=false;
 constructor(private readonly memory:SpatialLoopMemory,private readonly model:SpatialLoopModel,private readonly maxCalls=6){
  if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>8)throw Error('Invalid inference budget');
 }
 async run(observation:SpatialObservation,question:string|null=null){
  if(this.busy)throw Error('Spatial context loop is already running');this.busy=true;
  try{
   if(!this.initialized){for(const entry of await this.memory.restore?.(observation.atMs)??[]){this.context.observe(entry.observation);this.context.commit(entry.assessment);}this.initialized=true;}
   // Persistent observation first: failed inference cannot erase the experience.
   await this.memory.writeObservation(observation);this.context.observe(observation);
   let candidates:ContextEvidence[]=[];const allowed=new Set<string>(),inspected=new Set<string>([observation.id]);const evidenceImages:Array<{id:string;mimeType:string;data:string}>=[];
   for(const entry of [...this.context.view().recent,...this.context.view().anchors])if(entry.atMs<observation.atMs)for(const id of entry.sourceIds)allowed.add(id);
   for(let call=0;call<this.maxCalls;call++){
    const decision=await this.model({context:this.context.view(),question,candidates:structuredClone(candidates),inspectedIds:[...inspected],evidenceImages:structuredClone(evidenceImages),remainingCalls:this.maxCalls-call});
    const assessment=decision.assessment;
    const view=this.context.view();const visiblePlaces=new Set([...view.recent,...view.anchors,...view.retrieved].map(e=>e.placeId));
    if(assessment.placeId!==null&&assessment.placeId!=='new'&&!visiblePlaces.has(assessment.placeId))throw Error('Spatial identity not present in working context or inspected evidence');
    if(assessment.observationId!==observation.id||assessment.atMs!==observation.atMs||!assessment.reason.trim()||!assessment.sourceIds.includes(observation.id)||assessment.sourceIds.some(id=>!inspected.has(id)))throw Error('Spatial assessment requires current and actually delivered evidence');
    // Commit durable assessment before publishing it in working context.
    const persisted=await this.memory.writeAssessment(assessment);this.context.commit(persisted??assessment);
    const action=decision.next;
    if(action.kind==='finish'){if(question!==null)throw Error('Question requires an explicit answer or abstention');return {status:'observed' as const,calls:call+1};}
    if(action.kind==='answer'){
     if(question===null||!action.answer.trim()||!Array.isArray(action.sourceIds)||action.sourceIds.some(id=>!inspected.has(id))||!action.abstained&&!action.sourceIds.length)throw Error('Invalid answer or uninspected evidence');
     return {status:'answered' as const,calls:call+1,answer:action.answer,sourceIds:action.sourceIds,abstained:action.abstained};
    }
    if(action.kind==='search'){
     if(!action.query.trim()||action.query.length>200)throw Error('Invalid search');
     candidates=await this.memory.search(action.query,observation.atMs);
     if(candidates.length>16||candidates.some(e=>e.atMs>=observation.atMs))throw Error('Invalid search scope/capacity');
     for(const candidate of candidates)allowed.add(candidate.id);
    }else if(action.kind==='inspect'){
     if(!action.ids.length||action.ids.length>4||action.ids.some(id=>!allowed.has(id))||new Set([...inspected,...action.ids]).size>5)throw Error('Inspection requires retrieved IDs within image budget');
     const evidence=await this.memory.inspect(action.ids,observation.atMs);
     if(evidence.length!==new Set(action.ids).size||new Set(evidence.map(e=>e.id)).size!==evidence.length||evidence.some(e=>!action.ids.includes(e.id)||e.atMs>=observation.atMs))throw Error('Inspection returned invalid sources');
     for(const item of evidence){inspected.add(item.id);this.context.retrieve({id:item.id,atMs:item.atMs,reason:item.reason,placeId:item.placeId},inspected);for(const image of item.images??[])evidenceImages.push({id:item.id,...image});}
    }else throw Error('Unknown control action');
   }
   return {status:'budget-exhausted' as const,calls:this.maxCalls};
  }finally{this.busy=false;}
 }
}
