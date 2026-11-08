import {Type} from 'typebox';
import type {AgentHarnessTool} from '@earendil-works/pi-agent-core';
import type {HistoryRecord} from './contracts.js';
import type {SpatialJsonImage} from '../../agent/spatial-json-vlm.js';
import {BatchSpatialMemory} from './batch-memory.js';
import {ObservationArchive} from './observation-archive.js';

export const toolText=(value:unknown)=>[{type:'text' as const,text:JSON.stringify(value)}];
export function v3Tool(name:string,description:string,parameters:any,run:(args:any)=>Promise<any>|any):AgentHarnessTool<undefined>{return {name,label:name,description,replay:'never',parameters,execute:async(_id,args)=>({content:toolText(await run(args)),details:{}})};}

/** Request-local evidence permissions. A private conversation never grants them. */
export class V3EvidenceTools{
 delivered=new Set<string>();
 inspected=new Set<string>();
 readFacts=new Set<string>();
 images:SpatialJsonImage[]=[];
 private history:HistoryRecord[]=[];
 private version=0;
 private knownAtMs=0;
 private cutoff=0;
 private revision=0;
 constructor(private memory:BatchSpatialMemory,private archive:ObservationArchive){}
 reset(version:number,knownAtMs:number,cutoff:number,initialIds:string[],revision=this.archive.revision()){
  this.version=version;this.knownAtMs=knownAtMs;this.cutoff=cutoff;this.revision=revision;
  this.history=this.memory.store.history(version,cutoff,knownAtMs);
  this.delivered=new Set(initialIds);this.inspected.clear();this.readFacts=new Set(this.archive.byIds(initialIds).filter(r=>r.facts&&(r.factsRevision??0)<=revision&&r.factsAvailableAtMs!==null&&r.factsAvailableAtMs<=knownAtMs).map(r=>r.observation.id));this.images=[];
 }
 deliverHistory(record:HistoryRecord){this.delivered.add(record.observationId);for(const m of record.window?.observations??[])this.delivered.add(m.id);}
 candidates(ids:string[]){for(const id of ids)this.delivered.add(id);}
 private requireIds(ids:unknown,max:number){if(!Array.isArray(ids)||!ids.length||ids.length>max||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!this.delivered.has(id)))throw Error('Only distinct, delivered source IDs may be read/inspected');return ids as string[];}
 tools(){return [
  v3Tool('memory_timeline','Paginate committed spatial history; preview is navigation, not image inspection.',Type.Object({cursor:Type.Optional(Type.Integer({minimum:0})),afterMs:Type.Optional(Type.Number({minimum:0})),beforeMs:Type.Optional(Type.Number({minimum:0}))}),a=>{
   const after=a.afterMs??0,before=Math.min(a.beforeMs??this.cutoff,this.cutoff),range=this.history.filter(r=>r.atMs>=after&&r.atMs<=before),page=range.slice(a.cursor??0,(a.cursor??0)+24);for(const r of page)this.deliverHistory(r);
   return {records:page.map(r=>({observationId:r.observationId,atMs:r.atMs,location:r.location,preview:r.facts?.summary,memberIds:r.window?.observations.map(o=>o.id)})),nextCursor:(a.cursor??0)+page.length<range.length?(a.cursor??0)+page.length:null,semanticCompleteness:false};
  }),
  v3Tool('memory_find','Literal candidates, not a semantic answer; empty results do not prove absence.',Type.Object({terms:Type.Array(Type.String({minLength:1,maxLength:80}),{minItems:1,maxItems:6})}),a=>{
   const hits=this.history.filter(r=>a.terms.some((t:string)=>JSON.stringify(r).toLowerCase().includes(t.toLowerCase())));for(const r of hits.slice(0,12))this.deliverHistory(r);return {records:hits.slice(0,12).map(r=>({observationId:r.observationId,location:r.location,preview:r.facts?.summary})),total:hits.length,exhaustive:false};
  }),
  v3Tool('memory_place','Read versioned place/visits/windows/notes/attributes with source IDs.',Type.Object({placeId:Type.String({minLength:1}),cursor:Type.Optional(Type.Integer({minimum:0})),noteCursor:Type.Optional(Type.Integer({minimum:0}))}),a=>{
   const profile=this.memory.store.placeMemory(a.placeId,this.version,this.knownAtMs,a.cursor,a.noteCursor,this.cutoff) as any;
   for(const visit of profile?.visits??[])for(const record of visit.windows){this.deliverHistory(record);this.readFacts.add(record.observationId);for(const m of record.window?.observations??[])this.readFacts.add(m.id);}return profile;
  }),
  v3Tool('memory_read','Read full independent facts for delivered source IDs, without looking at images.',Type.Object({ids:Type.Array(Type.String(),{minItems:1,maxItems:12})}),a=>{
   const ids=this.requireIds(a.ids,12),rows=this.archive.byIds(ids);
   return rows.map(r=>{if(r.archivedAtMs>this.knownAtMs||(r.archivedRevision??0)>this.revision||r.observation.atMs>this.cutoff)throw Error('Source beyond question cutoff');const facts=(r.factsRevision??0)<=this.revision&&r.factsAvailableAtMs!==null&&r.factsAvailableAtMs<=this.knownAtMs?r.facts:null;if(facts)this.readFacts.add(r.observation.id);return {id:r.observation.id,atMs:r.observation.atMs,facts};});
  }),
  v3Tool('memory_inspect','Actually view up to three delivered current/historical three-camera originals.',Type.Object({ids:Type.Array(Type.String(),{minItems:1,maxItems:3})}),a=>{
   const ids=this.requireIds(a.ids,3),rows=this.archive.byIds(ids);if(rows.some(r=>r.archivedAtMs>this.knownAtMs||(r.archivedRevision??0)>this.revision||r.observation.atMs>this.cutoff))throw Error('Image beyond causal cutoff');
   this.images=this.memory.originals(ids);for(const id of ids)this.inspected.add(id);return {sourceIds:ids,observations:rows.map(r=>({id:r.observation.id,atMs:r.observation.atMs})),imagesInspected:true,note:'Images delivered for this tool turn only. Use source times and the current batch/question cutoff, not the generic REFERENCE image heading, to distinguish current-batch frames from older visits. Earlier inspected source permissions remain operation-local.'};
  }),
  v3Tool('observation_timeline','Browse archived observations even if spatial memory has no result. Facts may be missing.',Type.Object({afterSequence:Type.Optional(Type.Integer({minimum:0}))}),a=>{
   const rows=this.archive.read(a.afterSequence??0,24,this.knownAtMs,this.revision).filter(r=>r.observation.atMs<=this.cutoff);for(const row of rows){this.delivered.add(row.observation.id);if(row.facts)this.readFacts.add(row.observation.id);}return {observations:rows.map(r=>({sequence:r.sequence,id:r.observation.id,atMs:r.observation.atMs,facts:r.facts})),nextSequence:rows.at(-1)?.sequence??null,spatialAttribution:false};
  }),
  v3Tool('observation_find','Paginated literal candidates from independent facts, including observations not yet spatially modeled. No match does not prove absence; previews require read/inspect.',Type.Object({terms:Type.Array(Type.String({minLength:1,maxLength:80}),{minItems:1,maxItems:6}),cursor:Type.Optional(Type.Integer({minimum:0}))}),a=>{
   const result=this.archive.findFacts(a.terms,a.cursor??0,this.knownAtMs,this.revision,this.cutoff);for(const row of result.rows)this.delivered.add(row.observation.id);
   return {records:result.rows.map(row=>({id:row.observation.id,atMs:row.observation.atMs,preview:row.facts?.summary.slice(0,240)})),total:result.total,nextCursor:result.nextCursor,candidateOnly:true,spatialAttribution:false,semanticCompleteness:false};
  }),
  v3Tool('memory_coverage','Mechanical evidence coverage, not semantic completeness.',Type.Object({}),()=>({spatialVersion:this.version,knownAtMs:this.knownAtMs,sourceCutoffMs:this.cutoff,delivered:[...this.delivered],factsRead:[...this.readFacts],imagesInspected:[...this.inspected],semanticCompleteness:false}))
 ];}
}
