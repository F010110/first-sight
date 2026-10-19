import type {SpatialObservation} from './incremental-spatial-memory.js';

export interface ContextJudgment {observationId:string;atMs:number;placeId:string|null;reason:string;sourceIds:string[]}
export interface ContextEvidence {id:string;atMs:number;reason:string;placeId:string|null;kind?:'observation'|'model-statement'}
export interface SpatialContextView {
 version:1;current:SpatialObservation|null;location:ContextJudgment|null;
 recent:ContextJudgment[];anchors:ContextJudgment[];retrieved:ContextEvidence[];
 outputs:Array<{atMs:number;value:unknown}>;
 compression:{discarded:number;policy:'recent-and-place-anchors';rawMemoryDeleted:false};
}

/** Working memory is a bounded view, not the persistent evidence store.
 * Current observation never inherits an unverified previous location. */
export class SpatialWorkingContext {
 private current:SpatialObservation|null=null;
 private recent:ContextJudgment[]=[];
 private anchors:ContextJudgment[]=[];
 private retrieved:ContextEvidence[]=[];
 private discarded=0;
 private outputs:Array<{atMs:number;value:unknown}>=[];
 recordOutput(atMs:number,value:unknown){const raw=JSON.stringify(value);this.outputs.push({atMs,value:raw.length<=2400?structuredClone(value):{truncated:true,excerpt:raw.slice(0,2400)}});while(this.outputs.length>4){this.outputs.shift();this.discarded++;}}
 constructor(private readonly recentLimit=6,private readonly anchorLimit=4,private readonly evidenceLimit=4){
  if([recentLimit,anchorLimit,evidenceLimit].some(n=>!Number.isInteger(n)||n<1||n>32))throw Error('Invalid working context capacity');
 }
 observe(observation:SpatialObservation){
  if(!observation.id||!Number.isFinite(observation.atMs))throw Error('Invalid current observation');
  if(this.current&&observation.atMs<this.current.atMs)throw Error('Out-of-order context observation');
  if(this.current?.id===observation.id){if(JSON.stringify(this.current)!==JSON.stringify(observation))throw Error('Observation identity changed');return;}
  this.current=structuredClone(observation);this.retrieved=[];
  const cutoff=observation.atMs-60000;this.recent=this.recent.filter(e=>e.atMs>=cutoff);this.anchors=this.anchors.filter(e=>e.atMs>=cutoff);this.outputs=this.outputs.filter(e=>e.atMs>=cutoff);
 }
 commitHistorical(judgment:ContextJudgment){this.commit(judgment,true);}
 commit(judgment:ContextJudgment,historical=false){
  if(!this.current||(!historical&&(judgment.observationId!==this.current.id||judgment.atMs!==this.current.atMs))||judgment.atMs>this.current.atMs||!judgment.reason.trim()||!judgment.sourceIds.includes(judgment.observationId))throw Error('Judgment must address current observation with provenance');
  const entry={...structuredClone(judgment),reason:judgment.reason.slice(0,400),sourceIds:[...new Set(judgment.sourceIds)].slice(0,8)};
  this.recent=this.recent.filter(e=>e.observationId!==entry.observationId);this.recent.push(entry);
  // Keep one older source-backed anchor per concrete place, never by category name.
  this.anchors=this.anchors.filter(e=>e.observationId!==entry.observationId);
  if(entry.placeId!==null&&!this.anchors.some(e=>e.placeId===entry.placeId))this.anchors.push(entry);
  while(this.recent.length>this.recentLimit){this.recent.shift();this.discarded++;}
  while(this.anchors.length>this.anchorLimit){this.anchors.shift();this.discarded++;}
 }
 retrieve(evidence:ContextEvidence,inspected:ReadonlySet<string>){
  if(!this.current||evidence.atMs>this.current.atMs||!inspected.has(evidence.id))throw Error('Only causally inspected evidence may enter context');
  this.retrieved=this.retrieved.filter(e=>e.id!==evidence.id);this.retrieved.push({...structuredClone(evidence),reason:evidence.reason.slice(0,400)});
  while(this.retrieved.length>this.evidenceLimit){this.retrieved.shift();this.discarded++;}
 }
 view():SpatialContextView{
  return structuredClone({version:1,current:this.current,location:[...this.recent].reverse().find(e=>e.observationId===this.current?.id)??null,recent:this.recent,anchors:this.anchors,retrieved:this.retrieved,outputs:this.outputs,compression:{discarded:this.discarded,policy:'recent-and-place-anchors',rawMemoryDeleted:false}});
 }
}
