import type {MemoryEntry} from '../causal-context-question.js';
import {MemoryAccess} from './memory-access.js';

export type EvidenceFrame={memoryRef:string;observationId:string;atMs:number;summary:string;observations:string[]};
export type TentativeInterpretation={text:string;evidenceRefs:string[];createdAtMs:number;kind:'model-interpretation-not-observation'};

/** Separate source/data plane from interpretations. No place ID, scene default or semantic resolver. */
export class SpatialEvidenceState {
 private archive:EvidenceFrame[]=[];
 private pending:EvidenceFrame|null=null;
 private proposals:TentativeInterpretation[]=[];
 private lastRecall:unknown=null;
 private toolError:unknown=null;
 private recalledRefs=new Set<string>();
 readonly memory=new MemoryAccess([],0,id=>{const r=this.archive.find(x=>x.observationId===id);if(!r)throw Error('Unknown source');return {id,atMs:r.atMs,frames:[]};});
 restoreSources(frames:readonly EvidenceFrame[]){
  if(this.pending||this.archive.length)throw Error('Restore requires an empty source state');
  for(const [index,frame] of frames.entries()){
   if(frame.memoryRef!==`memory-v${index+1}`||!frame.observationId||!Number.isFinite(frame.atMs)||frame.atMs<0||typeof frame.summary!=='string'||!Array.isArray(frame.observations)||frame.observations.some(s=>typeof s!=='string'))throw Error('Invalid frozen source state');
   this.begin(frame);this.commit();
  }
 }
 begin(frame:EvidenceFrame){
  if(this.pending||this.archive.some(r=>r.memoryRef===frame.memoryRef||r.observationId===frame.observationId)||frame.atMs<=(this.archive.at(-1)?.atMs??-1))throw Error('Invalid new observation');
  this.pending=structuredClone(frame);this.proposals=[];this.lastRecall=null;this.toolError=null;this.recalledRefs.clear();
 }
 context(){
  if(!this.pending)throw Error('No current observation');
  const recent=this.archive.slice(-4);
  for(const frame of recent){const entry=this.entry(frame);this.memory.returned.set(frame.memoryRef,entry);this.memory.read.set(frame.memoryRef,entry);}
  return structuredClone({currentObservation:this.pending,recentSourceObservations:recent,recalledSources:[...this.recalledRefs].slice(-12).map(ref=>this.memory.read.get(ref)!),lastRecall:this.lastRecall,lastToolError:this.toolError,currentInterpretations:this.proposals,
   archive:{count:this.archive.length,firstMs:this.archive[0]?.atMs??null,lastMs:this.archive.at(-1)?.atMs??null},
   semantics:{sourceObservations:'Source-backed model descriptions, not human truth',interpretations:'Separate tentative explanations; never promoted to observations',sceneIdentity:'Not assigned by the runtime'}});
 }
 propose(text:string,evidenceRefs:string[]){
   const delivered=new Set([...this.archive.slice(-4).map(frame=>frame.memoryRef),...this.recalledRefs]);
   if(!this.pending||!text.trim()||text.length>800||!evidenceRefs.length||evidenceRefs.length>8||new Set(evidenceRefs).size!==evidenceRefs.length||evidenceRefs.some(ref=>ref!==this.pending!.memoryRef&&!delivered.has(ref)))throw Error('Interpretation must cite distinct actually delivered current or historical source facts');
  const existing=this.proposals.find(p=>p.text===text&&p.evidenceRefs.length===evidenceRefs.length&&p.evidenceRefs.every(ref=>evidenceRefs.includes(ref)));
  if(existing)return {...structuredClone(existing),recorded:true,alreadyRecorded:true};
  const proposal:TentativeInterpretation={text,evidenceRefs:[...evidenceRefs],createdAtMs:this.pending.atMs,kind:'model-interpretation-not-observation'};
  this.proposals.push(proposal);return {...structuredClone(proposal),recorded:true,alreadyRecorded:false};
 }
 async recall(args:unknown){const result=await this.memory.execute(args);this.lastRecall=result;if('records' in result)for(const record of result.records)this.recalledRefs.add(record.memoryRef);return structuredClone(this.lastRecall);}
 setToolError(error:unknown){this.toolError=structuredClone(error);}
 publishedSources(){return structuredClone(this.archive.slice(-5));}
 commit(){
  if(!this.pending)throw Error('No current observation');
  const frame=structuredClone(this.pending),interpretations=structuredClone(this.proposals);this.archive.push(frame);
  const records=this.archive.map(r=>this.entry(r));this.memory.advance(records,frame.atMs);
  this.pending=null;this.proposals=[];
  return {frame,interpretations};
 }
 private entry(frame:EvidenceFrame):MemoryEntry{return {memoryRef:frame.memoryRef,observationId:frame.observationId,atMs:frame.atMs,text:JSON.stringify({summary:frame.summary,observations:frame.observations,kind:'source-observation'})};}
}
