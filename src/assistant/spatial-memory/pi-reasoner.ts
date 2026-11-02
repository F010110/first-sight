import {mkdir,appendFile,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {Type} from 'typebox';
import {AgentHarness,JsonlSessionRepo,BACKGROUND_CONTEXT,getOrThrow,type AgentHarnessTool} from '@earendil-works/pi-agent-core';
import {firstSightSkills} from '../harness/skill-registry.js';
import {accountedPiProvider} from '../harness/provider-boundary.js';
import type {SpatialJsonImage,SpatialJsonRequest} from '../../agent/spatial-json-vlm.js';
import {validateAssessment,type Assessment,type JudgeInput,type SpatialReasoner,type HistoryRecord,type StoredState} from './contracts.js';

const skillName='spatial-memory-v2';
const asText=(value:unknown)=>[{type:'text' as const,text:JSON.stringify(value)}];
const strings=(max:number)=>Type.Array(Type.String({maxLength:1200}),{maxItems:max});

/**
 * Pi execution shell for the spatial agent. The application still owns the
 * explicit working context, tool authorization, durable SQLite commit and
 * skill versioning; Pi supplies the session, tool loop and compaction.
 */
export async function createPiSpatialReasoner(rootArg:string,request:(r:SpatialJsonRequest)=>Promise<unknown>,options:{maxRequests?:number;resume?:boolean}={}):Promise<SpatialReasoner>{
 const root=resolve(rootArg);await mkdir(root,{recursive:true});
 const {env,skills,versions}=await firstSightSkills(),skill=skills.find(s=>s.name===skillName);
 if(!skill)throw Error('Missing '+skillName+' skill');
 const repo=new JsonlSessionRepo({fileSystem:env,sessionsRoot:join(root,'sessions')});
 let session;
 if(options.resume){
  try{session=await repo.open(JSON.parse(await readFile(join(root,'session.json'),'utf8')),BACKGROUND_CONTEXT);}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;session=await repo.create({cwd:process.cwd()},BACKGROUND_CONTEXT);}
 }else session=await repo.create({cwd:process.cwd()},BACKGROUND_CONTEXT);
 let current:JudgeInput|null=null,delivered=new Map<string,HistoryRecord>(),inspected=new Set<string>(),images:SpatialJsonImage[]=[],lastToolResult:unknown=null,committed:StoredState|null=null,requests=0,compactionFailure:string|null=null;
 const provider=accountedPiProvider({request,singleToolArguments:false,view:()=>{
  if(!current)throw Error('No active spatial judgment');
  return {current:{id:current.row.id,atMs:current.row.atMs},runtimeContext:{mode:'spatial-memory-v2',currentObservation:{id:current.row.id,atMs:current.row.atMs},facts:current.facts,workingContext:current.context,deliveredIds:[...delivered.keys()],inspectedIds:[...inspected],lastToolResult,feedback:current.feedback??null},images};
 },onRequest:()=>{if(compactionFailure)throw Error('Spatial compaction failed closed: '+compactionFailure);if(++requests>(options.maxRequests??8000))throw Error('Spatial Pi request guard exhausted');}});
 const requireCurrent=()=>{if(!current)throw Error('No active spatial judgment');return current;};
 const checkDelivered=(ids:unknown,max:number)=>{if(!Array.isArray(ids)||!ids.length||ids.length>max||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!delivered.has(id)))throw Error('Use 1-'+max+' distinct previously delivered observation IDs');return ids as string[];};
 const tool=(name:string,description:string,parameters:any,run:(a:any)=>Promise<any>):AgentHarnessTool<undefined>=>({name,label:name,description,parameters,execute:async(_id,args)=>{const result=await run(args);return {content:asText(result),details:{},...(result&&typeof result==='object'&&result.terminate===true?{terminate:true}:{})};}});
 const timeline=tool('memory_timeline','Paginated committed history previews; previews are navigation, not proof.',Type.Object({afterMs:Type.Optional(Type.Number({minimum:0})),beforeMs:Type.Optional(Type.Number({minimum:0})),cursor:Type.Optional(Type.Integer({minimum:0}))}),async a=>{
  const input=requireCurrent(),after=a.afterMs??0,before=a.beforeMs??input.row.atMs,cursor=a.cursor??0;
  if(!Number.isFinite(after)||!Number.isFinite(before)||after<0||before<after||before>input.row.atMs||!Number.isInteger(cursor)||cursor<0)throw Error('Invalid causal timeline range');
  const range=input.history.filter(r=>r.atMs>=after&&r.atMs<=before),page=range.slice(cursor,cursor+24);
  for(const r of page)delivered.set(r.observationId,r);
  lastToolResult={kind:'timeline',records:page.map(r=>({observationId:r.observationId,atMs:r.atMs,location:r.location,preview:r.facts.summary.slice(0,240)})),nextCursor:cursor+page.length<range.length?cursor+page.length:null,total:range.length,note:'Previews are not full text; zero matches do not establish absence'};
  return lastToolResult;
 });
 const find=tool('memory_find','Literal candidate hints only; not a target resolver and not exhaustive.',Type.Object({terms:Type.Array(Type.String({maxLength:80}),{minItems:1,maxItems:6})}),async a=>{
  const input=requireCurrent(),terms=(a.terms as string[]).map(t=>t.toLowerCase()),hits=input.history.filter(r=>terms.some(t=>JSON.stringify(r).toLowerCase().includes(t))),page=hits.slice(0,12);
  for(const r of page)delivered.set(r.observationId,r);
  lastToolResult={kind:'find',records:page.map(r=>({observationId:r.observationId,atMs:r.atMs,location:r.location,preview:r.facts.summary.slice(0,240)})),total:hits.length,candidateOnly:true,exhaustive:false};
  return lastToolResult;
 });
 const read=tool('memory_read','Read full facts for previously delivered records.',Type.Object({ids:Type.Array(Type.String(),{minItems:1,maxItems:12})}),async a=>{
  const ids=checkDelivered(a.ids,12),records=ids.map(id=>delivered.get(id)!);
  lastToolResult={kind:'read',records};return lastToolResult;
 });
 const inspect=tool('memory_inspect','Inspect original historical images for previously delivered records; max three.',Type.Object({ids:Type.Array(Type.String(),{minItems:1,maxItems:3})}),async a=>{
  const input=requireCurrent(),ids=checkDelivered(a.ids,3),originals=await input.inspect(ids);
  images=[...input.row.views,...originals];
  if(images.length>12)throw Error('Inspection would exceed 12 images');
  inspected=new Set([input.row.id,...ids]);
  lastToolResult={kind:'inspect',records:ids.map(id=>delivered.get(id)!),imageCount:originals.length,note:'Original images actually inspected; not a new spatial judgment'};
  return lastToolResult;
 });
 const revisionLocation=Type.Object({status:Type.Union([Type.Literal('known'),Type.Literal('unknown')]),placeId:Type.Union([Type.String(),Type.Null()]),name:Type.String({maxLength:240}),reason:Type.String({minLength:1,maxLength:1600}),sourceIds:Type.Array(Type.String(),{minItems:1,maxItems:12}),contextRefs:Type.Optional(Type.Array(Type.String(),{maxItems:10}))});
 const assessmentSchema=Type.Object({
  location:Type.Object({status:Type.Union([Type.Literal('new'),Type.Literal('known'),Type.Literal('unknown')]),placeId:Type.Union([Type.String(),Type.Null()]),name:Type.String({maxLength:240}),reason:Type.String({minLength:1,maxLength:1600}),sourceIds:Type.Array(Type.String(),{minItems:1,maxItems:12}),contextRefs:Type.Optional(Type.Array(Type.String(),{maxItems:10}))}),
  hypotheses:strings(8),unresolved:strings(8),
  relations:Type.Array(Type.Object({kind:Type.Union([Type.Literal('same-facility'),Type.Literal('different-region')]),referenceId:Type.String(),reason:Type.String({minLength:1,maxLength:1200}),sourceIds:Type.Array(Type.String(),{minItems:2,maxItems:8})}),{maxItems:8}),
  revisions:Type.Optional(Type.Array(Type.Object({observationId:Type.String(),location:revisionLocation}),{maxItems:3}))
 });
 const record=tool('record_spatial_state','Commit the complete current assessment and end this observation.',Type.Object({assessment:assessmentSchema}),async a=>{
  const input=requireCurrent(),assessment=validateAssessment(a.assessment as Assessment,input.row.id,inspected);
  committed=await input.commit(assessment,{inspected,delivered:new Set(delivered.keys())});
  if(!committed)throw Error('Spatial commit returned no state');
  lastToolResult={kind:'committed',observationId:input.row.id,version:committed.version};
  return {kind:'committed',observationId:input.row.id,version:committed.version,terminate:true};
 });
 const tools=[timeline,find,read,inspect,record];
 const {harness,open}=await AgentHarness.create({session,...provider,tools,resources:{skills:skills.filter(s=>s.name===skillName)},systemPrompt:()=>skill.content,compaction:{enabled:true,reserveTokens:32000,keepRecentTokens:12000},retry:{enabled:false,maxRetries:0,baseDelayMs:0}},BACKGROUND_CONTEXT);
 if(open.length)throw Error('Unexpected open spatial operation');
 const lane=await harness.lane('space',BACKGROUND_CONTEXT);
 harness.hooks.on('transform_context',event=>{
  let start=-1;
  for(let i=event.messages.length-1;i>=0;i--){const message=event.messages[i]!;if(message.role!=='user')continue;const text=typeof message.content==='string'?message.content:message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');try{if(JSON.parse(text).observationId===current?.row.id){start=i;break;}}catch{}}
  return {messages:start<0?[]:event.messages.slice(start)};
 });
 harness.hooks.on('before_compaction',async event=>{
  try{
   const input=requireCurrent(),compaction=skills.find(s=>s.name==='context-compaction');if(!compaction)throw Error('Missing compaction skill');
   const response=await request({phase:'identity',prompt:compaction.content,data:{current:{id:input.row.id,atMs:input.row.atMs},role:'spatial-compaction',originalQuestion:null,task:'spatial-memory-v2',previousSummary:event.preparation.previousSummary,messages:event.preparation.messagesToSummarize,retainedMessageCount:event.preparation.retainedTail.length,knownMemoryRefs:input.history.map(r=>r.observationId)},images:[],textOnlyIdentity:true,includeUsage:true}) as any;
   const result=response.output??response;
   if(typeof result.summary!=='string'||!result.summary.trim()||result.summary.length>4000)throw Error('Invalid spatial compaction summary');
   return {compaction:{summary:result.summary,retainedTail:event.preparation.retainedTail,tokensBefore:event.preparation.tokensBefore,details:{semanticCoverageCertified:false}}};
  }catch(error){compactionFailure=String(error);await appendFile(join(root,'compaction-failures.jsonl'),JSON.stringify({atMs:current?.row.atMs,error:compactionFailure,fallbackSent:false})+'\n');return {decline:true};}
 });
 await writeFile(join(root,'session.json'),JSON.stringify(session.metadata,null,2),{flag:'wx'}).catch(e=>{if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;});
 return {
  async judge(input:JudgeInput){
   current=input;delivered=new Map();inspected=new Set([input.row.id]);images=input.row.views;lastToolResult=null;committed=null;
   const outcome=getOrThrow(await lane.prompt(JSON.stringify({observationId:input.row.id,atMs:input.row.atMs}),undefined,BACKGROUND_CONTEXT));
   if(outcome.status!=='completed'||!committed)throw Error('Spatial Pi turn did not commit: '+JSON.stringify(outcome));
   const tipId=await lane.getTipId(BACKGROUND_CONTEXT);
   await appendFile(join(root,'pi-checkpoints.jsonl'),JSON.stringify({observationId:input.row.id,atMs:input.row.atMs,session:session.metadata,tipId,skillVersions:versions})+'\n');
   return committed;
  },
  async close(){await harness.close(BACKGROUND_CONTEXT);await repo.close(BACKGROUND_CONTEXT);}
 };
}
