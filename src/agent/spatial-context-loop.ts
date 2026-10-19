import type {SpatialObservation} from './incremental-spatial-memory.js';
import {SpatialWorkingContext,type ContextJudgment,type ContextEvidence,type SpatialContextView} from './spatial-working-context.js';

/** Explicit ports keep persistence, inference and retrieval independently testable.
 * Implementations must journal raw calls/failures and make writes idempotent. */
export interface SpatialLoopMemory {
 writeOutput?(atMs:number,value:unknown):Promise<void>;
 writeObservation(observation:SpatialObservation):Promise<void>;
 writeAssessment(assessment:ContextJudgment):Promise<ContextJudgment|void>;
 search(query:string,cutoffMs:number):Promise<ContextEvidence[]>;
 inspect(ids:string[],cutoffMs:number):Promise<Array<ContextEvidence&{images?:Array<{mimeType:string;data:string}>}>>;
}
export interface SpatialLoopDecision {
 assessment:ContextJudgment;
 assessments?:ContextJudgment[];
 next:{kind:'finish'}|{kind:'search';query:string}|{kind:'inspect';ids:string[]}|{kind:'answer';answer:string;sourceIds:string[];abstained:boolean};
}
export type SpatialLoopModel=(input:{context:SpatialContextView;observations:SpatialObservation[];question:string|null;candidates:ContextEvidence[];inspectedIds:string[];evidenceImages:Array<{id:string;mimeType:string;data:string}>;remainingCalls:number;historicalEvidenceRequired:boolean;feedback:string|null})=>Promise<SpatialLoopDecision>;

/** New experimental control loop. No legacy path is silently replaced.
 * Each inference, including retrieval continuations, must assess current space.
 * The callback receives metadata only; an actual VLM adapter must also supply
 * current/inspected image bytes. Never label this interface an image inspection. */
