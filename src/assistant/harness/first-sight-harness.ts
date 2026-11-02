import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {Type} from 'typebox';
import {AgentHarness,JsonlSessionRepo,BACKGROUND_CONTEXT,getOrThrow,formatSkillsForSystemPrompt,type AgentHarnessTool,type AgentMessage,type JsonlSessionMetadata} from '@earendil-works/pi-agent-core';
import type {SpatialObservation} from '../../agent/incremental-spatial-memory.js';
import type {SpatialJsonRequest,SpatialJsonImage} from '../../agent/spatial-json-vlm.js';
import type {ThreeAgentStore} from '../three-agent-store.js';
import {causalQuestionPartition} from '../causal-context-question.js';
import {explicitMovementAssurance} from '../causal-memory-index.js';
import {MemoryAccess} from './memory-access.js';
import {RuntimeContextStore} from './context-store.js';
import {firstSightSkills} from './skill-registry.js';
import {accountedPiProvider} from './provider-boundary.js';
import {createHash} from 'node:crypto';
import type {SpatialContextVersion} from './layered-context.js';
import {projectSessionContext} from './session-context.js';
import {composeSessionContext,type SpatialContextModule} from './layered-context.js';

type Snapshot=ReturnType<ThreeAgentStore['snapshot']>;
type Input={question:string;row:SpatialObservation;snapshot:Snapshot;request:(r:SpatialJsonRequest)=>Promise<unknown>;images:(r:SpatialObservation[])=>Promise<SpatialJsonImage[]>;observation:(id:string)=>SpatialObservation;sessionRoot:string;knownAtMs?:number;maxRequests?:number;persistentMemory?:boolean;diagnosticEvidence?:SpatialObservation[];compactAfterRun?:boolean;spatialBase?:SpatialContextVersion;questionSession?:JsonlSessionMetadata;liveSpatialContext?:{module:SpatialContextModule;snapshotAt:(checkpoint:SpatialContextVersion)=>Snapshot}};
const strings=()=>Type.Array(Type.String(),{maxItems:6,uniqueItems:true});
const optionalNumber=()=>Type.Optional(Type.Union([Type.Number({minimum:0}),Type.Null()]));
const questionSkillNames=new Set(['first-sight-assistant','memory-investigation','visual-inspection']);

