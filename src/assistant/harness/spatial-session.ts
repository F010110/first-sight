import {mkdir,writeFile,appendFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Type} from 'typebox';
import {AgentHarness,JsonlSessionRepo,BACKGROUND_CONTEXT,getOrThrow,type AgentHarnessTool,type JsonlSessionMetadata} from '@earendil-works/pi-agent-core';
import type {SpatialJsonImage,SpatialJsonRequest} from '../../agent/spatial-json-vlm.js';
import {firstSightSkills} from './skill-registry.js';
import {accountedPiProvider} from './provider-boundary.js';
import {projectSessionContext} from './session-context.js';
import {SpatialContextModule,type SpatialContextVersion} from './layered-context.js';
import type {ThreeAgentStore} from '../three-agent-store.js';
import {projectRecentSourceContext} from './source-context-projection.js';
import {SpatialEvidenceState,type EvidenceFrame} from './spatial-evidence-state.js';

export type SpatialUpdate={summary:string;observations:string[];hypotheses:string[];unresolved:string[];sourceIds:string[]};
export type SpatialCheckpoint={schema:'pi-spatial-checkpoint-v1';observationId:string;atMs:number;index:number;tipId:string;session:JsonlSessionMetadata;contextPath:string;contextSHA256:string;memoryRef:string;update:SpatialUpdate;skillVersions:Record<string,string>};
type Observation={id:string;atMs:number;sourceAtMs?:number;views:SpatialJsonImage[]};
type Request=(input:SpatialJsonRequest)=>Promise<unknown>;

