import {mkdir,appendFile,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {Type} from 'typebox';
import {AgentHarness,JsonlSessionRepo,BACKGROUND_CONTEXT,getOrThrow,type AgentHarnessTool} from '@earendil-works/pi-agent-core';
import {firstSightSkills} from '../harness/skill-registry.js';
import {accountedPiProvider} from '../harness/provider-boundary.js';
import type {SpatialJsonImage,SpatialJsonRequest} from '../../agent/spatial-json-vlm.js';
import {validateAssessment,type Assessment,type JudgeInput,type JudgeBatchInput,type BatchSegment,type SpatialReasoner,type HistoryRecord,type StoredState,type SpatialWindow} from './contracts.js';
import {spatialStateHead} from './context-projection.js';
import {requireDeliveredIds} from './source-access.js';
import {digest,commitResult,sessionBranch,verifiedCommitEntry,verifyCommitMemo} from './pi-checkpoint.js';

const defaultSkillName='spatial-memory-v2';
const asText=(value:unknown)=>[{type:'text' as const,text:JSON.stringify(value)}];
const strings=(max:number)=>Type.Array(Type.String({maxLength:1200}),{maxItems:max});
type Invocation=Parameters<AgentHarnessTool<undefined>['execute']>[4];

/**
 * Pi execution shell for the spatial agent. The application still owns the
 * explicit working context, tool authorization, durable SQLite commit and
 * skill versioning; Pi supplies the session, tool loop and compaction.
 */
export async function createPiSpatialReasoner(rootArg:string,request:(r:SpatialJsonRequest)=>Promise<unknown>,options:{maxRequests?:number;resume?:boolean;maxContextChars?:number;keepRecentTokens?:number;judgmentDeadlineMs?:number;maxTurnsPerJudgment?:number;skillName?:string;batchInspectMax?:number;batchImageMax?:number}={}):Promise<SpatialReasoner>{
  const root=resolve(rootArg);await mkdir(root,{recursive:true});
  const skillName=options.skillName??defaultSkillName,batchInspectMax=options.batchInspectMax??8,batchImageMax=options.batchImageMax??36;
  if(!Number.isInteger(batchInspectMax)||batchInspectMax<1||batchInspectMax>20||!Number.isInteger(batchImageMax)||batchImageMax<3||batchImageMax>120)throw Error('Invalid batch inspection budget');
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
  let current:JudgeInput|null=null,lastMessages:any[]=[],judgmentStartedAt=0,preparedSummary:{summary:string;covered:number;atMs:number}|null=null,prefetching:Promise<void>|null=null,delivered=new Map<string,HistoryRecord>(),inspected=new Set<string>(),images:SpatialJsonImage[]=[],baseImageIds=new Set<string>(),viewCalls=0,lastToolResult:unknown=null,committed:StoredState|null=null,requests=0,turnRequests=0,compactionFailure:string|null=null,contextChars=recoveredContextChars,historicalSupplies=0;
  let batchInput:JudgeBatchInput|null=null,batchCommitted:BatchSegment[]|null=null,batchStates:StoredState[]|null=null;
  let recovering=false;const recoveryStates=new Map<number,StoredState>();
 const provider=accountedPiProvider({request,singleToolArguments:false,view:()=>{
  if(!current)throw Error('No active spatial judgment');
   const shown=viewCalls++===0?images:images.filter(v=>!baseImageIds.has(v.id));
   const runtimeContext=batchInput?{mode:'spatial-memory-v2',locationPolicy:{statuses:['known','new','unknown+boundary'],rule:'Every segment is either committed to a place (known/new) or explicitly a transition between two regions (status unknown plus boundary.regions). A bare unknown is not a valid answer. Segments must cover every supplied observation exactly once in order.'},currentObservation:{id:batchInput.rows.at(-1)!.id,atMs:batchInput.rows.at(-1)!.atMs},batch:{id:batchInput.id,observationCount:batchInput.rows.length,observations:batchInput.rows.map(r=>({id:r.id,atMs:r.atMs,facts:batchInput!.facts[r.id]??null})),skippedBefore:batchInput.skippedBefore??[],missingFactIds:batchInput.missingFactIds??[],...batchInput.preloadImages?.length?{preloadedImageIds:batchInput.preloadImages.map(v=>v.id),preloadNote:batchInput.preloadNote??null}:{}},previousRegion:batchInput.previousRegion,revisit:batchInput.revisit??null,workingContext:spatialStateHead(batchInput.context),deliveredIds:[...delivered.keys()],inspectedIds:[...inspected],lastToolResult,feedback:batchInput.feedback??null}:{mode:'spatial-memory-v2',locationPolicy:{statuses:['known','new','unknown+boundary'],rule:'Every window is either committed to a place (known/new) or explicitly a transition between two regions (status unknown plus boundary.regions). A bare unknown is not a valid answer.'},currentObservation:{id:current.row.id,atMs:current.row.atMs},...current.window?{window:current.window}:{facts:current.facts},previousRegion:current.previousRegion,revisit:current.revisit??null,workingContext:spatialStateHead(current.context),deliveredIds:[...delivered.keys()],inspectedIds:[...inspected],lastToolResult,feedback:current.feedback??null};
   return {current:{id:current.row.id,atMs:current.row.atMs},runtimeContext,images:shown,...(()=>{const ws=!batchInput&&current.window?current.window.observations.filter(o=>shown.some(v=>v.id===o.id)).map(o=>({id:o.id,atMs:o.atMs})):[];return ws.length?{windowSources:ws}:{};})()};
  },onRequest:()=>{if(recovering)throw Error('Checkpoint recovery is forbidden from invoking a model');if(compactionFailure)throw Error('Spatial compaction failed closed: '+compactionFailure);if(options.judgmentDeadlineMs&&judgmentStartedAt&&Date.now()-judgmentStartedAt>options.judgmentDeadlineMs)throw Error('Spatial judgment deadline exceeded after '+Math.round(Date.now()-judgmentStartedAt)+'ms');if(++turnRequests>(options.maxTurnsPerJudgment??12)||++requests>(options.maxRequests??8000))throw Error('Spatial Pi request guard exhausted');}});
 const requireCurrent=()=>{if(!current)throw Error('No active spatial judgment');return current;};
 const deliver=(record:HistoryRecord)=>{delivered.set(record.observationId,record);for(const member of record.window?.observations??[])delivered.set(member.id,record);};
  const checkDelivered=(ids:unknown,max:number,tool:string)=>{
   const allowed=new Set([...delivered.keys(),...(batchInput?.rows.map(r=>r.id)??[])]);
   return requireDeliveredIds(ids,max,allowed,tool);
  };
  const tool=(name:string,description:string,parameters:any,run:(a:any,invocation:Invocation)=>Promise<any>):AgentHarnessTool<undefined>=>({name,label:name,description,replay:name==='memory_add'?'safe':'never',parameters:Type.Object({...parameters.properties,assessment:parameters.properties.assessment??Type.Optional(Type.Unknown())}),execute:async(_id,args,_update,_context,invocation)=>{
   if(recovering&&name==='memory_add'){
    const memo=await invocation.getMemo('spatial-commit') as any;if(memo?.batchId)throw Error('Batch commit recovery is not implemented; rerun without --resume');
    const state=recoveryStates.get(memo?.version);if(!state)throw Error('No durable state for pending Pi effect');
    const a=args as any;verifyCommitMemo(memo,state,{...a.assessment,memoryNotes:a.notes??[],...a.rename?{placeRename:a.rename}:{}},session.metadata.id);
    return {content:asText(commitResult(state)),details:{recoveredFromSQLite:true},terminate:true};
   }
  const input=requireCurrent(),a=args as any;
   if(name!=='memory_add'&&!batchInput){
   // The tool schema exposes only known/new; reject a stray unknown before it can be committed.
   if((a.assessment?.location?.status as string)==='unknown'&&!a.assessment?.location?.boundary)throw Error('location.status: a bare unknown is not available. Assign this window to a place with known/new, or, when the window genuinely spans two regions, submit status unknown together with boundary.regions (two names) and placeId null. Put any other doubt in reason/unresolved.');
   const assessment=validateAssessment(a.assessment,input.row.id,inspected);
    if(assessment.relations.length||assessment.revisions?.length||assessment.placeUpdates?.length||assessment.memoryNotes?.length||assessment.placeRename)throw Error('Interim assessment cannot commit relations/revisions/place updates/notes/rename');
   // Read-only tools may carry a tentative assessment: identity and continuity are
   // validated only on the final memory_add commit, so a known claim can still inspect
   // the historical images it needs to justify itself.
   input.context.location=assessment.location;
  }
   let result:any;try{result=await run(a,invocation);}catch(error){const message=String(error);
    // Optional fields must not cost a full model turn. A malformed relation, note or rename is
    // dropped locally and the location commit retried once; the location itself is unchanged.
    if(name==='memory_add'&&/relations|revisions|memory notes|placeUpdates|rename/i.test(message)){
     const repaired=structuredClone(a);
     if(batchInput)for(const segment of repaired.segments??[]){if(segment.assessment){segment.assessment.relations=[];delete segment.assessment.placeUpdates;delete segment.assessment.revisions;}delete segment.notes;delete segment.rename;}
     else{if(repaired.assessment){repaired.assessment.relations=[];delete repaired.assessment.placeUpdates;delete repaired.assessment.revisions;}delete repaired.notes;delete repaired.rename;}
     result=await run(repaired,invocation);lastToolResult={kind:'optional-fields-dropped',reason:message.slice(0,240)};
    }else if(name==='memory_add'&&/Undelivered working context reference/i.test(message)){
     // An expired contextRef is not evidence of identity; drop refs and let the cited sources stand.
     const repaired=structuredClone(a);
     if(batchInput)for(const segment of repaired.segments??[])if(segment.assessment?.location)delete segment.assessment.location.contextRefs;
     else if(repaired.assessment?.location)delete repaired.assessment.location.contextRefs;
     result=await run(repaired,invocation);lastToolResult={kind:'context-refs-dropped',reason:message.slice(0,240)};
    }else if(name==='memory_add'&&/Known identity requires/i.test(message)){
     // No auto-citation: return the rejection so the model can cite the historical image
     // it actually inspected, or submit a different place.
     const inspectedHistorical=[...inspected].filter(id=>batchInput?.history.some(r=>r.observationId===id||r.window?.observations.some(o=>o.id===id))??false);
     result={kind:'known-identity-rejected',error:message,...inspectedHistorical.length?{alreadyInspectedHistorical:inspectedHistorical,note:'No source was auto-cited. The IDs in alreadyInspectedHistorical were already delivered in this judgment; put the supporting one directly in location.sourceIds instead of inspecting it again, or submit new with regionChangeEvidence / a boundary transition.'}:{note:'No source was auto-cited. Cite an inspected historical source of the claimed place, or submit new with regionChangeEvidence / a boundary transition.'}};
     lastToolResult=result;
    }else throw error;}return {content:asText(result),details:{},...(result&&typeof result==='object'&&result.terminate===true?{terminate:true}:{})};}});
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
   const ids=checkDelivered(a.ids,12,'memory_read'),records=ids.map(id=>delivered.get(id)??{observationId:id,facts:batchInput?.facts[id]??null});
  lastToolResult={kind:'read',requestedSourceIds:ids,records,note:'Member source IDs return their containing window record, not a per-frame position'};return lastToolResult;
 });
 const inspect=tool('memory_inspect','Inspect original current or historical images for previously delivered records. Up to three observations in single-window mode; up to eight observations in a 40s batch.',Type.Object({ids:Type.Array(Type.String(),{minItems:1,maxItems:12})}),async a=>{
   const input=requireCurrent(),limit=batchInput?batchInspectMax:3,ids=checkDelivered(a.ids,limit,'memory_inspect'),originals=await input.inspect(ids);
  if(batchInput){
   images=[...images,...originals];
   if(images.length>batchImageMax)throw Error('Inspection image limit');
   for(const id of ids)inspected.add(id);
   lastToolResult={kind:'inspect',requestedSourceIds:ids,imageCount:originals.length,note:'Only these original images were delivered. Facts for the whole batch remain available for citation; historical identity still requires an inspected image.'};
   return lastToolResult;
  }
  images=[...input.row.views,...originals];
  const currentWindowIds=input.window?.observations.map(o=>o.id)??[input.row.id];
   inspected=new Set([...inspected,...currentWindowIds,...ids]);
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
   const input=requireCurrent(),sources=[...(batchInput?.skippedBefore??input.window?.skippedBefore??[]),...input.history.flatMap(r=>r.window?.skippedBefore??[])].flatMap(w=>w.observations);
   if(new Set(a.ids).size!==a.ids.length)throw Error('Duplicate skipped source IDs');
   const records=(a.ids as string[]).map(id=>{const source=sources.find(s=>s.id===id);if(!source)throw Error('Skipped source not delivered by causal windows');return source;});
   if(a.inspect){const originals=await input.inspect(a.ids);images=batchInput?[...images,...originals]:[...input.row.views,...originals];if(images.length>(batchInput?batchImageMax:12))throw Error('Inspection image limit');if(batchInput){for(const id of a.ids)inspected.add(id);}else{const currentWindowIds=input.window?.observations.map(o=>o.id)??[input.row.id];inspected=new Set([...inspected,...currentWindowIds,...a.ids]);}}
   lastToolResult={kind:'skipped-sources',records,spatialJudgmentAvailable:false,originalsInspected:a.inspect===true};return lastToolResult;
  });
  const revisionLocation=Type.Object({status:Type.Literal('known'),placeId:Type.Union([Type.String(),Type.Null()]),name:Type.String({maxLength:240}),reason:Type.String({minLength:1,maxLength:1600}),sourceIds:Type.Array(Type.String(),{minItems:1,maxItems:64}),contextRefs:Type.Optional(Type.Array(Type.String(),{maxItems:10}))});
 const assessmentSchema=Type.Object({
  location:Type.Object({status:Type.Union([Type.Literal('new'),Type.Literal('known'),Type.Literal('unknown')]),placeId:Type.Union([Type.String(),Type.Null()]),name:Type.String({maxLength:240}),reason:Type.String({minLength:1,maxLength:1600}),sourceIds:Type.Array(Type.String(),{minItems:1,maxItems:64}),contextRefs:Type.Optional(Type.Array(Type.String(),{maxItems:10})),boundary:Type.Optional(Type.Object({regions:Type.Array(Type.String({maxLength:240}),{minItems:2,maxItems:2})})),regionChangeEvidence:Type.Optional(Type.Array(Type.String({minLength:1,maxLength:400}),{maxItems:4}))}),
   hypotheses:strings(8),unresolved:strings(8),
   placeUpdates:Type.Optional(Type.Unknown()),
  relations:Type.Optional(Type.Unknown()),
  revisions:Type.Optional(Type.Unknown())
 });
  const addBatch=async(a:any,invocation:Invocation)=>{
    const batch=batchInput!;let segs=a.segments;
    if(!Array.isArray(segs)||!segs.length)throw Error('Batch memory_add requires segments[] covering every batch observation exactly once in order');
    if(batch.projectRevisits){
     const normalized=segs.map((s:any)=>({observationIds:s.observationIds,assessment:{...s.assessment,memoryNotes:s.notes??[],...s.rename?{placeRename:s.rename}:{}}}));
     segs=batch.projectRevisits(normalized).map(s=>({observationIds:s.observationIds,assessment:s.assessment,notes:s.assessment.memoryNotes??[],...s.assessment.placeRename?{rename:s.assessment.placeRename}:{}}));
    }
   // Delivery rule: a source that exists in committed history is deliverable on
   // demand. If the model cites such a source before it has been delivered in
   // this judgment, fetch that exact source first instead of rejecting the whole
   // commit. This applies to all segment statuses, not only known revisits, and
   // still never auto-cites or auto-confirms an identity.
   const batchIdsForDelivery=new Set(batch.rows.map(r=>r.id));
   const historyForDelivery=new Set<string>();
   for(const r of batch.history){historyForDelivery.add(r.observationId);for(const o of r.window?.observations??[])historyForDelivery.add(o.id);}
    const citedHistorical=[...new Set<string>(segs.flatMap((s:any)=>Array.isArray(s?.assessment?.location?.sourceIds)?s.assessment.location.sourceIds as string[]:[]))]
    .filter((id:string)=>typeof id==='string'&&!batchIdsForDelivery.has(id)&&!inspected.has(id)&&historyForDelivery.has(id));
   if(historicalSupplies<2&&citedHistorical.length){
    historicalSupplies++;
    const ids=citedHistorical.slice(0,batchInspectMax),originals=await batch.inspect(ids);
    for(const id of ids)inspected.add(id);
    images=[...images,...originals];if(images.length>batchImageMax)throw Error('Inspection image limit');
    lastToolResult={kind:'historical-evidence-inspection',observationIds:ids,imageCount:originals.length,note:'The cited committed historical sources were delivered together. Cite these exact inspected IDs in sourceIds if they support the claim; no identity was accepted automatically.'};
    return lastToolResult;
   }
   // Known claims still receive the newest prior window of the claimed place. Nothing is auto-cited.
   if(historicalSupplies<2){
    // Aggregate every unsupported known place in this batch into ONE image
    // supply turn. Supplying one place per model turn was the dominant cost in
    // multi-place batches (front + interior needed two rejected commits).
    const supplies:Array<{placeId:string;segmentTailId:string;observationIds:string[];kind:'cited'|'prior'}>=[];
    const imageIds:string[]=[];
    const historyIds=new Set<string>();
    for(const r of batch.history){historyIds.add(r.observationId);for(const o of r.window?.observations??[])historyIds.add(o.id);}
    for(const seg of segs){
     const loc=seg?.assessment?.location;
     if(loc?.status!=='known'||!loc.placeId)continue;
     if(/^batch:\d+$/.test(loc.placeId))continue; // local earlier-segment reference, resolved at commit
     const tail=Array.isArray(seg.observationIds)?seg.observationIds.at(-1):undefined;if(typeof tail!=='string')continue;
     const cited=Array.isArray(loc.sourceIds)?loc.sourceIds as string[]:[];
     // A model may cite a real historical observation before it was delivered.
     // If the ID exists in committed history, supply that exact source instead of
     // rejecting the same known claim forever.
     const pending=cited.filter((id:string)=>id!==tail&&!inspected.has(id)&&(delivered.has(id)||historyIds.has(id))).slice(0,3);
     if(pending.length){supplies.push({placeId:loc.placeId,segmentTailId:tail,observationIds:pending,kind:'cited'});for(const id of pending)if(!imageIds.includes(id))imageIds.push(id);continue;}
     const contextRefs=Array.isArray(loc.contextRefs)?loc.contextRefs as string[]:[];
     const contextSupport=batch.previousRegion?.placeId===loc.placeId&&contextRefs.some((id:string)=>[...batch.context.recent,...batch.context.anchors].some(r=>r.observationId===id&&r.assessment.location.placeId===loc.placeId));
     const hasCited=cited.some((id:string)=>id!==tail&&inspected.has(id));
     if(!hasCited&&!contextSupport){
      const prior=batch.history.filter(r=>r.location.placeId===loc.placeId&&r.observationId!==tail),record=prior.at(-1);
      if(record&&!inspected.has(record.observationId)){
       delivered.set(record.observationId,record);
       supplies.push({placeId:loc.placeId,segmentTailId:tail,observationIds:[record.observationId],kind:'prior'});
       if(!imageIds.includes(record.observationId))imageIds.push(record.observationId);
      }
     }
    }
    if(supplies.length){
     historicalSupplies++;
     const ids=imageIds.slice(0,batchInspectMax),originals=await batch.inspect(ids);
     for(const id of ids)inspected.add(id);
     images=[...images,...originals];if(images.length>batchImageMax)throw Error('Inspection image limit');
     lastToolResult={kind:'historical-evidence-inspection',supplies,observationIds:ids,imageCount:originals.length,note:'All unsupported known places in this batch were supplied together. Compare current layout/signage with each supplied historical window; cite the inspected observation IDs that actually support the claim, or submit a different identity. No identity was accepted or cited automatically.'};
     return lastToolResult;
    }
   }
   const prepared:BatchSegment[]=[];let cursor=0;const citeable=new Set([...inspected,...batch.rows.map(r=>r.id)]);
   for(const seg of segs){
    if(!Array.isArray(seg?.observationIds)||!seg.observationIds.length)throw Error('Empty batch segment: observationIds required');
    for(const id of seg.observationIds){
     if(batch.rows[cursor]?.id!==id)throw Error(`Segments must cover the batch exactly once in order. Expected ${JSON.stringify(batch.rows[cursor]?.id??null)}; received ${JSON.stringify(id)}. Full batch IDs: ${JSON.stringify(batch.rows.map(r=>r.id))}`);
     cursor++;
    }
    const tail=seg.observationIds.at(-1)!;
    if((seg.assessment?.location?.status as string)==='unknown'&&!seg.assessment?.location?.boundary)throw Error('location.status: a bare unknown is not available; use known/new, or unknown with boundary.regions.');
    // Mechanical tolerance: the segment tail is always a delivered current
    // source, so a missing tail should not cost a model turn. No other source
    // is invented or removed.
    const raw=structuredClone(seg.assessment);raw.location=raw.location??{} as any;if(Array.isArray(raw.location.contextRefs)){const allowed=new Set([...batch.context.recent.map(r=>r.observationId),...batch.context.anchors.map(r=>r.observationId)]);raw.location.contextRefs=raw.location.contextRefs.filter((id:string)=>allowed.has(id));if(!raw.location.contextRefs.length)delete raw.location.contextRefs;}const sourceIds=Array.isArray(raw.location.sourceIds)?[...raw.location.sourceIds]:[];if(!sourceIds.includes(tail))sourceIds.push(tail);raw.location.sourceIds=sourceIds;
    const assessment=validateAssessment({...raw,memoryNotes:seg.notes??[],...seg.rename?{placeRename:seg.rename}:{}} as Assessment,tail,citeable);
    prepared.push({observationIds:[...seg.observationIds],assessment});
   }
   if(cursor!==batch.rows.length)throw Error(`Incomplete batch coverage: covered ${cursor}/${batch.rows.length}; remaining ${JSON.stringify(batch.rows.slice(cursor).map(r=>r.id))}`);
   if(!batch.expectedVersion)throw Error('Missing durable spatial commit version');
   await invocation.setMemo('spatial-commit',{sessionId:session.metadata.id,batchId:batch.id,firstVersion:batch.expectedVersion,segments:prepared.map(s=>({observationId:s.observationIds.at(-1)!,memberIds:s.observationIds,assessmentHash:digest(s.assessment)})),contextChars});
   const states=await batch.commitSegments(prepared,{inspected,delivered:new Set(delivered.keys())});
   if(!states?.length||states.length!==prepared.length)throw Error('Batch commit returned an incomplete state list');
   batchCommitted=prepared;batchStates=states;
   lastToolResult={kind:'committed',batchId:batch.id,committed:true,segments:states.map(state=>({observationIds:state.window?.observations.map(o=>o.id)??[state.observationId],version:state.version,location:state.assessment.location,visitId:state.visitId,memory:state.memoryReceipt})),terminate:true};
   startPrefetch();
   return lastToolResult;
  };
  const notesSchema=Type.Optional(Type.Array(Type.Object({text:Type.String({minLength:1,maxLength:800}),sourceIds:Type.Array(Type.String(),{minItems:1,maxItems:64})}),{maxItems:6}));
  const renameSchema=Type.Optional(Type.Object({name:Type.String({minLength:1,maxLength:240}),reason:Type.String({minLength:1,maxLength:800}),sourceIds:Type.Array(Type.String(),{minItems:1,maxItems:64})}));
  const record=tool('memory_add','Atomically add a complete-window assessment and sourced notes. The database manages place/visit/IDs. In a 40s facts-first batch, submit segments[] covering every batch observation exactly once in order; each segment becomes one durable window. Optional rename:{name,reason,sourceIds} updates the name of a confirmed known place without changing its identity or past records; match location.name and include current source. Do not rename on unknown/boundary/new. A persistent place may cover continuous station interior; use an accurate evolving name. A visible old landmark does not establish current occupancy. Never copy historical features into current reasons.',Type.Object({segments:Type.Optional(Type.Array(Type.Object({observationIds:Type.Array(Type.String({maxLength:120}),{minItems:1,maxItems:64}),assessment:assessmentSchema,notes:notesSchema,rename:renameSchema}),{minItems:1,maxItems:64})),assessment:Type.Optional(assessmentSchema),notes:notesSchema,rename:renameSchema}),async(a,invocation)=>{
   const input=requireCurrent();
   if(batchInput)return await addBatch(a,invocation);
   // A non-adjacent known claim is a revisit hypothesis. Before it can commit, give the
   // same agent the claimed place's newest prior window alongside the current window.
   // The agent compares specific layout/signage and must cite the inspected source;
   // nothing is auto-cited and a different place must be submitted as new.
   if(historicalSupplies<2&&a.assessment?.location?.status==='known'&&a.assessment.location.placeId){
    const claimed=a.assessment.location.placeId as string;
    const location=a.assessment.location;
    const cited=Array.isArray(location.sourceIds)?location.sourceIds as string[]:[];
    const pending=cited.filter((id:string)=>id!==input.row.id&&delivered.has(id)&&!inspected.has(id)).slice(0,3);
    if(pending.length){
     historicalSupplies++;
     const originals=await input.inspect(pending);for(const id of pending)inspected.add(id);
     images=[...(input.windowViews??input.row.views),...originals];
     lastToolResult={kind:'historical-evidence-inspection',placeId:claimed,observationIds:pending,imageCount:originals.length,note:'The cited historical sources were supplied as images with the current window. Cite one of these exact observation IDs in location.sourceIds if they support the claim; a different place must be submitted as new. No identity was accepted automatically.'};
     return lastToolResult;
    }
    const contextRefs=Array.isArray(location.contextRefs)?location.contextRefs as string[]:[];
    const contextSupport=contextRefs.some(id=>[...input.context.recent,...input.context.anchors].some(r=>r.observationId===id&&((r.assessment?.location?.placeId??(r as any).location?.placeId)===claimed)));
    const hasCited=cited.some((id:string)=>id!==input.row.id&&inspected.has(id));
    if(!hasCited&&!contextSupport){
     const prior=input.history.filter(r=>r.location?.placeId===claimed&&r.observationId!==input.row.id);
     const record=prior.at(-1);
     if(record&&!inspected.has(record.observationId)){
      historicalSupplies++;
      const originals=await input.inspect([record.observationId]);
      delivered.set(record.observationId,record);
      inspected.add(record.observationId);
      images=[...(input.windowViews??input.row.views),...originals];
      lastToolResult={kind:'historical-evidence-inspection',placeId:claimed,observationIds:[record.observationId],imageCount:originals.length,note:'Newest prior window of the claimed place supplied with the current window. Compare layout, signage and distinctive objects. If it is a different place, submit new with regionChangeEvidence; if it is the same, cite this observation ID in location.sourceIds. No identity was accepted automatically.'};
      return lastToolResult;
     }
    }
   }
   // A transition (unknown + boundary) stays legal; a bare unknown is not an answer.
   if((a.assessment?.location?.status as string)==='unknown'&&!a.assessment?.location?.boundary)throw Error('location.status: a bare unknown is not available. Assign this window to a place with known/new, or, when the window genuinely spans two regions, submit status unknown together with boundary.regions (two names) and placeId null. Put any other doubt in reason/unresolved.');
   const assessment=validateAssessment({...a.assessment,memoryNotes:a.notes??[],...a.rename?{placeRename:a.rename}:{}} as Assessment,input.row.id,inspected);
   if(!input.expectedVersion)throw Error('Missing durable spatial commit version');
   await invocation.setMemo('spatial-commit',{sessionId:session.metadata.id,version:input.expectedVersion,observationId:input.row.id,memberIds:input.window?.observations.map(o=>o.id)??[input.row.id],assessmentHash:digest(assessment),contextChars});
  try{
   committed=await input.commit(assessment,{inspected,delivered:new Set(delivered.keys())});
  }catch(error){
   if(!/Unknown persistent place/.test(String(error)))throw error;
   // A spliced or obsolete UUID must be replaced from real IDs, never auto-corrected.
   const known=new Set<string>();
   for(const r of [...input.context.recent,...input.context.anchors]){const id=(r as any).location?.placeId??(r as any).assessment?.location?.placeId;if(id)known.add(id);}
   for(const r of delivered.values())if(r.location?.placeId)known.add(r.location.placeId);
   throw Error('assessment.location.placeId: '+JSON.stringify(assessment.location.placeId)+' is not an existing place. Place IDs that actually appear in this session: '+JSON.stringify([...known])+'. Read a real place with memory_place/memory_timeline or submit unknown/boundary; do not invent or splice UUIDs.');
  }
  if(!committed)throw Error('Spatial commit returned no state');
  lastToolResult={kind:'committed',observationId:input.row.id,version:committed.version};
  startPrefetch();
    return commitResult(committed);
 });
  const tools=[timeline,find,read,inspect,place,skippedSources,record];
  const {harness,open}=await AgentHarness.create({session,...provider,tools,resources:{skills:skills.filter(s=>s.name===skillName)},systemPrompt:()=>skill.content,compaction:{enabled:true,reserveTokens:64000,keepRecentTokens:contextPolicy.keepRecentTokens},retry:{enabled:false,maxRetries:0,baseDelayMs:0}},BACKGROUND_CONTEXT);
  if(open.length&&!options.resume)throw Error('Unexpected open spatial operation');
  const lane=await harness.lane('space',BACKGROUND_CONTEXT);
  const checkpointRecord=(state:StoredState,tipId:string,extra:Record<string,unknown>={})=>({version:state.version,observationId:state.observationId,atMs:state.atMs,window:state.window?{startMs:state.window.startMs,endExclusiveMs:state.window.endExclusiveMs,memberIds:state.window.observations.map(o=>o.id),missingFactIds:state.window.missingFactIds??[],revisionOfVersion:state.window.revisionOfVersion,skippedBefore:state.window.skippedBefore?.map(w=>w.observations.map(o=>o.id))}:undefined,session:session.metadata,tipId,skillVersions:versions,contextPolicy,contextChars,...extra});
 harness.hooks.on('transform_context',event=>{
   // Keep Pi's summary and retained operations: past activity is work memory,
   // not fresh evidence or renewed permission to cite historical images.
   contextChars=JSON.stringify(event.messages).length;
   return {messages:event.messages};
 });
  // Between windows the session keeps growing; summarise its prefix in the background so the
  // next compaction can be applied instantly with the un-summarised delta kept verbatim.
  const startPrefetch=()=>{
   if(prefetching||preparedSummary||lastMessages.length<6||!current)return;
   const compaction=skills.find(s=>s.name==='context-compaction');if(!compaction)return;
   const covered=lastMessages.length-4,messages=lastMessages.slice(0,covered),input=current;
   if(covered<2)return;
   const basePrompt=compaction.content+'\nPreserve the spatial task, observation cutoff, location uncertainty, source/place/visit IDs, failed investigations, pending observations and unresolved conflicts. Historical visibility is not current evidence. This is working memory, not a database assertion.';
   prefetching=(async()=>{
    let result:any=null,summaryError='';
    for(let attempt=0;attempt<2&&!result;attempt++){
     if(++requests>(options.maxRequests??8000))throw Error('Spatial Pi compaction request guard exhausted');
     const response=await request({phase:'identity',prompt:basePrompt+(summaryError?'\nPrevious summary was rejected: '+summaryError+'\nReturn JSON {"summary":"..."} with a non-empty string of at most 4000 characters.':''),data:{current:{id:input.row.id,atMs:input.row.atMs},role:'spatial-compaction',originalQuestion:null,task:'spatial-memory-v2',previousSummary:null,messages,retainedMessageCount:lastMessages.length-covered,knownMemoryRefs:input.context.recent.map(r=>r.observationId)},images:[],textOnlyIdentity:true,includeUsage:true}) as any;
     const candidate=response.output??response;
     if(typeof candidate?.summary==='string'&&candidate.summary.trim()&&candidate.summary.length<=4000)result=candidate;
     else{summaryError='expected {summary: non-empty string <=4000 chars}';await appendFile(join(root,'compaction-failures.jsonl'),JSON.stringify({atMs:input.row.atMs,attempt,reason:summaryError})+ '\n');}
    }
    if(!result)throw Error('Invalid spatial compaction summary');
    preparedSummary={summary:result.summary,covered,atMs:input.row.atMs};
    await appendFile(join(root,'compaction-prefetch.jsonl'),JSON.stringify({atMs:input.row.atMs,covered,length:result.summary.length})+ '\n');
   })().catch(async e=>{await appendFile(join(root,'compaction-failures.jsonl'),JSON.stringify({atMs:current?.row.atMs,error:String(e),fallbackSent:false})+ '\n');}).finally(()=>{prefetching=null;});
  };
 harness.hooks.on('before_compaction',async event=>{
  // Prefer a summary prepared in the background: apply it instantly and keep every message added
  // after the summarised prefix verbatim. Only when nothing is ready do we fall back to a
  // synchronous summary, so correctness never depends on prefetch timing.
  try{
   const compaction=skills.find(s=>s.name==='context-compaction');if(!compaction)throw Error('Missing compaction skill');
   const toSummarize=[...event.preparation.messagesToSummarize,...event.preparation.turnPrefixMessages];
   if(!toSummarize.length)return {decline:true};
   if(preparedSummary&&preparedSummary.covered<=toSummarize.length){
    const applied=preparedSummary;preparedSummary=null;
    const delta=toSummarize.slice(applied.covered),retained=[...delta,...event.preparation.retainedTail];
    contextChars=applied.summary.length+JSON.stringify(retained).length;
    await appendFile(join(root,'compaction-applied.jsonl'),JSON.stringify({atMs:current?.row.atMs,coveredMessages:applied.covered,deltaMessages:delta.length,waited:false})+ '\n');
    return {compaction:{summary:applied.summary,retainedTail:retained,tokensBefore:event.preparation.tokensBefore,details:{semanticCoverageCertified:false,contextPolicy,parallel:true}}};
   }
   startPrefetch();
   const input=requireCurrent(),basePrompt=compaction.content+'\nPreserve the spatial task, observation cutoff, location uncertainty, source/place/visit IDs, failed investigations, pending observations and unresolved conflicts. Historical visibility is not current evidence. This is working memory, not a database assertion.';
   const payload={current:{id:input.row.id,atMs:input.row.atMs},role:'spatial-compaction',originalQuestion:null,task:'spatial-memory-v2',previousSummary:event.preparation.previousSummary,messages:toSummarize,retainedMessageCount:event.preparation.retainedTail.length,knownMemoryRefs:input.context.recent.map(r=>r.observationId)};
   let result:any=null,summaryError='';
   for(let attempt=0;attempt<2&&!result;attempt++){
    if(++requests>(options.maxRequests??8000))throw Error('Spatial Pi compaction request guard exhausted');
    const response=await request({phase:'identity',prompt:basePrompt+(summaryError?'\nPrevious summary was rejected: '+summaryError+'\nReturn JSON {"summary":"..."} with a non-empty string of at most 4000 characters.':''),data:payload,images:[],textOnlyIdentity:true,includeUsage:true}) as any;
    const candidate=response.output??response;
    if(typeof candidate?.summary==='string'&&candidate.summary.trim()&&candidate.summary.length<=4000)result=candidate;
    else{summaryError='expected {summary: non-empty string <=4000 chars}';await appendFile(join(root,'compaction-failures.jsonl'),JSON.stringify({atMs:input.row.atMs,attempt,reason:summaryError})+ '\n');}
   }
   if(!result)throw Error('Invalid spatial compaction summary');
   contextChars=result.summary.length+JSON.stringify(event.preparation.retainedTail).length;
   await appendFile(join(root,'compaction-applied.jsonl'),JSON.stringify({atMs:input.row.atMs,waited:true})+ '\n');
   return {compaction:{summary:result.summary,retainedTail:event.preparation.retainedTail,tokensBefore:event.preparation.tokensBefore,details:{semanticCoverageCertified:false,contextPolicy,parallel:false}}};
  }catch(error){await appendFile(join(root,'compaction-failures.jsonl'),JSON.stringify({atMs:current?.row.atMs,error:String(error),fallbackSent:false})+ '\n');return {decline:true};}
 });
 await writeFile(join(root,'session.json'),JSON.stringify(session.metadata,null,2),{flag:'wx'}).catch(e=>{if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;});
  const runJudge=async(input:JudgeInput,batch:JudgeBatchInput|null,initialImages:SpatialJsonImage[],markWindowInspected:boolean):Promise<Assessment|BatchSegment[]>=>{
   current=input;batchInput=batch;batchCommitted=null;batchStates=null;delivered=new Map();images=[...initialImages];inspected=markWindowInspected?new Set(initialImages.map(v=>v.id)):new Set();baseImageIds=new Set(initialImages.map(v=>v.id));viewCalls=0;lastToolResult=null;committed=null;turnRequests=0;historicalSupplies=0;judgmentStartedAt=Date.now();
   if(!batch){
    // Skipped windows must not disappear from the reasoning. Deliver the newest skipped
    // window's originals so this judgment can also assign it (via revisions) instead of
    // leaving those images permanently unjudged. Bounded to one window per turn.
    const skipped=input.window?.skippedBefore?.at(-1);
    if(skipped){
     const skipIds=skipped.observations.map(o=>o.id);
     try{images.push(...await input.inspect(skipIds));for(const id of skipIds)inspected.add(id);}
     catch(error){lastToolResult={kind:'skipped-window-inspect-failed',observationIds:skipIds,error:String(error)};}
    }
   }
   for(const candidate of input.revisit?.candidates??[]){
    const record=input.history.find(r=>r.observationId===candidate.matchedObservationId)??input.history.find(r=>r.window?.observations.some(o=>o.id===candidate.matchedObservationId));
    if(record){delivered.set(record.observationId,record);delivered.set(candidate.matchedObservationId,record);}
   }
    if(contextChars>=contextPolicy.maxChars){getOrThrow(await lane.compact(undefined,BACKGROUND_CONTEXT));if(compactionFailure)throw Error('Spatial compaction failed closed: '+compactionFailure);}
    const payload=batch?{observationId:input.row.id,atMs:input.row.atMs,role:'spatial-batch',batch:{id:batch.id,observationCount:batch.rows.length,observations:batch.rows.map(r=>({id:r.id,atMs:r.atMs,facts:batch.facts[r.id]??null})),skippedBefore:batch.skippedBefore??[],missingFactIds:batch.missingFactIds??[],...batch.preloadImages?.length?{preloadedImageIds:batch.preloadImages.map(v=>v.id),preloadNote:batch.preloadNote??null}:{}},stateHead:{previousRegion:input.previousRegion,lastCommittedVersion:input.context.recent.at(-1)?.version??null},sourceRefs:[],evidencePolicy:batch.preloadImages?.length?'Facts are the delivered current evidence. The preloaded current/candidate images are already delivered and count as inspected in this judgment: if a candidate matches, cite its observation ID directly in that segment location.sourceIds on the first memory_add; do not inspect an already preloaded ID again. Historical images are not current visibility. Segments must cover every listed observation exactly once in order; keep a continuous same place in one segment.':'Facts are the delivered current evidence; original images are not preloaded. Inspect a small current or historical set only when facts are insufficient. Historical images are not current visibility. Segments must cover every listed observation exactly once in order; keep a continuous same place in one segment.'}:{observationId:input.row.id,atMs:input.row.atMs,role:'current-independent-observation',facts:input.facts,window:input.window,stateHead:{previousRegion:input.previousRegion,lastCommittedVersion:input.context.recent.at(-1)?.version??null},sourceRefs:initialImages.map(v=>({id:v.id,direction:v.direction,sha256:v.sha256})),evidencePolicy:'Prior messages describe history. Only current runtime deliveredIds/inspectedIds authorize sources; prior visibility is not current visibility. Revisit candidates are broad, unordered navigation, not identity: review them on every window, inspect promising historical images, and compare distinctive layout/signage before deciding continuation, reuse or new. Historical images are not evidence of what is currently visible.'};
    const outcome=getOrThrow(await lane.prompt(JSON.stringify(payload),undefined,BACKGROUND_CONTEXT));
   if(batch){
    if(outcome.status!=='completed'||!batchCommitted||!batchStates)throw Error('Spatial Pi batch turn did not commit: '+JSON.stringify(outcome));
    const tipId=await lane.getTipId(BACKGROUND_CONTEXT),states=batchStates as StoredState[];
    for(const [index,state] of states.entries())await appendFile(join(root,'pi-checkpoints.jsonl'),JSON.stringify(checkpointRecord(state,tipId!,{batch:{id:batch.id,segmentIndex:index,segmentCount:states.length}}))+'\n');
    return batchCommitted;
   }
   if(outcome.status!=='completed'||!committed)throw Error('Spatial Pi turn did not commit: '+JSON.stringify(outcome));
   const tipId=await lane.getTipId(BACKGROUND_CONTEXT);
    await appendFile(join(root,'pi-checkpoints.jsonl'),JSON.stringify(checkpointRecord(committed,tipId!))+'\n');
   return committed;
  };
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
  async judge(input:JudgeInput){return await runJudge(input,null,input.windowViews??input.row.views,true) as Assessment;},
  async judgeBatch(input:JudgeBatchInput){
   const first=input.rows[0]!,last=input.rows.at(-1)!;
   const window:SpatialWindow={startMs:first.atMs,endExclusiveMs:last.atMs+1,observations:input.rows.map(r=>({id:r.id,atMs:r.atMs,facts:input.facts[r.id]??null})),missingFactIds:input.missingFactIds??[],...input.skippedBefore?.length?{skippedBefore:input.skippedBefore}:{},batch:{id:input.id,knowledgeCutoffMs:last.atMs,segmentIndex:0,segmentCount:0}};
   const ji:JudgeInput={row:last,facts:input.facts[last.id]??null,context:input.context,history:input.history,...input.expectedVersion!==undefined?{expectedVersion:input.expectedVersion}:{},...input.previousRegion?{previousRegion:input.previousRegion}:{},window,...input.revisit?{revisit:input.revisit}:{},...input.readPlace?{readPlace:input.readPlace}:{},inspect:input.inspect,commit:async()=>{throw Error('Batch judgment must commit segments');},...input.feedback!==undefined&&input.feedback!==null?{feedback:input.feedback}:{}};
   const preload=input.preloadImages??[];return await runJudge(ji,input,preload,preload.length>0) as BatchSegment[];
  },
  async close(){await harness.close(BACKGROUND_CONTEXT);await repo.close(BACKGROUND_CONTEXT);}
 };
}
