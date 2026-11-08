import {Type} from 'typebox';
import type {AgentHarnessTool} from '@earendil-works/pi-agent-core';
import {BatchSpatialMemory} from './batch-memory.js';
import {V3EvidenceTools,toolText,v3Tool} from './evidence-tools-v3.js';
import {createV3Session,type V3Request} from './pi-session-v3.js';
import type {AgentCheckpoint} from './contracts.js';
import {questionSpatialModule} from './question-module-v3.js';
import {recallBatchRevisits} from './batch-revisit.js';
import type {PlaceMatcher} from './revisit-candidates.js';

export type V3Answer={answer:string;sourceIds:string[];temporaryLocation?:string;spatialVersion:number;evidenceRevision:number;knownAtMs:number;sourceAtMs:number|null;checkpoint:AgentCheckpoint};
export async function createV3QuestionAgent(root:string,memory:BatchSpatialMemory,request:V3Request,options:{resume?:boolean;maxTurns?:number;maxContextChars?:number;timeoutMs?:number;matcher?:PlaceMatcher;fastMs?:number}={}){
 const evidence=new V3EvidenceTools(memory,memory.archive);let snapshot:any=null,result:{answer:string;sourceIds:string[];temporaryLocation?:string}|null=null,busy=false;
 let activeSignal:AbortSignal|undefined;
 const revisit=v3Tool('memory_revisit','Read-only broad visual candidate recall for up to three delivered query observations. No identity decision or memory write; inspect candidates before a temporary judgment.',Type.Object({ids:Type.Array(Type.String(),{minItems:1,maxItems:3})}),async a=>{
  if(!snapshot)throw Error('No active question');if(!options.matcher)return {status:'unavailable',reason:'Visual matcher unavailable; browse history instead'};
  if(new Set(a.ids).size!==a.ids.length||a.ids.some((id:string)=>!evidence.delivered.has(id)))throw Error('Recall requires delivered query IDs');
  const rows=memory.archive.byIds(a.ids);if(rows.some(r=>r.archivedAtMs>snapshot.knownAtMs||(r.archivedRevision??0)>snapshot.evidenceRevision||r.observation.atMs>snapshot.sourceAtMs))throw Error('Recall source beyond question cutoff');
  rows.sort((a,b)=>a.observation.atMs-b.observation.atMs);
  const ranges=await recallBatchRevisits(memory,{id:snapshot.requestId,observations:rows.map(r=>({id:r.observation.id,atMs:r.observation.atMs}))},options.matcher,{fastMs:options.fastMs??6000,maxPlaces:100,limit:20,imagesPerPlace:6,version:snapshot.spatialVersion,knownAtMs:snapshot.knownAtMs,audit:false},activeSignal);
  for(const range of ranges)evidence.candidates(range.candidates.map(c=>c.matchedObservationId));return {ranges,candidateOnly:true,spatialWrite:false};
 });
 const finish:AgentHarnessTool<undefined>={name:'memory_answer',label:'memory_answer',description:'Answer using only actually delivered facts or inspected originals. Temporary location is private, never a spatial commit.',replay:'safe',parameters:Type.Object({answer:Type.String({minLength:1,maxLength:8000}),sourceIds:Type.Array(Type.String(),{maxItems:32}),temporaryLocation:Type.Optional(Type.String({maxLength:800}))}),execute:async(_id,args)=>{
  const a=args as any;if(new Set(a.sourceIds).size!==a.sourceIds.length||a.sourceIds.some((id:string)=>!evidence.readFacts.has(id)&&!evidence.inspected.has(id)))throw Error('Answer cited evidence not read or inspected in this question');
  result=structuredClone(a);return {content:toolText({kind:'private-answer',...result}),details:{spatialWrite:false},terminate:true};
 }};
 const role=await createV3Session(root,'visual-question-v3',request,[...evidence.tools(),revisit,finish],()=>{
  if(!snapshot)throw Error('No active question');return {current:{id:snapshot.observations.at(-1)?.id??snapshot.requestId,atMs:snapshot.sourceAtMs??0},runtimeContext:{...snapshot,deliveredIds:[...evidence.delivered],inspectedIds:[...new Set([...evidence.inspected,...evidence.images.map(i=>i.id)])]},images:evidence.images};
 },{...options,prefetch:false,onImagesDelivered:images=>evidence.confirmImages(images)});
 return {
  async ask(question:string,signal?:AbortSignal):Promise<V3Answer>{
   if(!question.trim()||question.length>16000)throw Error('Invalid question');if(busy)throw Error('Question Session busy; no unbounded question queue');busy=true;
   const timeout=AbortSignal.timeout(options.timeoutMs??120000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
   activeSignal=combined;
   try{
    const knownAtMs=Date.now(),evidenceRevision=memory.archive.revision(),latest=memory.archive.latest(knownAtMs,evidenceRevision),state=memory.latest(knownAtMs),version=state?.version??0;
    const current=memory.archive.read(Math.max(0,(latest?.sequence??0)-8),8,knownAtMs,evidenceRevision);
    const module=questionSpatialModule(current,state);
    evidence.reset(version,knownAtMs,latest?.observation.atMs??0,current.map(r=>r.observation.id),evidenceRevision);evidence.readFacts=new Set(module.observations.filter(o=>o.facts).map(o=>o.id));result=null;
    snapshot={requestId:'question:'+crypto.randomUUID(),question,knownAtMs,sourceAtMs:latest?.observation.atMs??null,spatialVersion:version,evidenceRevision,...module,progress:memory.archive.progress(),policy:'Spatial snapshot and current visual evidence are separate Context modules. No spatial write tools. Old private dialogue is not evidence.'};
    const checkpoint=await role.prompt({role:'user-question',question},combined);if(!result)throw Error('Question ended without answer');
    return {...(result as {answer:string;sourceIds:string[];temporaryLocation?:string}),spatialVersion:version,evidenceRevision,knownAtMs,sourceAtMs:snapshot.sourceAtMs,checkpoint};
   }finally{busy=false;activeSignal=undefined;}
  },close:()=>role.close()
 };
}
