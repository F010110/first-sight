import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {Type} from 'typebox';
import type {AgentHarnessTool} from '@earendil-works/pi-agent-core';
import {BatchSpatialMemory} from './batch-memory.js';
import {V3EvidenceTools,toolText} from './evidence-tools-v3.js';
import {createV3Session,type V3Request} from './pi-session-v3.js';
import type {SpatialEvidenceBatch,SpatialBatchSegment} from './spatial-batch.js';
import type {AgentCheckpoint} from './contracts.js';
import type {SpatialBatchProcessor} from './layered-runtime.js';
import type {PlaceMatcher} from './revisit-candidates.js';
import {recallBatchRevisits} from './batch-revisit.js';
import {sessionBranch} from './pi-checkpoint.js';
import {spatialStateHead} from './context-projection.js';

type Proposal={batch:SpatialEvidenceBatch;segments:SpatialBatchSegment[];checkpoint:AgentCheckpoint;delivered:string[];inspected:string[]};
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function createPiBatchProcessor(root:string,memory:BatchSpatialMemory,request:V3Request,matcher:PlaceMatcher,options:{resume?:boolean;fastMs?:number;maxPlaces?:number;limit?:number;imagesPerPlace?:number;maxTurns?:number;requestTimeoutMs?:number}={}){
 await mkdir(join(root,'proposals'),{recursive:true});
 const evidence=new V3EvidenceTools(memory,memory.archive);let current:SpatialEvidenceBatch|null=null,revisit:any[]=[],proposed:SpatialBatchSegment[]|null=null,proposal:Proposal|null=null;
 const pathFor=(id:string)=>join(root,'proposals',digest(id)+'.json');
 const propose:AgentHarnessTool<undefined>={name:'memory_propose',label:'memory_propose',description:'Validate and stage a complete ordered multi-segment assessment. Database commit follows real Session finalization; no partial memory mutation.',replay:'safe',parameters:Type.Object({segments:Type.Array(Type.Object({observationIds:Type.Array(Type.String(),{minItems:1}),assessment:Type.Unknown()}),{minItems:1,maxItems:64})}),execute:async(_id,args)=>{
  if(!current)throw Error('No active batch');const segments=(args as any).segments as SpatialBatchSegment[];
  memory.validate(current,segments,evidence.delivered,evidence.inspected);proposed=structuredClone(segments);
  return {content:toolText({kind:'validated-proposal',batchId:current.id,segments:segments.length,committed:false}),details:{},terminate:true};
 }};
 const role=await createV3Session(root,'spatial-memory-v3',request,[...evidence.tools(),propose],()=>{
  if(!current)throw Error('No active batch');return {current:{id:current.observations.at(-1)!.id,atMs:current.observations.at(-1)!.atMs},runtimeContext:{batch:current,revisit,workingContext:spatialStateHead(memory.context(current)),deliveredIds:[...evidence.delivered],inspectedIds:[...evidence.inspected]},images:evidence.images};
 },options);
 async function verify(p:Proposal){
  if(p.checkpoint.sessionId!==role.session.metadata.id||JSON.stringify(p.checkpoint.skillVersions)!==JSON.stringify(role.skillVersions))throw Error('Proposal Session/skill mismatch');
  const entries=await sessionBranch(role.session.metadata.path!,p.checkpoint.tipId);
  const expected=JSON.stringify(p.segments);
  const calls=entries.flatMap((e:any)=>e.message?.role==='assistant'?e.message.content??[]:[]).filter((c:any)=>c.type==='toolCall'&&c.name==='memory_propose'&&JSON.stringify(c.arguments?.segments)===expected);
  if(!calls.some((c:any)=>entries.some((e:any)=>{const m=e.message;if(m?.role!=='toolResult'||m.isError||m.toolCallId!==c.id||m.toolName!=='memory_propose')return false;try{const result=JSON.parse(m.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n'));return result.kind==='validated-proposal'&&result.batchId===p.batch.id;}catch{return false;}})))throw Error('Proposal has no successful actual Pi tool effect');
 }
 async function recoverCompletedProposal(batch:SpatialEvidenceBatch):Promise<Proposal|null>{
  const tip=await role.tip();if(!tip)return null;
  const branch=await sessionBranch(role.session.metadata.path!,tip);
  let start=-1;for(let i=0;i<branch.length;i++){const m=branch[i].message;if(m?.role!=='user')continue;try{const text=typeof m.content==='string'?m.content:m.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n');const input=JSON.parse(text);if(input.batch?.id===batch.id&&digest(input.batch)===digest(batch))start=i;}catch{}}
  if(start<0)return null;
  const operation=branch.slice(start),calls=operation.flatMap((e:any)=>e.message?.role==='assistant'?e.message.content??[]:[]);
  const inspected=new Set<string>(),delivered=new Set(batch.observations.map(o=>o.id));let segments:SpatialBatchSegment[]|null=null;
  for(const entry of operation){const m=entry.message;if(m?.role!=='toolResult'||m.isError)continue;let result:any;try{result=JSON.parse(m.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n'));}catch{continue;}
   if(m.toolName==='memory_inspect'&&result.imagesInspected)for(const id of result.sourceIds??[]){inspected.add(id);delivered.add(id);}
   if(m.toolName==='memory_propose'&&result.kind==='validated-proposal'&&result.batchId===batch.id){const call=calls.find((c:any)=>c.type==='toolCall'&&c.id===m.toolCallId&&c.name==='memory_propose');if(call)segments=call.arguments.segments;}
  }
  if(!segments)return null;
  const p={batch:structuredClone(batch),segments,checkpoint:{sessionId:role.session.metadata.id,tipId:tip,skillVersions:role.skillVersions},delivered:[...delivered],inspected:[...inspected]};await verify(p);return p;
 }
 const processor:SpatialBatchProcessor={
  committed:id=>!!memory.receipt(id),
  async judge(batch,signal){
   current=structuredClone(batch);proposed=null;proposal=null;
   const facts=batch.observations.map(o=>o.id),now=Date.now();evidence.reset(memory.store.version(),now,batch.observations.at(-1)!.atMs,facts);
   try{
    const saved=JSON.parse(await readFile(pathFor(batch.id),'utf8')) as Proposal;
    if(digest(saved.batch)!==digest(batch))throw Error('Durable proposal input mismatch');await verify(saved);proposal=saved;return structuredClone(saved.segments);
   }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   const recovered=await recoverCompletedProposal(batch);
   if(recovered){proposal=recovered;const file=pathFor(batch.id);await writeFile(file+'.tmp',JSON.stringify(recovered));await rename(file+'.tmp',file);return structuredClone(recovered.segments);}
   revisit=await recallBatchRevisits(memory,batch,matcher,{fastMs:options.fastMs??6000,maxPlaces:options.maxPlaces??100,limit:options.limit??20,imagesPerPlace:options.imagesPerPlace??6},signal);
   for(const range of revisit)evidence.candidates(range.candidates.map((c:any)=>c.matchedObservationId));
   const checkpoint=await role.prompt({role:'spatial-batch',batch,revisit,stateHead:spatialStateHead(memory.context(batch)),evidencePolicy:'Facts first; inspect current/historical originals as needed. Check revisits for every evidence range. No image is initially inspected. A coverage gap forbids assuming adjacent continuity.'},signal);
   if(!proposed){const recovered=await recoverCompletedProposal(batch);if(!recovered)throw Error('Pi completed without spatial proposal');proposal=recovered;const file=pathFor(batch.id);await writeFile(file+'.tmp',JSON.stringify(recovered));await rename(file+'.tmp',file);return structuredClone(recovered.segments);}
   proposal={batch:structuredClone(batch),segments:proposed,checkpoint,delivered:[...evidence.delivered],inspected:[...evidence.inspected]};
   const file=pathFor(batch.id);await writeFile(file+'.tmp',JSON.stringify(proposal));await rename(file+'.tmp',file);return structuredClone(proposed);
  },
  async commit(batch,segments){
   if(!proposal||digest(proposal.batch)!==digest(batch)||digest(proposal.segments)!==digest(segments))throw Error('No matching durable Pi proposal');
   await verify(proposal);memory.commit(batch,segments,proposal.checkpoint,new Set(proposal.delivered),new Set(proposal.inspected));
  }
 };
 // Every committed state must still be tied to its original real Session proposal.
 for(const receipt of memory.receipts()){
  const saved=JSON.parse(await readFile(pathFor(receipt.id),'utf8')) as Proposal;await verify(saved);
  if(receipt.inputHash!==digest(saved.batch)||receipt.segmentsHash!==digest(saved.segments)||receipt.checkpoint.tipId!==saved.checkpoint.tipId)throw Error('Committed batch checkpoint mismatch');
  const rows=memory.archive.byIds(saved.batch.observations.map(o=>o.id));
  const sources=rows.map(r=>({id:r.observation.id,archivedAtMs:r.archivedAtMs,factsAvailableAtMs:r.factsAvailableAtMs,hashes:r.observation.views.map(v=>v.sha256)}));
  if(JSON.stringify(sources)!==JSON.stringify(receipt.sources)||receipt.knowledgeCutoffMs!==saved.batch.observations.at(-1)!.atMs||receipt.versions.some((version,index)=>{const state=memory.store.state(version);return !state||state.availableAtMs!==receipt.availableAtMs||state.window?.batch?.id!==receipt.id||state.window.batch.segmentIndex!==index||state.window.batch.segmentCount!==receipt.versions.length||state.window.batch.knowledgeCutoffMs!==receipt.knowledgeCutoffMs;}))throw Error('Batch source/time/version binding mismatch');
  memory.originals(rows.map(r=>r.observation.id));
 }
 return {...processor,close:()=>role.close()};
}