export class SpatialContextLoop {
 readonly context=new SpatialWorkingContext();
 private busy=false;
 constructor(private readonly memory:SpatialLoopMemory,private readonly model:SpatialLoopModel,private readonly maxCalls=6){
  if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>8)throw Error('Invalid inference budget');
 }
 async run(observation:SpatialObservation,question:string|null=null){
  return this.runWindow([observation],question);
 }
 async runWindow(observations:SpatialObservation[],question:string|null=null,requirements:{historicalEvidenceRequired?:boolean}={}){
  if(!observations.length||observations.length>4||new Set(observations.map(o=>o.id)).size!==observations.length||observations.some((o,i)=>i>0&&o.atMs<observations[i-1]!.atMs))throw Error('Invalid observation window');
  const observation=observations[observations.length-1]!;
  if(this.busy)throw Error('Spatial context loop is already running');this.busy=true;
  try{
   // Persistent observation first: failed inference cannot erase the experience.
   for(const item of observations)await this.memory.writeObservation(item);
   this.context.observe(observation);
   let candidates:ContextEvidence[]=[];const allowed=new Set<string>(),inspected=new Set<string>(observations.map(o=>o.id));const evidenceImages:Array<{id:string;mimeType:string;data:string}>=[];
   let feedback:string|null=null;
   for(const entry of [...this.context.view().recent,...this.context.view().anchors])if(entry.atMs<observation.atMs)for(const id of entry.sourceIds)allowed.add(id);
   for(let call=0;call<this.maxCalls;call++){
    const decision=await this.model({context:this.context.view(),observations:structuredClone(observations),question,candidates:structuredClone(candidates),inspectedIds:[...inspected],evidenceImages:structuredClone(evidenceImages),remainingCalls:this.maxCalls-call,historicalEvidenceRequired:requirements.historicalEvidenceRequired??false,feedback});
    // Preserve even rejected structured outputs as model statements, not facts.
    const output={question,decision,status:'unverified-model-output'};await this.memory.writeOutput?.(observation.atMs,output);this.context.recordOutput(observation.atMs,output);
    const assessments=decision.assessments??[decision.assessment];
    if(assessments.length!==observations.length||new Set(assessments.map(a=>a.observationId)).size!==observations.length)throw Error('Every window observation needs exactly one spatial judgment');
    // Observation-only calls have no user action to complete. A missing next
    // means no additional operation, never an invented answer or citation.
    const action=decision.next??(question===null?{kind:'finish' as const}:null);
    if(!action){feedback='Missing next action for an active user question. Return next.kind=search/inspect to obtain evidence, or next.kind=answer with answer, sourceIds and abstained. Spatial judgments alone do not answer the question.';continue;}
    const view=this.context.view();const visiblePlaces=new Set([...view.recent,...view.anchors,...view.retrieved].map(e=>e.placeId));
    const unknownPlaces=[...new Set(assessments.map(a=>a.placeId).filter((id):id is string=>id!==null&&!/^new(?:-[1-9][0-9]*)?$/.test(id)&&!visiblePlaces.has(id)))];
    if(unknownPlaces.length){
     feedback=`Spatial identity rejected: ${JSON.stringify(unknownPlaces)} appears only in old/unverified outputs or is not currently available. Do NOT assign it from those statements. Reassess with placeId=null until verified, then search(query=the exact placeId) and inspect a returned original image to recover its identity. Never replace a missing remembered identity with a new place merely to bypass validation.`;
     const rejected={status:'rejected-spatial-identity',placeIds:unknownPlaces,question};await this.memory.writeOutput?.(observation.atMs,rejected);this.context.recordOutput(observation.atMs,rejected);continue;
    }
    for(const assessment of assessments){const target=observations.find(o=>o.id===assessment.observationId);
    if(!target||assessment.atMs!==target.atMs||!assessment.reason.trim()||!assessment.sourceIds.includes(target.id)||assessment.sourceIds.some(id=>!inspected.has(id)||id.startsWith('model-output:')))throw Error('Spatial assessment requires current and actually delivered evidence');}
    // Commit durable assessment before publishing it in working context.
    for(const target of observations){const assessment=assessments.find(a=>a.observationId===target.id)!;const persisted=await this.memory.writeAssessment(assessment);this.context.commitHistorical(persisted??assessment);}
    if(action.kind==='finish'){if(question!==null)throw Error('Question requires an explicit answer or abstention');return {status:'observed' as const,calls:call+1};}
    if(action.kind==='answer'){
     if(question===null){
      const retained={status:'unsolicited-answer-retained-not-delivered',answer:action};await this.memory.writeOutput?.(observation.atMs,retained);this.context.recordOutput(observation.atMs,retained);
      return {status:'observed' as const,calls:call+1,unsolicitedAnswerRetained:true};
     }
     if(typeof action.answer!=='string'||!action.answer.trim()||typeof action.abstained!=='boolean'||!Array.isArray(action.sourceIds)||action.sourceIds.some(id=>!inspected.has(id))||!action.abstained&&!action.sourceIds.length)throw Error('Invalid answer or uninspected evidence');
     if(requirements.historicalEvidenceRequired&&!action.abstained&&!action.sourceIds.some(id=>!id.startsWith('model-output:')&&!observations.some(o=>o.id===id))){feedback='The question requires a PREVIOUS window image. Every observations ID is in the CURRENT window, not a previous window. Your answer cited only current images or prior statements and is rejected. Inspect an older context source or search then inspect, or explicitly abstain if unavailable. Do not claim a current-window image belongs to a previous window.';const rejected={status:'rejected-source-scope',question,answer:action};await this.memory.writeOutput?.(observation.atMs,rejected);this.context.recordOutput(observation.atMs,rejected);continue;}
     return {status:'answered' as const,calls:call+1,answer:action.answer,sourceIds:action.sourceIds,abstained:action.abstained};
    }
    if(action.kind==='search'){
     if(!action.query.trim()||action.query.length>200)throw Error('Invalid search');
      candidates=(await this.memory.search(action.query,observation.atMs)).filter(e=>!observations.some(o=>o.id===e.id));
     if(candidates.length>16||candidates.some(e=>e.atMs>=observation.atMs))throw Error('Invalid search scope/capacity');
     for(const candidate of candidates)allowed.add(candidate.id);
    }else if(action.kind==='inspect'){
      if(!action.ids.length||action.ids.length>4||action.ids.some(id=>!allowed.has(id))||new Set([...inspected,...action.ids]).size>observations.length+4)throw Error('Inspection requires retrieved IDs within image budget');
     const evidence=await this.memory.inspect(action.ids,observation.atMs);
     if(evidence.length!==new Set(action.ids).size||new Set(evidence.map(e=>e.id)).size!==evidence.length||evidence.some(e=>!action.ids.includes(e.id)||e.atMs>=observation.atMs))throw Error('Inspection returned invalid sources');
     for(const item of evidence){inspected.add(item.id);this.context.retrieve({id:item.id,atMs:item.atMs,reason:item.reason,placeId:item.placeId,...item.kind?{kind:item.kind}:{}},inspected);for(let i=evidenceImages.length-1;i>=0;i--)if(evidenceImages[i]!.id===item.id)evidenceImages.splice(i,1);for(const image of item.images??[])evidenceImages.push({id:item.id,...image});}
    }else throw Error('Unknown control action');
   }
   return {status:'budget-exhausted' as const,calls:this.maxCalls};
  }finally{this.busy=false;}
 }
}
