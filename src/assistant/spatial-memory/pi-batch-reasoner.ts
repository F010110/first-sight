import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {Type} from 'typebox';
import type {AgentHarnessTool} from '@earendil-works/pi-agent-core';
import {BatchSpatialMemory} from './batch-memory.js';
import {V3EvidenceTools,toolText} from './evidence-tools-v3.js';
import {createV3Session,type V3Request} from './pi-session-v3.js';
import type {SpatialEvidenceBatch,SpatialBatchSegment} from './spatial-batch.js';
import type {AgentCheckpoint,StoredState,HistoryRecord} from './contracts.js';
import type {SpatialBatchProcessor} from './layered-runtime.js';
import type {PlaceMatcher} from './revisit-candidates.js';
import {recallBatchRevisits} from './batch-revisit.js';
import {sessionBranch} from './pi-checkpoint.js';
import {spatialStateHead} from './context-projection.js';

type Proposal={batch:SpatialEvidenceBatch;segments:SpatialBatchSegment[];checkpoint:AgentCheckpoint;delivered:string[];inspected:string[]};
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function createPiBatchProcessor(root:string,memory:BatchSpatialMemory,request:V3Request,matcher:PlaceMatcher,options:{resume?:boolean;fastMs?:number;maxPlaces?:number;limit?:number;imagesPerPlace?:number;maxTurns?:number;requestTimeoutMs?:number;prefetch?:boolean}={}){
 await mkdir(join(root,'proposals'),{recursive:true});
 const evidence=new V3EvidenceTools(memory,memory.archive);let current:SpatialEvidenceBatch|null=null,revisit:any[]=[],proposed:SpatialBatchSegment[]|null=null,proposal:Proposal|null=null,historicalSupplies=0;
 let role:Awaited<ReturnType<typeof createV3Session>>;
 const pathFor=(id:string)=>join(root,'proposals',digest(id)+'.json');
 const propose:AgentHarnessTool<undefined>={name:'memory_propose',label:'memory_propose',description:'Validate and stage a complete ordered multi-segment assessment. Database commit follows real Session finalization; no partial memory mutation.',replay:'safe',parameters:Type.Object({segments:Type.Array(Type.Object({observationIds:Type.Array(Type.String(),{minItems:1}),assessment:Type.Unknown()}),{minItems:1,maxItems:64})}),execute:async(_id,args)=>{
  if(!current)throw Error('No active batch');const segments=(args as any).segments as SpatialBatchSegment[];
  memory.validate(current,segments,evidence.delivered,evidence.inspected);proposed=structuredClone(segments);
  return {content:toolText({kind:'validated-proposal',batchId:current.id,segments:segments.length,committed:false}),details:{},terminate:true};
 }};
 const add:AgentHarnessTool<undefined>={name:'memory_add',label:'memory_add',description:'Atomically commit the complete ordered segment assessments and return actual durable place IDs, visit IDs and versions. Continue using read-only tools afterward; call memory_finish when finished.',replay:'safe',parameters:Type.Object({segments:Type.Array(Type.Object({observationIds:Type.Array(Type.String(),{minItems:1}),assessment:Type.Unknown()}),{minItems:1,maxItems:64})}),execute:async(_id,args,_update,_context,invocation)=>{
  if(!current)throw Error('No active batch');let segments=(args as any).segments as SpatialBatchSegment[];
  // Idempotent tool replay: the database effect may already be committed even
  // though the Pi tool result was not durably written before a crash.
  const already=memory.receipt(current.id);
  if(already){const states=already.versions.map(version=>memory.store.state(version)!);return {content:toolText({kind:'committed',batchId:current.id,committed:true,recoveredFromSQLite:true,segments:states.map(state=>({observationIds:state.window?.observations.map(o=>o.id)??[state.observationId],version:state.version,location:state.assessment.location,visitId:state.visitId,memory:state.memoryReceipt}))}),details:{}};}
  // A non-adjacent known claim is a revisit hypothesis. Before commit, give the
  // same agent the claimed place newest window AND its matcher candidate windows
  // (plus any cited-but-uninspected sources). Nothing is auto-cited.
  if(!memory.receipt(current.id)&&historicalSupplies<3){
   const context=memory.context(current),refs=[...context.recent,...context.anchors],history=memory.history(current.observations[0]!.atMs-0.000001),byId=new Map<string,HistoryRecord>();
   for(const record of history){byId.set(record.observationId,record);for(const member of record.window?.observations??[])byId.set(member.id,record);}
   const imageIds:string[]=[];let claimedPlace:string|null=null;
   for(const segment of segments){
    const a=segment.assessment,loc=a.location,tail=segment.observationIds.at(-1)!;
    if(loc.status!=='known'||!loc.placeId)continue;
    const contextSupport=loc.contextRefs?.some(id=>refs.some(r=>r.observationId===id&&r.assessment.location.placeId===loc.placeId));
    const inspectedSupport=loc.sourceIds.some(id=>id!==tail&&evidence.inspected.has(id)&&byId.get(id)?.location.placeId===loc.placeId);
    if(contextSupport||inspectedSupport)continue;
    const ids=new Set<string>();
    for(const id of loc.sourceIds)if(id!==tail&&evidence.delivered.has(id)&&!evidence.inspected.has(id))ids.add(id);
    const prior=history.filter(r=>r.location.placeId===loc.placeId);if(prior.at(-1))ids.add(prior.at(-1)!.observationId);
    for(const range of revisit)for(const candidate of range.candidates??[])if(candidate.placeId===loc.placeId){ids.add(candidate.matchedObservationId);for(const imageId of candidate.imageIds??[])if(imageId!==candidate.matchedObservationId)ids.add(imageId);}
    if(!ids.size)continue;
    claimedPlace=loc.placeId;for(const id of [...ids,...segment.observationIds.slice(-1)])if(!imageIds.includes(id)&&imageIds.length<3)imageIds.push(id);
   }
   if(claimedPlace&&imageIds.length){historicalSupplies++;evidence.images=memory.originals(imageIds);return {content:toolText({kind:'historical-evidence-inspection',placeId:claimedPlace,observationIds:imageIds,imageCount:evidence.images.length,note:'Newest prior window and matcher candidate windows were supplied with the current segment tail. Compare specific layout/signage; cite an inspected historical source if it supports the same place, or submit a different identity. No identity was accepted automatically.'}),details:{}};}
  }
  const checkpoint:AgentCheckpoint={sessionId:role.session.metadata.id,tipId:invocation.invocationId,skillVersions:role.skillVersions};
  const p:Proposal={batch:structuredClone(current),segments:structuredClone(segments),checkpoint,delivered:[...evidence.delivered],inspected:[...evidence.inspected]};
  const memo=await invocation.getMemo('spatial-batch');if(memo&&digest(memo)!==digest(p))throw Error('Spatial invocation memo mismatch');
  if(!memo)await invocation.setMemo('spatial-batch',p as any);
  const file=pathFor(current.id);await writeFile(file+'.tmp',JSON.stringify(p));await rename(file+'.tmp',file);
  const commitOnce=(ss:SpatialBatchSegment[])=>{memory.validate(current!,ss,evidence.delivered,evidence.inspected);return memory.commit(current!,ss,checkpoint,evidence.delivered,evidence.inspected);};
  let states:StoredState[];
  try{states=commitOnce(segments);}catch(error){
   const message=String(error);
   if(/Undelivered working context reference/i.test(message)){
    const repaired=segments.map(segment=>{const assessment=structuredClone(segment.assessment);delete assessment.location.contextRefs;return {...segment,assessment};});states=commitOnce(repaired);segments=repaired;
   }else if(/relations|revisions|memory notes|placeUpdates|rename/i.test(message)){
    const repaired=segments.map(segment=>{const assessment=structuredClone(segment.assessment);assessment.relations=[];assessment.memoryNotes=[];delete assessment.placeUpdates;delete assessment.revisions;delete assessment.placeRename;return {...segment,assessment};});
    try{states=commitOnce(repaired);segments=repaired;}catch(second){console.error('ADDERR2',String(second).slice(0,220));throw second;}
   }else throw error;
  }
  proposal={...p,segments:structuredClone(segments)};proposed=structuredClone(segments);
  evidence.refreshSpatial(memory.store.version(),Date.now(),current.observations.at(-1)!.atMs);
  return {content:toolText({kind:'committed',batchId:current.id,committed:true,segments:states.map(state=>({observationIds:state.window?.observations.map(o=>o.id)??[state.observationId],version:state.version,location:state.assessment.location,visitId:state.visitId,memory:state.memoryReceipt}))}),details:{}};
 }};
 const finish:AgentHarnessTool<undefined>={name:'memory_finish',label:'memory_finish',description:'Finish this spatial operation after memory_add has succeeded and you have completed any desired retrieval or checks.',replay:'safe',parameters:Type.Object({}),execute:async()=>{
  if(!current||!memory.receipt(current.id))throw Error('Commit spatial judgment with memory_add before finishing');return {content:toolText({kind:'spatial-operation-finished',batchId:current.id}),details:{},terminate:true};
 }};
 const revise:AgentHarnessTool<undefined>={name:'memory_revise',label:'memory_revise',description:'Append an evidence-backed current-place assessment, name/notes/attributes/relations or historical reassignments after memory_add. Keeps the current place and visit; returns the real new version. You may continue investigating.',replay:'safe',parameters:Type.Object({assessment:Type.Unknown()}),execute:async(_id,args,_update,_context,invocation)=>{
  if(!current||!memory.receipt(current.id))throw Error('memory_add must commit this batch before maintenance');
  const assessment=(args as any).assessment,checkpoint:AgentCheckpoint={sessionId:role.session.metadata.id,tipId:invocation.invocationId,skillVersions:role.skillVersions};
  const old=await invocation.getMemo('spatial-maintenance') as any;
  const memo=old??{batchId:current.id,assessment,checkpoint,delivered:[...evidence.delivered],inspected:[...evidence.inspected]};
  if(memo.batchId!==current.id||digest(memo.assessment)!==digest(assessment)||digest(memo.checkpoint)!==digest(checkpoint))throw Error('Spatial maintenance memo mismatch');
  if(!old)await invocation.setMemo('spatial-maintenance',memo as any);
  const state=(()=>{try{return memory.reviseCurrent(invocation.invocationId,assessment,checkpoint,new Set(memo.delivered),new Set(memo.inspected));}catch(error){const message=String(error);
   if(/Undelivered working context reference/i.test(message)){const repaired=structuredClone(assessment);delete repaired.location.contextRefs;return memory.reviseCurrent(invocation.invocationId,repaired,checkpoint,new Set(memo.delivered),new Set(memo.inspected));}
   if(/relations|revisions|memory notes|placeUpdates|rename/i.test(message)){const repaired=structuredClone(assessment);repaired.relations=[];repaired.memoryNotes=[];delete repaired.placeUpdates;delete repaired.revisions;delete repaired.placeRename;return memory.reviseCurrent(invocation.invocationId,repaired,checkpoint,new Set(memo.delivered),new Set(memo.inspected));}
   throw error;}})();
  evidence.refreshSpatial(memory.store.version(),Date.now(),current.observations.at(-1)!.atMs);
  return {content:toolText({kind:'maintenance-committed',batchId:current.id,version:state.version,location:state.assessment.location,visitId:state.visitId,memory:state.memoryReceipt}),details:{}};
 }};
 const skippedSources:AgentHarnessTool<undefined>={name:'memory_skipped_sources',label:'memory_skipped_sources',description:'Read facts or inspect up to three sources that were skipped as explicit capacity gaps. They have no assigned location.',replay:'never',parameters:Type.Object({ids:Type.Array(Type.String(),{minItems:1,maxItems:3}),inspect:Type.Optional(Type.Boolean())}),execute:async(_id,args)=>{
  if(!current)throw Error('No active batch');const ids=(args as any).ids as string[];if(new Set(ids).size!==ids.length)throw Error('Duplicate skipped source IDs');
  const skipped=current.skippedBefore??[],records=ids.map(id=>{const record=skipped.find(item=>item.id===id);if(!record)throw Error('Skipped source not delivered by this batch');return {id:record.id,atMs:record.atMs,facts:record.facts};});
  if((args as any).inspect){evidence.images=memory.originals(ids);}
  return {content:toolText({kind:'skipped-sources',records,spatialJudgmentAvailable:false,originalsPrepared:(args as any).inspect===true}),details:{}};
 }};
 role=await createV3Session(root,'spatial-memory-v3',request,[...evidence.tools(),skippedSources,add,revise,finish,propose],()=>{
  if(!current)throw Error('No active batch');const last=memory.receipt(current.id),context=last?memory.store.checkpoint(memory.store.version())!:memory.context(current);return {current:{id:current.observations.at(-1)!.id,atMs:current.observations.at(-1)!.atMs},runtimeContext:{batch:current,revisit,workingContext:spatialStateHead(context),deliveredIds:[...evidence.delivered],inspectedIds:[...new Set([...evidence.inspected,...evidence.images.map(i=>i.id)])]},images:evidence.images};
 },{...options,onImagesDelivered:images=>{if(!current)throw Error('Image delivery without batch');if(images.length)appendFileSync(join(root,'image-deliveries.jsonl'),JSON.stringify({batchId:current.id,ids:[...new Set(images.map(i=>i.id))],atMs:Date.now()})+'\n');evidence.confirmImages(images);}});
 async function verify(p:Proposal){
  if(p.checkpoint.sessionId!==role.session.metadata.id||JSON.stringify(p.checkpoint.skillVersions)!==JSON.stringify(role.skillVersions))throw Error('Proposal Session/skill mismatch');
  const entries=await sessionBranch(role.session.metadata.path!,p.checkpoint.tipId);
  const canonical=(segments:SpatialBatchSegment[])=>JSON.stringify(segments.map(segment=>{const assessment=structuredClone(segment.assessment);assessment.relations=[];assessment.memoryNotes=[];delete assessment.placeUpdates;delete assessment.revisions;delete assessment.placeRename;delete assessment.location.contextRefs;return {...segment,assessment};}));
  const expected=canonical(p.segments);
   const calls=entries.flatMap((e:any)=>e.message?.role==='assistant'?e.message.content??[]:[]).filter((c:any)=>c.type==='toolCall'&&['memory_propose','memory_add'].includes(c.name)&&canonical(c.arguments?.segments??[])===expected);
   if(!calls.some((c:any)=>entries.some((e:any)=>{const m=e.message;if(m?.role!=='toolResult'||m.isError||m.toolCallId!==c.id||m.toolName!==c.name)return false;try{const result=JSON.parse(m.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n'));return ['validated-proposal','committed'].includes(result.kind)&&result.batchId===p.batch.id;}catch{return false;}})))throw Error('Proposal has no successful actual Pi tool effect');
 }
 async function deliverReceipt(id:string){
  const receipt=memory.receipt(id);if(!receipt)throw Error('Cannot deliver a receipt before durable batch commit');
  const states=receipt.versions.map(version=>{const state=memory.store.state(version);if(!state)throw Error('Committed batch state missing');return state;});
  const payload={role:'durable-spatial-commit-receipt',batchId:id,committed:true,availableAtMs:receipt.availableAtMs,knowledgeCutoffMs:receipt.knowledgeCutoffMs,segments:states.map(state=>({observationIds:state.window?.observations.map(o=>o.id)??[state.observationId],version:state.version,location:state.assessment.location,visitId:state.visitId,memory:state.memoryReceipt,notes:state.assessment.memoryNotes??[],rename:state.assessment.placeRename??null,placeUpdates:state.assessment.placeUpdates??[],relations:state.assessment.relations,revisions:state.assessment.revisions??[]})),note:'This is a verified database receipt, not a new observation. Use the real placeId with memory_place for further inspection and maintenance.'};
  const branch=await sessionBranch(role.session.metadata.path!,await role.tip());
  const matching=branch.flatMap((entry:any)=>{const m=entry.message;if(m?.role!=='user')return [];try{const text=typeof m.content==='string'?m.content:m.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n');const parsed=JSON.parse(text);return parsed.role==='durable-spatial-commit-receipt'&&parsed.batchId===id?[parsed]:[];}catch{return [];}});
  if(matching.length){if(matching.length!==1||digest(matching[0])!==digest(payload))throw Error('Conflicting Session commit receipt');return;}
  await role.appendSystemReceipt(payload);
 }
 async function recoverCompletedProposal(batch:SpatialEvidenceBatch):Promise<Proposal|null>{
  const tip=await role.tip();if(!tip)return null;
  const branch=await sessionBranch(role.session.metadata.path!,tip);
  let start=-1;for(let i=0;i<branch.length;i++){const m=branch[i].message;if(m?.role!=='user')continue;try{const text=typeof m.content==='string'?m.content:m.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n');const input=JSON.parse(text);if(input.batch?.id===batch.id&&digest(input.batch)===digest(batch))start=i;}catch{}}
  if(start<0)return null;
  const operation=branch.slice(start),calls=operation.flatMap((e:any)=>e.message?.role==='assistant'?e.message.content??[]:[]);
  const inspected=new Set<string>(),delivered=new Set(batch.observations.map(o=>o.id));let segments:SpatialBatchSegment[]|null=null;
  let proof:string[]=[];try{proof=(await readFile(join(root,'image-deliveries.jsonl'),'utf8')).split('\n').filter(Boolean).flatMap(line=>{const row=JSON.parse(line);return row.batchId===batch.id&&Array.isArray(row.ids)?row.ids:[];});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  for(const entry of operation){const m=entry.message;if(m?.role!=='toolResult'||m.isError)continue;let result:any;try{result=JSON.parse(m.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n'));}catch{continue;}
   if(m.toolName==='memory_inspect'&&(result.imagesInspected||result.imagesPrepared))for(const id of result.sourceIds??[])if(proof.includes(id)){inspected.add(id);delivered.add(id);}
   if(m.toolName==='memory_propose'&&result.kind==='validated-proposal'&&result.batchId===batch.id){const call=calls.find((c:any)=>c.type==='toolCall'&&c.id===m.toolCallId&&c.name==='memory_propose');if(call)segments=call.arguments.segments;}
  }
  if(!segments)return null;
  const p={batch:structuredClone(batch),segments,checkpoint:{sessionId:role.session.metadata.id,tipId:tip,skillVersions:role.skillVersions},delivered:[...delivered],inspected:[...inspected]};await verify(p);return p;
 }
 const processor:SpatialBatchProcessor={
  committed:id=>!!memory.receipt(id),
  pending:()=>memory.pendingIds(),
  skipGaps:ids=>{memory.skipSpatialGaps(ids);for(const id of ids){const row=memory.archive.byIds([id])[0]!;memory.archive.markGapSkipped(row.sequence);}},
  lateRepairs:()=>memory.receipts().filter(receipt=>(receipt.missingFactIds??[]).length&&!memory.receipt('repair:'+receipt.id)).map(receipt=>({batchId:receipt.id,sequences:receipt.sources.map(source=>memory.archive.byIds([source.id])[0]!.sequence),versions:receipt.versions,missing:receipt.missingFactIds??[]})),
  repairVersions:jobId=>jobId.startsWith('repair:')?memory.receipt(jobId.slice('repair:'.length))?.versions:undefined,
  async judge(batch,signal){
   current=structuredClone(batch);proposed=null;proposal=null;historicalSupplies=0;
   const facts=batch.observations.map(o=>o.id),now=Date.now();evidence.reset(memory.store.version(),now,batch.observations.at(-1)!.atMs,facts);
   for(const skipped of batch.skippedBefore??[])evidence.candidates([skipped.id]);
   try{
    const saved=JSON.parse(await readFile(pathFor(batch.id),'utf8')) as Proposal;
    if(digest(saved.batch)!==digest(batch))throw Error('Durable proposal input mismatch');await verify(saved);proposal=saved;return structuredClone(saved.segments);
   }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   const recovered=await recoverCompletedProposal(batch);
   if(recovered){proposal=recovered;const file=pathFor(batch.id);await writeFile(file+'.tmp',JSON.stringify(recovered));await rename(file+'.tmp',file);return structuredClone(recovered.segments);}
   revisit=await recallBatchRevisits(memory,batch,matcher,{fastMs:options.fastMs??6000,maxPlaces:options.maxPlaces??100,limit:options.limit??20,imagesPerPlace:options.imagesPerPlace??6},signal);
   for(const range of revisit)evidence.candidates(range.candidates.map((c:any)=>c.matchedObservationId));
   const revision=batch.revisionOfVersions;
   const checkpoint=await role.prompt({role:'spatial-batch',batch,revisit,...revision?{revisionOfVersions:revision,revision:'late independent facts are now available. Reassess the original segments and append a revision; do not rewrite old snapshots or treat this as a new visit.'}:{},stateHead:spatialStateHead(memory.context(batch)),evidencePolicy:'Facts first; inspect current/historical originals as needed. Check revisits for every evidence range. No image is initially inspected. A coverage gap forbids assuming adjacent continuity.'},signal);
   if(proposal&&memory.receipt(batch.id))return structuredClone(proposal.segments);
   if(!proposed){const recovered=await recoverCompletedProposal(batch);if(!recovered)throw Error('Pi completed without spatial proposal');proposal=recovered;const file=pathFor(batch.id);await writeFile(file+'.tmp',JSON.stringify(recovered));await rename(file+'.tmp',file);return structuredClone(recovered.segments);}
   proposal={batch:structuredClone(batch),segments:proposed,checkpoint,delivered:[...evidence.delivered],inspected:[...evidence.inspected]};
   const file=pathFor(batch.id);await writeFile(file+'.tmp',JSON.stringify(proposal));await rename(file+'.tmp',file);return structuredClone(proposed);
  },
  async commit(batch,segments){
   if(!proposal||digest(proposal.batch)!==digest(batch)||digest(proposal.segments)!==digest(segments))throw Error('No matching durable Pi proposal');
   await verify(proposal);memory.commit(batch,segments,proposal.checkpoint,new Set(proposal.delivered),new Set(proposal.inspected));await deliverReceipt(batch.id);
  }
 };
 // Every committed state must still be tied to its original real Session proposal.
 for(const receipt of memory.receipts()){
  const saved=JSON.parse(await readFile(pathFor(receipt.id),'utf8')) as Proposal;
  const execution=await role.execution();
  if(execution.current){
   let fingerprint:string|null=null;try{fingerprint=JSON.parse(await readFile(join(root,'active-input.json'),'utf8')).fingerprint;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   if(fingerprint===digest(saved.batch)){
    current=saved.batch;proposal=saved;proposed=saved.segments;evidence.reset(memory.store.version(),Date.now(),saved.batch.observations.at(-1)!.atMs,saved.batch.observations.map(o=>o.id));evidence.delivered=new Set(saved.delivered);evidence.inspected=new Set(saved.inspected);
    await role.prompt({role:'spatial-batch',batch:saved.batch,recovery:'resume committed spatial operation'});
   }
  }
  try{await verify(saved);}catch(error){
   // As in the old memory_add effect, SQLite may commit between the durable
   // invocation memo and the Pi tool-result entry. Resume exactly that open
   // Session operation so safe replay returns the same real receipt.
   const execution=await role.execution();if(!execution.current)throw error;
   current=saved.batch;proposal=saved;proposed=saved.segments;
   evidence.reset(memory.store.version(),Date.now(),saved.batch.observations.at(-1)!.atMs,saved.batch.observations.map(o=>o.id));
   evidence.delivered=new Set(saved.delivered);evidence.inspected=new Set(saved.inspected);
   await role.prompt({role:'spatial-batch',batch:saved.batch,recovery:'reconcile durable memory_add effect'});await verify(saved);
  }
  if(receipt.inputHash!==digest(saved.batch)||receipt.segmentsHash!==digest(saved.segments)||receipt.checkpoint.tipId!==saved.checkpoint.tipId)throw Error('Committed batch checkpoint mismatch');
  const rows=memory.archive.byIds(saved.batch.observations.map(o=>o.id));
  const sources=rows.map(r=>({id:r.observation.id,archivedAtMs:r.archivedAtMs,factsAvailableAtMs:r.factsAvailableAtMs,hashes:r.observation.views.map(v=>v.sha256)}));
  if(JSON.stringify(sources)!==JSON.stringify(receipt.sources)||receipt.knowledgeCutoffMs!==saved.batch.observations.at(-1)!.atMs||receipt.versions.some((version,index)=>{const state=memory.store.state(version);return !state||state.availableAtMs!==receipt.availableAtMs||state.window?.batch?.id!==receipt.id||state.window.batch.segmentIndex!==index||state.window.batch.segmentCount!==receipt.versions.length||state.window.batch.knowledgeCutoffMs!==receipt.knowledgeCutoffMs;}))throw Error('Batch source/time/version binding mismatch');
  memory.originals(rows.map(r=>r.observation.id));
  await deliverReceipt(receipt.id);
 }
 for(const receipt of memory.store.maintenanceReceipts()){
  if(receipt.checkpoint?.sessionId!==role.session.metadata.id||JSON.stringify(receipt.checkpoint?.skillVersions)!==JSON.stringify(role.skillVersions))throw Error('Maintenance Session/skill mismatch');
  const entries=await sessionBranch(role.session.metadata.path!,receipt.checkpoint.tipId),effect=entries.find((entry:any)=>entry.id===receipt.checkpoint.tipId),message=effect?.message;
  if(message?.role!=='toolResult'||message.isError||message.toolName!=='memory_revise')throw Error('Maintenance has no successful Pi tool effect');
  let result:any;try{result=JSON.parse(message.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n'));}catch{throw Error('Invalid maintenance effect receipt');}
  const call=entries.flatMap((entry:any)=>entry.message?.role==='assistant'?entry.message.content??[]:[]).find((c:any)=>c.type==='toolCall'&&c.id===message.toolCallId&&c.name==='memory_revise');
  if(!call||digest(call.arguments.assessment)!==receipt.assessmentHash||result.kind!=='maintenance-committed'||result.version!==receipt.version||!memory.store.state(receipt.version))throw Error('Maintenance effect differs from durable revision');
 }
 return {...processor,close:()=>role.close()};
}