export async function answerWithPiHarness(input:Input){
 const known=input.knownAtMs??Math.max(0,...input.snapshot.results.map(r=>r.available_at_ms??0));
 const snapshot={...input.snapshot,results:input.snapshot.results.filter(r=>(r.available_at_ms??0)<=known)};
 const partition=input.spatialBase?{context:[],memory:snapshot.results.filter(r=>r.lane==='memory'&&r.source_at_ms<=input.row.atMs&&(r.evidence_until_ms??r.source_at_ms)<=input.row.atMs).map(r=>({memoryRef:r.memoryRef!,observationId:r.observation_id,atMs:r.source_at_ms,text:r.result.summary}))}:causalQuestionPartition(snapshot,input.row.atMs),context=partition.context,memory=input.persistentMemory===false?[]:partition.memory;memory.sort((a,b)=>a.atMs-b.atMs||a.memoryRef.localeCompare(b.memoryRef));
 const diagnostic=input.diagnosticEvidence??[];
 if(diagnostic.length>3||diagnostic.some(r=>r.atMs>input.row.atMs||!snapshot.results.some(s=>s.observation_id===r.id&&s.source_at_ms===r.atMs&&(s.evidence_until_ms??s.source_at_ms)<=input.row.atMs)))throw Error('Noncausal diagnostic evidence');
 const access=new MemoryAccess(memory,input.spatialBase?input.spatialBase.atMs:Math.max(0,input.row.atMs-60000-.000001),input.observation);
 let spatialMessages:AgentMessage[]=[];
 if(input.spatialBase){
  const base=input.spatialBase,raw=await readFile(base.contextPath);
  if(base.atMs>input.row.atMs||base.atMs===input.row.atMs&&base.observationId!==input.row.id||createHash('sha256').update(raw).digest('hex')!==base.contextSHA256)throw Error('Invalid spatial session checkpoint binding');
  const modelContext=JSON.parse(raw.toString());
  spatialMessages=modelContext.messages;
  for(const frame of modelContext.sourceObservations??[]){const record=memory.find(r=>r.memoryRef===frame.memoryRef&&r.observationId===frame.observationId&&r.atMs===frame.atMs);if(record){access.returned.set(record.memoryRef,record);access.read.set(record.memoryRef,record);}}
  for(const message of modelContext.messages){
   if(message.role!=='toolResult'||message.toolName!=='record_context'||message.isError)continue;
   for(const block of message.content??[]){if(block.type!=='text')continue;const value=JSON.parse(block.text),record=memory.find(r=>r.memoryRef===value.memoryRef&&r.observationId===value.observationId&&r.atMs===value.atMs);if(record){access.returned.set(record.memoryRef,record);access.read.set(record.memoryRef,record);}}
  }
 }
 const inheritedMemoryRefs=[...access.read.keys()],retrievedMemoryRefs=new Set<string>();
 const initialContext={current:{id:input.row.id,atMs:input.row.atMs},question:input.question,questionAtMs:input.row.atMs,contextMode:input.spatialBase?'layered-spatial-session':'legacy-window-migration-only',recentWindowMs:input.spatialBase?null:60000,recentContext:context,inheritedReferenceIndex:[...access.read.values()].map(r=>({memoryRef:r.memoryRef,observationId:r.observationId,atMs:r.atMs})),spatialBase:input.spatialBase?{atMs:input.spatialBase.atMs,tipId:input.spatialBase.tipId,contextSHA256:input.spatialBase.contextSHA256}:null,knowledgeCutoff:known,persistentMemoryCoverage:{count:memory.length,firstMs:memory[0]?.atMs??null,lastMs:memory.at(-1)?.atMs??null},capabilities:{persistentMemory:input.persistentMemory!==false,piHarness:true},diagnosticEvidence:diagnostic.map(r=>({id:r.id,atMs:r.atMs,scope:'Supplied historical image diagnostic only, not autonomous recall'}))};
 const store=new RuntimeContextStore({...initialContext,workingState:{lastOperation:null as unknown,readRecords:0,inspectedImages:0,loadedSkills:['first-sight-assistant']}}),history:Array<{action:unknown;result:unknown}>=[];
 const loaded=new Set<string>(['first-sight-assistant']),{env,skills,versions}=await firstSightSkills();
 const root=resolve(input.sessionRoot);await mkdir(root,{recursive:true});
 const repo=new JsonlSessionRepo({fileSystem:env,sessionsRoot:root}),execution=BACKGROUND_CONTEXT;
 const session=input.questionSession?await repo.open(input.questionSession,execution):await repo.create({cwd:process.cwd()},execution);
 await writeFile(join(root,'question-session.json'),JSON.stringify(session.metadata,null,2));
 let final:any=null,requests=0,currentImages=await input.images([input.row,...diagnostic]),historicalImageWindow=false,spatialVersion=input.spatialBase?.index??0;
 const assessments:string[]=[];
 const inspected=new Set<string>([input.row.id,...diagnostic.map(r=>r.id)]);
 const provider=accountedPiProvider({request:input.request,view:()=>({current:store.snapshot().data.current,runtimeContext:store.snapshot(),images:currentImages}),onAssessment:text=>{assessments.push(text);},onRequest:()=>{if(++requests>(input.maxRequests??96))throw Error('Harness request guard exhausted');}});
 const record=(action:unknown,result:unknown)=>{history.push({action,result});store.update({...store.snapshot().data,workingState:{lastOperation:action,readRecords:access.read.size,inspectedImages:access.inspected.size,loadedSkills:[...loaded]}});return {content:[{type:'text' as const,text:JSON.stringify(result)}],details:{}};};
 const tool=(name:string,description:string,parameters:any,run:(a:any)=>Promise<any>):AgentHarnessTool<undefined>=>({name,label:name,description,parameters,executionMode:'sequential',execute:async(_id,a)=>{try{return await run(a);}catch(error){history.push({action:{kind:name,...a as object},result:{error:String(error)}});throw error;}}});
 const tools=[
  tool('load_skill','Load one listed skill; no arbitrary file access.',Type.Object({name:Type.String()}),async a=>{const skill=skills.find(s=>s.name===a.name);if(!skill||!questionSkillNames.has(skill.name))throw Error('Unknown or execution-role-restricted skill');loaded.add(skill.name);return record({kind:'load_skill',name:a.name},{name:a.name,content:skill.content});}),
  tool('context','Read the latest request-bound runtime context.',Type.Object({}),async()=>record({kind:'context'},store.snapshot())),
  tool('memory','Mechanical full/local historical record access.',Type.Object({op:Type.Union(['timeline','find','read','around','recall','coverage','inspect'].map(s=>Type.Literal(s))),afterMs:optionalNumber(),beforeMs:optionalNumber(),cursor:Type.Optional(Type.Integer({minimum:0})),terms:Type.Optional(Type.Array(Type.String({maxLength:80}),{maxItems:6})),match:Type.Optional(Type.Union([Type.Literal('any'),Type.Literal('all')])),memoryRef:Type.Optional(Type.String()),memoryRefs:Type.Optional(Type.Array(Type.String(),{maxItems:12})),before:Type.Optional(Type.Integer({minimum:0,maximum:12})),after:Type.Optional(Type.Integer({minimum:0,maximum:12}))}),async a=>{
   if(input.persistentMemory===false)throw Error('Persistent memory disabled for this branch');
   if(!historicalImageWindow)currentImages=[];
   const result=await access.execute(a);
   if(['read','around','recall','inspect'].includes(a.op))for(const record of (result as any).records??[])retrievedMemoryRefs.add(record.memoryRef);
   if(a.op==='inspect'){
    const rows=access.select(a.memoryRefs,3).map(r=>access.inspected.get(r.observationId)!);
    // Replace image window, retaining explicit source labels. No hidden future/current substitution.
    currentImages=await input.images(rows);historicalImageWindow=true;for(const r of rows)inspected.add(r.id);
   }
   return record({kind:`memory.${a.op}`,...a},result);
  }),
  tool('finish','Deliver a source-backed answer or explicit uncertainty.',Type.Object({text:Type.String({minLength:1,maxLength:1200}),target:Type.String({minLength:1,maxLength:240}),memoryRefs:strings(),sourceIds:strings(),contextRefs:strings(),abstained:Type.Boolean()}),async a=>{
   const badMemory=a.memoryRefs.filter((r:string)=>!access.read.has(r)),badImages=a.sourceIds.filter((id:string)=>!inspected.has(id)),badContext=a.contextRefs.filter((r:string)=>!context.some(c=>c.contextRef===r));
   if(badMemory.length||badImages.length||badContext.length)throw Error(JSON.stringify({error:'Undelivered citation',memoryRefs:badMemory,sourceIds:badImages,contextRefs:badContext,inspectedSourceIds:[...inspected],scope:'sourceIds require actual images, contextRefs reference delivered descriptions; reading a description does not inspect its source image. Regenerate; no citations were repaired.'}));
   if(!a.abstained&&!a.memoryRefs.length&&!a.sourceIds.length&&!a.contextRefs.length)throw Error('Uncited answer');
   if(explicitMovementAssurance(a.text).length)throw Error('Unsupported movement permission');
   final=a;return {...record({kind:'answer',...a},{accepted:true}),terminate:true};
  })
 ];
 try{
  const {harness}=await AgentHarness.create({session,...provider,tools,resources:{skills},systemPrompt:skills.find(s=>s.name==='first-sight-assistant')!.content,entryProjectors:{question_context:entry=>[{role:'user',content:JSON.stringify({type:'completed-question-context',data:entry.data}),timestamp:entry.timestamp}]},compaction:{enabled:true,reserveTokens:32000,keepRecentTokens:12000},toolExecution:'sequential',retry:{enabled:false,maxRetries:0,baseDelayMs:0}},execution);
  harness.hooks.on('transform_context',async event=>{
   if(input.liveSpatialContext){
    const next=input.liveSpatialContext.module.snapshot(),state=store.snapshot().data;
    if(next.index>spatialVersion){
     const bytes=await readFile(next.contextPath);
     if(createHash('sha256').update(bytes).digest('hex')!==next.contextSHA256)throw Error('Live spatial context changed');
     const snap=input.liveSpatialContext.snapshotAt(next);
     if(snap.asOfMs!==next.atMs||snap.results.some(r=>r.source_at_ms>next.atMs||(r.evidence_until_ms??r.source_at_ms)>next.atMs))throw Error('Invalid live spatial cutoff');
     const records=snap.results.filter(r=>r.lane==='memory').map(r=>({memoryRef:r.memoryRef!,observationId:r.observation_id,atMs:r.source_at_ms,text:r.result.summary}));
     const published=JSON.parse(bytes.toString());access.advance(records,next.atMs);spatialMessages=published.messages;
     for(const frame of published.sourceObservations??[]){const record=records.find(r=>r.memoryRef===frame.memoryRef&&r.observationId===frame.observationId&&r.atMs===frame.atMs);if(record){access.returned.set(record.memoryRef,record);access.read.set(record.memoryRef,record);if(!inheritedMemoryRefs.includes(record.memoryRef))inheritedMemoryRefs.push(record.memoryRef);}}
     for(const message of spatialMessages){
      if(message.role!=='toolResult'||message.toolName!=='record_context'||message.isError)continue;
      for(const block of message.content){if(block.type!=='text')continue;const value=JSON.parse(block.text),record=records.find(r=>r.memoryRef===value.memoryRef&&r.observationId===value.observationId&&r.atMs===value.atMs);if(record){access.returned.set(record.memoryRef,record);access.read.set(record.memoryRef,record);if(!inheritedMemoryRefs.includes(record.memoryRef))inheritedMemoryRefs.push(record.memoryRef);}}
     }
     if(!historicalImageWindow&&next.atMs>state.current.atMs){currentImages=await input.images([input.observation(next.observationId)]);inspected.add(next.observationId);}
     store.update({...state,current:next.atMs>state.current.atMs?{id:next.observationId,atMs:next.atMs}:state.current,spatialBase:{atMs:next.atMs,tipId:next.tipId,contextSHA256:next.contextSHA256}});spatialVersion=next.index;
    }
   }
   return {messages:composeSessionContext(spatialMessages,event.messages),systemPrompt:[...loaded].map(name=>skills.find(s=>s.name===name)!.content).join('\n\n')+'\n'+formatSkillsForSystemPrompt(skills.filter(s=>questionSkillNames.has(s.name)))};
  });
  harness.hooks.on('before_compaction',async event=>{
   // Spatial and question modules compact independently. Injected spatial tokens alone
   // must not trigger endless compaction of a tiny private conversation.
   if(input.spatialBase&&event.reason!=='manual'&&JSON.stringify(event.preparation.messagesToSummarize).length<12000)return {decline:true};
   if(++requests>(input.maxRequests??96))return {decline:true};
   const response=await input.request({phase:'identity',prompt:skills.find(s=>s.name==='context-compaction')!.content,data:{current:store.snapshot().data.current,role:'pi-compaction',originalQuestion:input.question,previousSummary:event.preparation.previousSummary,messages:event.preparation.messagesToSummarize,retainedMessageCount:event.preparation.retainedTail.length,knownMemoryRefs:[...access.read.keys()],readCoverage:{readRecords:access.read.size,availableRecords:memory.length,inspectedIds:[...inspected],semanticCoverageCertified:false}},images:[],textOnlyIdentity:true,includeUsage:true}) as any;
   const raw=response.output??response;
   if(typeof raw.summary!=='string'||!raw.summary.trim()||raw.summary.length>12000||!Array.isArray(raw.memoryRefs)||raw.memoryRefs.some((r:string)=>!access.read.has(r))||[...raw.summary.matchAll(/memory-v\d+/g)].some(m=>!access.read.has(m[0])))throw Error('Invalid compaction sources/summary; previous context retained');
   await writeFile(join(root,`compaction-${requests}.json`),JSON.stringify({summary:raw,coveredMessages:event.preparation.messagesToSummarize.length},null,2));
   return {compaction:{summary:raw.summary,retainedTail:event.preparation.retainedTail,tokensBefore:event.preparation.tokensBefore,details:{sourceRefs:raw.memoryRefs,semanticCoverageCertified:false}}};
  });
  harness.hooks.on('before_tool',event=>{if(requests>=(input.maxRequests??96)&&event.toolName!=='finish')return {block:{reason:'Request guard exhausted'}};});
   const lane=await harness.lane('answer',execution);
  const result=getOrThrow(await lane.prompt(input.question,undefined,execution));
  await writeFile(join(root,'outcome.json'),JSON.stringify(result,null,2));
  if(result.status!=='completed'||!final)throw Error('Pi harness did not deliver a final answer: '+JSON.stringify(result));
  await lane.appendCustomEntry('question_context',{question:input.question,atMs:input.row.atMs,answer:final,interpretation:'Question-agent result; not a new observation or certified spatial fact'},execution);
  if(input.compactAfterRun)getOrThrow(await lane.compact(undefined,execution));
  const transcript=await lane.findEntries(undefined,execution);
  await writeFile(join(root,'transcript.json'),JSON.stringify(transcript,null,2));
  await writeFile(join(root,'context.json'),JSON.stringify({schema:'pi-question-context-v1',spatialBase:store.snapshot().data.spatialBase,spatialMessages,questionMessages:projectSessionContext(transcript),messages:composeSessionContext(spatialMessages,projectSessionContext(transcript))},null,2));
  await harness.close(execution);
  return {...final,source:final.memoryRefs.length||final.contextRefs.length?'historical' as const:'visual' as const,audit:{schema:'pi-memory-harness-v1',initialContext,history,deliveredMemory:[...access.read.values()],inheritedMemoryRefs,retrievedMemoryRefs:[...retrievedMemoryRefs],inspectedIds:[...inspected],citedMemory:final.memoryRefs.map((r:string)=>access.read.get(r)!),diagnosticEvidenceIds:diagnostic.map(r=>r.id),contextSHAInput:JSON.stringify(initialContext),route:diagnostic.length?'supplied-evidence-diagnostic':retrievedMemoryRefs.size?'persistent-memory-investigated':input.spatialBase?'inherited-spatial-session':'context-or-current-only',turns:requests,skillVersions:versions,loadedSkills:[...loaded],sessionRoot:root,questionSession:session.metadata,transport:'accounted-json-to-pi-tool-bridge',semanticCoverageCertified:false}};
 }finally{await writeFile(join(root,'audit-state.json'),JSON.stringify({context:store.snapshot(),assessments,history,readRefs:[...access.read.keys()],inspectedIds:[...inspected],skillVersions:versions},null,2));await repo.close(execution);}
}
