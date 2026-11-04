import {mkdir,appendFile,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {Type} from 'typebox';
import {AgentHarness,JsonlSessionRepo,BACKGROUND_CONTEXT,getOrThrow,type AgentHarnessTool} from '@earendil-works/pi-agent-core';
import {firstSightSkills} from '../harness/skill-registry.js';
import {accountedPiProvider} from '../harness/provider-boundary.js';
import type {SpatialJsonImage,SpatialJsonRequest} from '../../agent/spatial-json-vlm.js';
import {validateAssessment,type Assessment,type JudgeInput,type SpatialReasoner,type HistoryRecord,type StoredState} from './contracts.js';
import {spatialStateHead} from './context-projection.js';
import {requireDeliveredIds} from './source-access.js';
import {digest,commitResult,sessionBranch,verifiedCommitEntry,verifyCommitMemo} from './pi-checkpoint.js';

const skillName='spatial-memory-v2';
const asText=(value:unknown)=>[{type:'text' as const,text:JSON.stringify(value)}];
const strings=(max:number)=>Type.Array(Type.String({maxLength:1200}),{maxItems:max});
type Invocation=Parameters<AgentHarnessTool<undefined>['execute']>[4];

/**
 * Pi execution shell for the spatial agent. The application still owns the
 * explicit working context, tool authorization, durable SQLite commit and
 * skill versioning; Pi supplies the session, tool loop and compaction.
 */
export async function createPiSpatialReasoner(rootArg:string,request:(r:SpatialJsonRequest)=>Promise<unknown>,options:{maxRequests?:number;resume?:boolean;maxContextChars?:number;keepRecentTokens?:number}={}):Promise<SpatialReasoner>{
  const root=resolve(rootArg);await mkdir(root,{recursive:true});
  const contextPolicy={version:'spatial-session-context-v1',maxChars:options.maxContextChars??48000,keepRecentTokens:options.keepRecentTokens??2000};
  if(!Number.isInteger(contextPolicy.maxChars)||contextPolicy.maxChars<1000||!Number.isInteger(contextPolicy.keepRecentTokens)||contextPolicy.keepRecentTokens<1)throw Error('Invalid spatial session context budget');
  let recoveredContextChars=0;
 const {env,skills,versions}=await firstSightSkills(),skill=skills.find(s=>s.name===skillName);
 if(!skill)throw Error('Missing '+skillName+' skill');
 const repo=new JsonlSessionRepo({fileSystem:env,sessionsRoot:join(root,'sessions')});
 let session;
 if(options.resume){
  // Recovery never silently creates a replacement Session or changes skills.
  const metadata=JSON.parse(await readFile(join(root,'session.json'),'utf8'));
  try{
   const checkpoints=(await readFile(join(root,'pi-checkpoints.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    for(const checkpoint of checkpoints){if(checkpoint.session?.id!==metadata.id)throw Error('Pi recovery Session mismatch');if(JSON.stringify(checkpoint.contextPolicy)!==JSON.stringify(contextPolicy))throw Error('Pi recovery context policy mismatch');for(const name of [skillName,'context-compaction'])if(checkpoint.skillVersions?.[name]!==versions[name])throw Error('Pi recovery skill version mismatch: '+name);}
    recoveredContextChars=checkpoints.at(-1)?.contextChars??0;
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  session=await repo.open(metadata,BACKGROUND_CONTEXT);
 }else session=await repo.create({cwd:process.cwd()},BACKGROUND_CONTEXT);
  let current:JudgeInput|null=null,delivered=new Map<string,HistoryRecord>(),inspected=new Set<string>(),images:SpatialJsonImage[]=[],lastToolResult:unknown=null,committed:StoredState|null=null,requests=0,turnRequests=0,compactionFailure:string|null=null,contextChars=recoveredContextChars;
  let recovering=false;const recoveryStates=new Map<number,StoredState>();
 const provider=accountedPiProvider({request,singleToolArguments:false,view:()=>{
  if(!current)throw Error('No active spatial judgment');
   return {current:{id:current.row.id,atMs:current.row.atMs},runtimeContext:{mode:'spatial-memory-v2',currentObservation:{id:current.row.id,atMs:current.row.atMs},...current.window?{window:current.window}:{facts:current.facts},previousRegion:current.previousRegion,revisit:current.revisit??null,workingContext:spatialStateHead(current.context),deliveredIds:[...delivered.keys()],inspectedIds:[...inspected],lastToolResult,feedback:current.feedback??null},images,...current.window?{windowSources:current.window.observations.filter(o=>images.some(v=>v.id===o.id)).map(o=>({id:o.id,atMs:o.atMs}))}:{}};
  },onRequest:()=>{if(recovering)throw Error('Checkpoint recovery is forbidden from invoking a model');if(compactionFailure)throw Error('Spatial compaction failed closed: '+compactionFailure);if(++turnRequests>8||++requests>(options.maxRequests??8000))throw Error('Spatial Pi request guard exhausted');}});
 const requireCurrent=()=>{if(!current)throw Error('No active spatial judgment');return current;};
 const deliver=(record:HistoryRecord)=>{delivered.set(record.observationId,record);for(const member of record.window?.observations??[])delivered.set(member.id,record);};
  const checkDelivered=(ids:unknown,max:number,tool:string)=>requireDeliveredIds(ids,max,new Set(delivered.keys()),tool);
  const tool=(name:string,description:string,parameters:any,run:(a:any,invocation:Invocation)=>Promise<any>):AgentHarnessTool<undefined>=>({name,label:name,description,replay:name==='memory_add'?'safe':'never',parameters:Type.Object({...parameters.properties,assessment:parameters.properties.assessment??Type.Unknown()}),execute:async(_id,args,_update,_context,invocation)=>{
   if(recovering&&name==='memory_add'){
    const memo=await invocation.getMemo('spatial-commit') as any,state=recoveryStates.get(memo?.version);if(!state)throw Error('No durable state for pending Pi effect');
    const a=args as any;verifyCommitMemo(memo,state,{...a.assessment,memoryNotes:a.notes??[],...a.rename?{placeRename:a.rename}:{}},session.metadata.id);
    return {content:asText(commitResult(state)),details:{recoveredFromSQLite:true},terminate:true};
   }
  const input=requireCurrent(),a=args as any;
   if(name!=='memory_add'){
   const assessment=validateAssessment(a.assessment,input.row.id,inspected);
     if(assessment.relations.length||assessment.revisions?.length||assessment.placeUpdates?.length||assessment.memoryNotes?.length||assessment.placeRename)throw Error('Interim assessment cannot commit relations/revisions/place updates/notes/rename');
   input.evaluate?.(assessment,{inspected,delivered:new Set(delivered.keys())});input.context.location=assessment.location;
  }
   const result=await run(a,invocation);return {content:asText(result),details:{},...(result&&typeof result==='object'&&result.terminate===true?{terminate:true}:{})};}});
 const timeline=tool('memory_timeline','Paginated committed history previews; previews are navigation, not proof.',Type.Object({afterMs:Type.Optional(Type.Number({minimum:0})),beforeMs:Type.Optional(Type.Number({minimum:0})),cursor:Type.Optional(Type.Integer({minimum:0}))}),async a=>{
  const input=requireCurrent(),after=a.afterMs??0,before=a.beforeMs??input.row.atMs,cursor=a.cursor??0;
  if(!Number.isFinite(after)||!Number.isFinite(before)||after<0||before<after||before>input.row.atMs||!Number.isInteger(cursor)||cursor<0)throw Error('Invalid causal timeline range');
  const range=input.history.filter(r=>r.atMs>=after&&r.atMs<=before),page=range.slice(cursor,cursor+24);
  for(const r of page)deliver(r);
  lastToolResult={kind:'timeline',records:page.map(r=>({observationId:r.observationId,atMs:r.atMs,location:r.location,windowMemberIds:r.window?.observations.map(o=>o.id),preview:r.facts?.summary.slice(0,240)??null})),nextCursor:cursor+page.length<range.length?cursor+page.length:null,total:range.length,note:'Previews are not full text; null facts mean missing evidence, not absence; member IDs reference window evidence, not per-frame locations'};
  return lastToolResult;
 });
 const find=tool('memory_find','Literal candidate hints only; not a target resolver and not exhaustive.',Type.Object({terms:Type.Array(Type.String({maxLength:80}),{minItems:1,maxItems:6})}),async a=>{
  const input=requireCurrent(),terms=(a.terms as string[]).map(t=>t.toLowerCase()),hits=input.history.filter(r=>terms.some(t=>JSON.stringify(r).toLowerCase().includes(t))),page=hits.slice(0,12);
  for(const r of page)deliver(r);
  lastToolResult={kind:'find',records:page.map(r=>({observationId:r.observationId,atMs:r.atMs,location:r.location,windowMemberIds:r.window?.observations.map(o=>o.id),preview:r.facts?.summary.slice(0,240)??null})),total:hits.length,candidateOnly:true,exhaustive:false};
  return lastToolResult;
 });
 const read=tool('memory_read','Read full facts for previously delivered records.',Type.Object({ids:Type.Array(Type.String(),{minItems:1,maxItems:12})}),async a=>{
   const ids=checkDelivered(a.ids,12,'memory_read'),records=ids.map(id=>delivered.get(id)!);
  lastToolResult={kind:'read',requestedSourceIds:ids,records,note:'Member source IDs return their containing window record, not a per-frame position'};return lastToolResult;
 });
 const inspect=tool('memory_inspect','Inspect original historical images for previously delivered records; max three.',Type.Object({ids:Type.Array(Type.String(),{minItems:1,maxItems:3})}),async a=>{
   const input=requireCurrent(),ids=checkDelivered(a.ids,3,'memory_inspect'),originals=await input.inspect(ids);
  images=[...input.row.views,...originals];
  const currentWindowIds=input.window?.observations.map(o=>o.id)??[input.row.id];
   inspected=new Set([...currentWindowIds,...ids]);
  lastToolResult={kind:'inspect',requestedSourceIds:ids,records:ids.map(id=>delivered.get(id)!),imageCount:originals.length,note:'Current-window member IDs remain valid evidence for this window; earlier historical images not inspected now are no longer citable. Not a new spatial judgment'};
  return lastToolResult;
 });
   const place=tool('memory_place','Read a place organized as visits -> chronological windows -> full source facts, plus notes and attribute revisions. Page using nextCursor/nextNoteCursor. Reading text delivers sources for memory_inspect, not proof that images were checked.',Type.Object({placeId:Type.String({minLength:1,maxLength:120}),cursor:Type.Optional(Type.Integer({minimum:0})),noteCursor:Type.Optional(Type.Integer({minimum:0}))}),async a=>{
   const input=requireCurrent();if(!input.readPlace)throw Error('Place profiles unavailable');
    const profile=input.readPlace(a.placeId,a.cursor,a.noteCursor) as {visits?:Array<{windows:HistoryRecord[]}>}|null;
    for(const visit of profile?.visits??[])for(const record of visit.windows)deliver(record);
    lastToolResult={kind:'place-profile',profile};return lastToolResult;
  });
  const skippedSources=tool('memory_skipped_sources','Read facts or inspect up to three skipped sources already referenced by current or committed windows. No location was assigned to these sources.',Type.Object({ids:Type.Array(Type.String(),{minItems:1,maxItems:3}),inspect:Type.Optional(Type.Boolean())}),async a=>{
   const input=requireCurrent(),sources=[...(input.window?.skippedBefore??[]),...input.history.flatMap(r=>r.window?.skippedBefore??[])].flatMap(w=>w.observations);
   if(new Set(a.ids).size!==a.ids.length)throw Error('Duplicate skipped source IDs');
   const records=(a.ids as string[]).map(id=>{const source=sources.find(s=>s.id===id);if(!source)throw Error('Skipped source not delivered by causal windows');return source;});
   if(a.inspect){const originals=await input.inspect(a.ids);images=[...input.row.views,...originals];if(images.length>12)throw Error('Inspection image limit');const currentWindowIds=input.window?.observations.map(o=>o.id)??[input.row.id];inspected=new Set([...currentWindowIds,...a.ids]);}
   lastToolResult={kind:'skipped-sources',records,spatialJudgmentAvailable:false,originalsInspected:a.inspect===true};return lastToolResult;
  });
  const revisionLocation=Type.Object({status:Type.Union([Type.Literal('known'),Type.Literal('unknown')]),placeId:Type.Union([Type.String(),Type.Null()]),name:Type.String({maxLength:240}),reason:Type.String({minLength:1,maxLength:1600}),sourceIds:Type.Array(Type.String(),{minItems:1,maxItems:12}),contextRefs:Type.Optional(Type.Array(Type.String(),{maxItems:10}))});
 const assessmentSchema=Type.Object({
  location:Type.Object({status:Type.Union([Type.Literal('new'),Type.Literal('known'),Type.Literal('unknown')]),placeId:Type.Union([Type.String(),Type.Null()]),name:Type.String({maxLength:240}),reason:Type.String({minLength:1,maxLength:1600}),sourceIds:Type.Array(Type.String(),{minItems:1,maxItems:12}),contextRefs:Type.Optional(Type.Array(Type.String(),{maxItems:10})),boundary:Type.Optional(Type.Object({regions:Type.Array(Type.String({maxLength:240}),{minItems:2,maxItems:2})})),regionChangeEvidence:Type.Optional(Type.Array(Type.String({minLength:1,maxLength:400}),{maxItems:4})),continuityCandidate:Type.Optional(Type.Object({placeId:Type.String(),referenceId:Type.String(),reason:Type.String({minLength:1,maxLength:400})}))}),
   hypotheses:strings(8),unresolved:strings(8),
   placeUpdates:Type.Optional(Type.Array(Type.Object({key:Type.String({minLength:1,maxLength:120}),value:Type.String({minLength:1,maxLength:1200}),status:Type.Union([Type.Literal('asserted'),Type.Literal('uncertain'),Type.Literal('retracted')]),reason:Type.String({minLength:1,maxLength:800}),sourceIds:Type.Array(Type.String(),{minItems:1,maxItems:12})}),{maxItems:8})),
  relations:Type.Array(Type.Object({kind:Type.Union([Type.Literal('same-facility'),Type.Literal('different-region')]),referenceId:Type.String(),reason:Type.String({minLength:1,maxLength:1200}),sourceIds:Type.Array(Type.String(),{minItems:2,maxItems:8})}),{maxItems:8}),
  revisions:Type.Optional(Type.Array(Type.Object({observationId:Type.String(),location:revisionLocation}),{maxItems:3}))
 });
  const record=tool('memory_add','Atomically add a complete-window assessment and sourced notes. The database manages place/visit/IDs. Optional rename:{name,reason,sourceIds} updates the name of a confirmed known place without changing its identity or past records; match location.name and include current source. Do not rename on unknown/boundary/new. A persistent place may cover continuous station interior; use an accurate evolving name. A visible old landmark does not establish current occupancy. Never copy historical features into current reasons.',Type.Object({assessment:assessmentSchema,notes:Type.Optional(Type.Array(Type.Object({text:Type.String({minLength:1,maxLength:800}),sourceIds:Type.Array(Type.String(),{minItems:1,maxItems:12})}),{maxItems:6})),rename:Type.Optional(Type.Object({name:Type.String({minLength:1,maxLength:240}),reason:Type.String({minLength:1,maxLength:800}),sourceIds:Type.Array(Type.String(),{minItems:1,maxItems:12})}))}),async(a,invocation)=>{
   const input=requireCurrent(),assessment=validateAssessment({...a.assessment,memoryNotes:a.notes??[],...a.rename?{placeRename:a.rename}:{}} as Assessment,input.row.id,inspected);
   // A changed scene is not a new place until recalled older places are checked.
   // Perform that check on the agent's first NEW attempt and return the images;
   // this avoids relying on the model to remember a separate inspect call, while
   // still leaving identity entirely to the next judgment.
   const unchecked=assessment.location.status==='new'?(input.revisit?.candidates??[]).filter(c=>!inspected.has(c.matchedObservationId)):[];
   if(unchecked.length){
    const ids=unchecked.map(c=>c.matchedObservationId),originals=await input.inspect(ids);
    images=[...input.row.views,...originals];
    const currentWindowIds=input.window?.observations.map(o=>o.id)??[input.row.id];
    inspected=new Set([...currentWindowIds,...ids]);
    lastToolResult={kind:'revisit-inspection',candidates:unchecked.map(c=>({placeId:c.placeId,name:c.name,observationId:c.matchedObservationId,bestInliers:c.bestInliers})),imageCount:originals.length,note:'Recalled older-place images are now supplied. Re-evaluate whether this is a continuation/revisit or a genuinely new place; no identity was accepted automatically.'};
    return lastToolResult;
   }
   if(!input.expectedVersion)throw Error('Missing durable spatial commit version');
   await invocation.setMemo('spatial-commit',{sessionId:session.metadata.id,version:input.expectedVersion,observationId:input.row.id,memberIds:input.window?.observations.map(o=>o.id)??[input.row.id],assessmentHash:digest(assessment),contextChars});
  committed=await input.commit(assessment,{inspected,delivered:new Set(delivered.keys())});
  if(!committed)throw Error('Spatial commit returned no state');
  lastToolResult={kind:'committed',observationId:input.row.id,version:committed.version};
    return commitResult(committed);
 });
  const tools=[timeline,find,read,inspect,place,skippedSources,record];
  const {harness,open}=await AgentHarness.create({session,...provider,tools,resources:{skills:skills.filter(s=>s.name===skillName)},systemPrompt:()=>skill.content,compaction:{enabled:true,reserveTokens:32000,keepRecentTokens:contextPolicy.keepRecentTokens},retry:{enabled:false,maxRetries:0,baseDelayMs:0}},BACKGROUND_CONTEXT);
  if(open.length&&!options.resume)throw Error('Unexpected open spatial operation');
  const lane=await harness.lane('space',BACKGROUND_CONTEXT);
  const checkpointRecord=(state:StoredState,tipId:string,extra:Record<string,unknown>={})=>({version:state.version,observationId:state.observationId,atMs:state.atMs,window:state.window?{startMs:state.window.startMs,endExclusiveMs:state.window.endExclusiveMs,memberIds:state.window.observations.map(o=>o.id),missingFactIds:state.window.missingFactIds??[],revisionOfVersion:state.window.revisionOfVersion,skippedBefore:state.window.skippedBefore?.map(w=>w.observations.map(o=>o.id))}:undefined,session:session.metadata,tipId,skillVersions:versions,contextPolicy,contextChars,...extra});
 harness.hooks.on('transform_context',event=>{
   // Keep Pi's summary and retained operations: past activity is work memory,
   // not fresh evidence or renewed permission to cite historical images.
   contextChars=JSON.stringify(event.messages).length;
   return {messages:event.messages};
 });
 harness.hooks.on('before_compaction',async event=>{
  try{
    const input=requireCurrent(),compaction=skills.find(s=>s.name==='context-compaction');if(!compaction)throw Error('Missing compaction skill');
    // A cut may split a turn: its prefix must also be summarized, otherwise
    // observations/tool actions before the retained tail silently disappear.
    const messagesToSummarize=[...event.preparation.messagesToSummarize,...event.preparation.turnPrefixMessages];
    if(!messagesToSummarize.length)return {decline:true}; // Entire tail retained; nothing may be discarded or invented.
    if(++requests>(options.maxRequests??8000))throw Error('Spatial Pi compaction request guard exhausted');
    const response=await request({phase:'identity',prompt:compaction.content+'\nPreserve the spatial task, observation cutoff, location uncertainty, source/place/visit IDs, failed investigations, pending observations and unresolved conflicts. Historical visibility is not current evidence. This is working memory, not a database assertion.',data:{current:{id:input.row.id,atMs:input.row.atMs},role:'spatial-compaction',originalQuestion:null,task:'spatial-memory-v2',previousSummary:event.preparation.previousSummary,messages:messagesToSummarize,retainedMessageCount:event.preparation.retainedTail.length,knownMemoryRefs:input.context.recent.map(r=>r.observationId)},images:[],textOnlyIdentity:true,includeUsage:true}) as any;
   const result=response.output??response;
   if(typeof result.summary!=='string'||!result.summary.trim()||result.summary.length>4000)throw Error('Invalid spatial compaction summary');
    contextChars=result.summary.length+JSON.stringify(event.preparation.retainedTail).length;
    return {compaction:{summary:result.summary,retainedTail:event.preparation.retainedTail,tokensBefore:event.preparation.tokensBefore,details:{semanticCoverageCertified:false,contextPolicy}}};
  }catch(error){compactionFailure=String(error);await appendFile(join(root,'compaction-failures.jsonl'),JSON.stringify({atMs:current?.row.atMs,error:compactionFailure,fallbackSent:false})+'\n');return {decline:true};}
 });
 await writeFile(join(root,'session.json'),JSON.stringify(session.metadata,null,2),{flag:'wx'}).catch(e=>{if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;});
  return {
   async recover(states){
    recovering=true;for(const state of states)recoveryStates.set(state.version,state);
    try{
     const execution=await lane.inspectExecution(BACKGROUND_CONTEXT);
     if(execution.current){
      const resumed=getOrThrow(await lane.resume(BACKGROUND_CONTEXT));
      if(resumed.status!=='completed')throw Error('Pi pending operation could not be reconciled without inference: '+JSON.stringify(resumed));
     }
     const branch=await sessionBranch(session.metadata.path!,await lane.getTipId(BACKGROUND_CONTEXT));
     let checkpoints:any[]=[];try{checkpoints=(await readFile(join(root,'pi-checkpoints.jsonl'),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
     if(checkpoints.some(c=>!states.some(s=>s.version===c.version)))throw Error('Pi checkpoint has no corresponding SQLite state');
     for(const state of states){
      const matches=checkpoints.filter(c=>c.version===state.version),entry=verifiedCommitEntry(branch,state);if(!entry)throw Error('SQLite state has no verifiable successful Pi effect');
      if(matches.length>1||matches.length===1&&(matches[0].observationId!==state.observationId||matches[0].tipId!==entry.id||matches[0].session?.id!==session.metadata.id||matches[0].atMs!==state.atMs))throw Error('Conflicting Pi checkpoint binding');
      if(!matches.length)await appendFile(join(root,'pi-checkpoints.jsonl'),JSON.stringify(checkpointRecord(state,entry.id,{recovery:'verified-sqlite-tool-effect',recoveredAtMs:Date.now(),contextChars:null}))+'\n');
     }
    }finally{recovering=false;recoveryStates.clear();}
   },
  async judge(input:JudgeInput){
   current=input;delivered=new Map();images=[];inspected=new Set();lastToolResult=null;committed=null;turnRequests=0;
   const windowImages=input.windowViews??input.row.views;
   images=[...windowImages];inspected=new Set(windowImages.map(v=>v.id));
   // Automatic recall is delivered as text/source identifiers. Candidate images
   // stay lazy so they cannot displace the twelve current-window images; the
   // agent must memory_inspect them before treating a change as a new place.
   for(const candidate of input.revisit?.candidates??[]){
    const record=input.history.find(r=>r.observationId===candidate.matchedObservationId)??input.history.find(r=>r.window?.observations.some(o=>o.id===candidate.matchedObservationId));
    if(record){delivered.set(record.observationId,record);delivered.set(candidate.matchedObservationId,record);}
   }
    if(contextChars>=contextPolicy.maxChars){getOrThrow(await lane.compact(undefined,BACKGROUND_CONTEXT));if(compactionFailure)throw Error('Spatial compaction failed closed: '+compactionFailure);}
    const outcome=getOrThrow(await lane.prompt(JSON.stringify({observationId:input.row.id,atMs:input.row.atMs,role:'current-independent-observation',facts:input.facts,window:input.window,revisit:input.revisit??null,stateHead:{previousRegion:input.previousRegion,lastCommittedVersion:input.context.recent.at(-1)?.version??null},sourceRefs:windowImages.map(v=>({id:v.id,direction:v.direction,sha256:v.sha256})),evidencePolicy:'Prior messages describe history. Only current runtime deliveredIds/inspectedIds authorize sources; prior visibility is not current visibility. Revisit candidates were recalled automatically from older places using images only; scores are not identity. Their historical images are not preloaded; memory_inspect the candidate before concluding that a changed scene is a new place. Historical images are not evidence of what is currently visible.'}),undefined,BACKGROUND_CONTEXT));
   if(outcome.status!=='completed'||!committed)throw Error('Spatial Pi turn did not commit: '+JSON.stringify(outcome));
   const tipId=await lane.getTipId(BACKGROUND_CONTEXT);
    await appendFile(join(root,'pi-checkpoints.jsonl'),JSON.stringify(checkpointRecord(committed,tipId!))+'\n');
   return committed;
  },
  async close(){await harness.close(BACKGROUND_CONTEXT);await repo.close(BACKGROUND_CONTEXT);}
 };
}