/** One continuous spatial lane. No questions, labels, old extracted facts or answering feedback. */
export async function createSpatialSession(rootArg:string,request:Request,options:{resume?:boolean;diagnosticPerView?:boolean;diagnosticSourceProjection?:boolean;diagnosticEvidenceLedger?:boolean;diagnosticInitialSources?:readonly EvidenceFrame[];diagnosticTaskForObservation?:(id:string)=>string|null}={}){
 if(options.resume&&options.diagnosticEvidenceLedger)throw Error('Evidence-ledger candidate requires an isolated new run, not mixed-version resume');
  const evidenceState=options.diagnosticEvidenceLedger?new SpatialEvidenceState():null;
 if(options.diagnosticInitialSources&&(!evidenceState||options.resume))throw Error('Source-state replay requires a new isolated evidence-ledger session');
 if(options.diagnosticInitialSources)evidenceState!.restoreSources(options.diagnosticInitialSources);
 const root=resolve(rootArg);await mkdir(root,{recursive:true});
 const {env,skills,versions}=await firstSightSkills(),execution=BACKGROUND_CONTEXT;
 const repo=new JsonlSessionRepo({fileSystem:env,sessionsRoot:join(root,'sessions')});
 const prefix:SpatialCheckpoint[]=options.resume?(await readFile(join(root,'checkpoints.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)):[];
 for(const [i,checkpoint] of prefix.entries()){
  if(checkpoint.index!==i+1||checkpoint.memoryRef!==`memory-v${i+1}`||i>0&&checkpoint.atMs<=prefix[i-1]!.atMs||createHash('sha256').update(await readFile(checkpoint.contextPath)).digest('hex')!==checkpoint.contextSHA256)throw Error('Invalid committed spatial prefix');
 }
 if(options.resume&&!prefix.length)throw Error('No committed checkpoint to resume');
 const previous=prefix.at(-1);
 // Fork only a settled observation tip: failed/unknown provider operations remain in the old file.
 const session=previous?await repo.fork(previous.session,{scope:'branch',branch:'space',entryId:previous.tipId,position:'at'},execution):await repo.create({cwd:process.cwd()},execution);
 let current:Observation|null=null,update:SpatialUpdate|null=null,ordinal=0,requests=0,lastAtMs=-1,compactionFailure:string|null=null;
 let currentEvidence:{summary:string;observations:string[]}|null=null;
 const records:Array<{memoryRef:string;observationId:string;atMs:number;text:string}>=[];
 for(const checkpoint of prefix)records.push({memoryRef:checkpoint.memoryRef,observationId:checkpoint.observationId,atMs:checkpoint.atMs,text:JSON.stringify(checkpoint.update)});
  ordinal=prefix.length;lastAtMs=previous?.atMs??-1;
 if(options.diagnosticInitialSources?.length){
  for(const frame of options.diagnosticInitialSources)records.push({memoryRef:frame.memoryRef,observationId:frame.observationId,atMs:frame.atMs,text:JSON.stringify({summary:frame.summary,observations:frame.observations,hypotheses:[],unresolved:[],sourceIds:[frame.observationId]})});
  ordinal=records.length;lastAtMs=records.at(-1)!.atMs;
  await writeFile(join(root,'source-state-replay.json'),JSON.stringify({schema:'source-state-replay-v1',sources:options.diagnosticInitialSources,scope:'Frozen source plane only; fresh Pi operation history, not exact harness/session continuation'},null,2),{flag:'wx'});
 }
 const contextModule=new SpatialContextModule();if(previous)contextModule.publish(previous);
 const provider=accountedPiProvider({request,singleToolArguments:true,view:()=>{if(!current||!currentEvidence)throw Error('No independently inspected observation bound');return {current:{id:current.id,atMs:current.atMs},runtimeContext:{mode:'spatial-observation',clock:{field:'atMs',unit:'milliseconds'},captureGeometry:{simultaneous:true,coLocated:true,relativeDirections:current.views.map(v=>v.direction)},currentEvidence:{...currentEvidence,sourceIds:[current.id],scope:'Independent model interpretation of current images, immutable within this update; not human truth'},evidenceState:evidenceState?.context()??null,diagnosticTask:options.diagnosticTaskForObservation?.(current.id)??null,committedObservations:ordinal,lastCommittedMs:lastAtMs},images:[]};},onRequest:()=>{if(compactionFailure)throw Error('Spatial compaction failed closed: '+compactionFailure);if(++requests>12000)throw Error('Spatial replay runaway guard');}});
 const strings=(n:number)=>Type.Array(Type.String({maxLength:500}),{maxItems:n});
 const tool:AgentHarnessTool<undefined>={name:'record_context',label:'Record spatial context',description:'Commit current source observations. Optional interpretations do not rewrite source facts.',parameters:evidenceState?Type.Object({},{additionalProperties:false}):Type.Object({summary:Type.String({minLength:1,maxLength:1600}),hypotheses:strings(8),unresolved:strings(8),sourceIds:Type.Array(Type.String(),{minItems:1,maxItems:1,uniqueItems:true})}),execute:async(_id,raw)=>{
  if(evidenceState){
   const state=evidenceState.context(),frame=state.currentObservation;
   update={summary:frame.summary,observations:frame.observations,hypotheses:[],unresolved:[],sourceIds:[frame.observationId]};
   return {content:[{type:'text',text:JSON.stringify({committed:true,memoryRef:frame.memoryRef,observationId:frame.observationId,atMs:frame.atMs,update,interpretations:state.currentInterpretations})}],details:{},terminate:true};
  }
  const args=raw as SpatialUpdate;
  if(!current||!currentEvidence||args.sourceIds.some(id=>id!==current!.id))throw Error('Only this observation original source ID is valid');
  const value:SpatialUpdate={summary:args.summary,observations:[...currentEvidence.observations],hypotheses:args.hypotheses,unresolved:args.unresolved,sourceIds:args.sourceIds};
  update=value;
  return {content:[{type:'text',text:JSON.stringify({committed:true,memoryRef:`memory-v${ordinal+1}`,observationId:current.id,atMs:current.atMs,update:value,interpretation:'Source-backed model interpretation, not certified truth'})}],details:{},terminate:true};
 }};
 const tools:AgentHarnessTool<undefined>[]=[tool];
 if(evidenceState){
  tools.push({name:'propose_interpretation',label:'Store tentative interpretation',description:'Optional source-backed interpretation, never an observation or assigned place identity.',parameters:Type.Object({text:Type.String({minLength:1,maxLength:800}),evidenceRefs:Type.Array(Type.String(),{minItems:1,maxItems:8,uniqueItems:true})}),execute:async(_id,raw)=>{const args=raw as {text:string;evidenceRefs:string[]};return {content:[{type:'text',text:JSON.stringify(evidenceState.propose(args.text,args.evidenceRefs))}],details:{}};}});
  const time={afterMs:Type.Optional(Type.Number({minimum:0})),beforeMs:Type.Optional(Type.Number({minimum:0}))},cursor=Type.Optional(Type.Integer({minimum:0}));
  const definitions=[
   ['timeline',{...time,cursor}],
   ['find',{...time,cursor,terms:Type.Array(Type.String(),{minItems:1,maxItems:6}),match:Type.Optional(Type.Union([Type.Literal('any'),Type.Literal('all')]))}],
   ['read',{...time,cursor}],
   ['around',{memoryRef:Type.String(),before:Type.Optional(Type.Integer({minimum:0,maximum:12})),after:Type.Optional(Type.Integer({minimum:0,maximum:12}))}],
   ['recall',{memoryRefs:Type.Array(Type.String(),{minItems:1,maxItems:12})}],
   ['coverage',time]
  ] as const;
  for(const [op,properties] of definitions)tools.push({name:`memory_${op}`,label:`Memory ${op}`,description:`Mechanical ${op} over committed source observations, not semantic target resolution.`,parameters:Type.Object(properties,{additionalProperties:false}),execute:async(_id,args)=>({content:[{type:'text',text:JSON.stringify(await evidenceState.recall({op,...args as object}))}],details:{}})});
 }
 const skillName=evidenceState?'spatial-evidence-ledger':'spatial-memory';
 const {harness,open}=await AgentHarness.create({session,...provider,tools,resources:{skills:skills.filter(s=>s.name===skillName)},systemPrompt:()=>skills.find(s=>s.name===skillName)!.content+'\n'+(current?options.diagnosticTaskForObservation?.(current.id)??'':''),compaction:{enabled:true,reserveTokens:32000,keepRecentTokens:12000},retry:{enabled:false,maxRetries:0,baseDelayMs:0}},execution);
 if(open.length)throw Error('Unexpected open operation');
 const lane=await harness.lane('space',execution);
 if(evidenceState)harness.hooks.on('transform_context',event=>{
  // Preserve the current operation's real tool call/result pairs, not prior scenes' generations.
  let start=-1;
  for(let i=event.messages.length-1;i>=0;i--){const message=event.messages[i]!;if(message.role!=='user')continue;const text=typeof message.content==='string'?message.content:message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');try{if(JSON.parse(text).observationId===current?.id){start=i;break;}}catch{}}
  return {messages:start<0?[]:event.messages.slice(start)};
 });
 else if(options.diagnosticSourceProjection)harness.hooks.on('transform_context',event=>({messages:projectRecentSourceContext(event.messages,current?.atMs??lastAtMs)}));
 if(evidenceState)harness.hooks.on('after_tool',event=>{evidenceState.setToolError(event.isError?{toolName:event.toolName,content:event.content}:null);return undefined;});
  harness.hooks.on('before_compaction',async event=>{
   try{
  if(!current)throw Error('Compaction without observation');
  const response=await request({phase:'identity',prompt:skills.find(s=>s.name==='context-compaction')!.content,data:{current:{id:current.id,atMs:current.atMs},role:'spatial-compaction',originalQuestion:null,task:'continuous-spatial-memory',previousSummary:event.preparation.previousSummary,messages:event.preparation.messagesToSummarize,retainedMessageCount:event.preparation.retainedTail.length,knownMemoryRefs:records.map(r=>r.memoryRef)},images:[],textOnlyIdentity:true,includeUsage:true}) as any;
  const result=response.output??response;
  // The skill's 1000-character target controls compression quality, not an exact
  // wire contract. Accept complete bounded outputs; never truncate or repair them.
  if(typeof result.summary!=='string'||!result.summary.trim()||result.summary.length>4000||!Array.isArray(result.memoryRefs)||result.memoryRefs.length>12||result.memoryRefs.some((ref:string)=>!records.some(r=>r.memoryRef===ref)))throw Error('Invalid spatial compaction; previous context retained');
  return {compaction:{summary:result.summary,retainedTail:event.preparation.retainedTail,tokensBefore:event.preparation.tokensBefore,details:{sourceRefs:result.memoryRefs,semanticCoverageCertified:false}}};
   }catch(error){compactionFailure=String(error);await appendFile(join(root,'compaction-failures.jsonl'),JSON.stringify({atMs:current?.atMs,committed:ordinal,error:compactionFailure,fallbackSent:false})+'\n');return {decline:true};}
 });
  await writeFile(join(root,previous?`resume-session-${ordinal+1}-${session.metadata.id}.json`:'session.json'),JSON.stringify(session.metadata,null,2),{flag:'wx'});
  if(previous)await appendFile(join(root,'resume-events.jsonl'),JSON.stringify({fromIndex:ordinal,fromTipId:previous.tipId,parentSession:previous.session,session:session.metadata,skillVersions:versions})+'\n');
  return {
   async compact(){const result=getOrThrow(await lane.compact(undefined,execution));if(compactionFailure)throw Error(compactionFailure);return result;},
   contextModule,
   snapshotAt(checkpoint:SpatialContextVersion):ReturnType<ThreeAgentStore['snapshot']>{
    if(!records.some(r=>r.memoryRef===checkpoint.memoryRef&&r.observationId===checkpoint.observationId&&r.atMs===checkpoint.atMs))throw Error('Unknown spatial context version');
    return {asOfMs:checkpoint.atMs,version:checkpoint.index,pendingMemory:0,evidence:[],results:records.filter(r=>r.atMs<=checkpoint.atMs).map(r=>({lane:'memory',observation_id:r.observationId,source_at_ms:r.atMs,evidence_until_ms:r.atMs,available_at_ms:r.atMs,memoryRef:r.memoryRef,result:{summary:r.text}}))} as unknown as ReturnType<ThreeAgentStore['snapshot']>;
   },
  async inspect(row:Observation):Promise<{summary:string;observations:string[]}>{
   if(!row.views.length||row.views.some(v=>v.id!==row.id))throw Error('Expected source-bound observation views');
   const batches=options.diagnosticPerView?row.views.map(view=>[view]):[row.views],parts:{summary:string;observations:string[]}[]=[];
   for(const images of batches){
    const response=await request({phase:'perception',prompt:skills.find(s=>s.name==='current-visual-evidence')!.content,data:{current:{id:row.id,atMs:row.atMs}},images,includeUsage:true}) as any;
    const evidence=response.output??response;
    if(typeof evidence.summary!=='string'||!evidence.summary.trim()||evidence.summary.length>1200||!Array.isArray(evidence.observations)||!evidence.observations.length||evidence.observations.length>12||evidence.observations.some((s:unknown)=>typeof s!=='string'||!s.trim()||s.length>500))throw Error('Invalid independent visual evidence');
    parts.push({summary:evidence.summary,observations:options.diagnosticPerView?evidence.observations.map((s:string)=>`[${images[0]!.direction}] ${s}`):[...evidence.observations]});
   }
   return {summary:parts.map(p=>p.summary).join('\n'),observations:parts.flatMap(p=>p.observations)};
  },
  async observe(row:Observation,precomputed?:{summary:string;observations:string[]}):Promise<SpatialCheckpoint>{
   if(row.atMs<=lastAtMs||!row.views.length||row.views.some(v=>v.id!==row.id))throw Error('Expected strictly chronological source-bound observations');
   current=row;update=null;currentEvidence=precomputed??await this.inspect(row);
   if(evidenceState)evidenceState.begin({memoryRef:`memory-v${ordinal+1}`,observationId:row.id,atMs:row.atMs,...currentEvidence});
   const outcome=getOrThrow(await lane.prompt(JSON.stringify({observationId:row.id,atMs:row.atMs}),undefined,execution));
   if(outcome.status!=='completed'||!update)throw Error('Spatial update failed: '+JSON.stringify(outcome));
   const value=update as SpatialUpdate;ordinal++;lastAtMs=row.atMs;
   records.push({memoryRef:`memory-v${ordinal}`,observationId:row.id,atMs:row.atMs,text:JSON.stringify(value)});
   const committed=evidenceState?.commit();
   if(committed)await appendFile(join(root,'interpretations.jsonl'),JSON.stringify({atMs:row.atMs,memoryRef:committed.frame.memoryRef,interpretations:committed.interpretations})+'\n');
   const context=committed?[{role:'user',timestamp:Date.now(),content:JSON.stringify({kind:'spatial-evidence-context',currentObservation:committed.frame,sourceObservations:evidenceState!.publishedSources(),interpretations:committed.interpretations})}]:projectSessionContext(await lane.findEntries(undefined,execution));
   const contextPath=join(root,'contexts',String(ordinal).padStart(4,'0')+'.json');await mkdir(join(root,'contexts'),{recursive:true});
   const body=JSON.stringify({schema:'pi-spatial-context-v1',observationId:row.id,atMs:row.atMs,systemSkill:skillName,skillVersions:versions,...committed?{sourceObservations:evidenceState!.publishedSources(),interpretations:committed.interpretations}:{},messages:context},null,2);
   await writeFile(contextPath,body,{flag:'wx'});
   const checkpoint:SpatialCheckpoint={schema:'pi-spatial-checkpoint-v1',observationId:row.id,atMs:row.atMs,index:ordinal,tipId:(await lane.getTipId(execution))!,session:session.metadata,contextPath,contextSHA256:createHash('sha256').update(body).digest('hex'),memoryRef:`memory-v${ordinal}`,update:value,skillVersions:versions};
   await appendFile(join(root,'checkpoints.jsonl'),JSON.stringify(checkpoint)+'\n');
    await appendFile(join(root,'facts.jsonl'),JSON.stringify(records.at(-1))+'\n');
    contextModule.publish(checkpoint);
   return checkpoint;
  },
  async close(){await harness.close(execution);await repo.close(execution);}
 };
}
