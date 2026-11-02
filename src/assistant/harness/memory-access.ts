import type {SpatialObservation} from '../../agent/incremental-spatial-memory.js';
import type {MemoryEntry} from '../causal-context-question.js';

/** Mechanical, snapshot-scoped access. No question, semantic target or task classification. */
export class MemoryAccess {
 readonly returned=new Map<string,MemoryEntry>();
 readonly read=new Map<string,MemoryEntry>();
 readonly inspected=new Map<string,SpatialObservation>();
 constructor(readonly records:MemoryEntry[],public cutoff:number,readonly observation:(id:string)=>SpatialObservation){}
 advance(records:MemoryEntry[],cutoff:number){
  if(cutoff<this.cutoff||this.records.some(old=>!records.some(r=>r.memoryRef===old.memoryRef&&r.observationId===old.observationId&&r.atMs===old.atMs&&r.text===old.text)))throw Error('Live memory source regression or mutation');
  this.records.splice(0,this.records.length,...records);this.cutoff=cutoff;
 }
 select(value:unknown,max=12,allowed=this.read){
  if(!Array.isArray(value)||!value.length||value.length>max||new Set(value).size!==value.length||value.some(r=>typeof r!=='string'||!allowed.has(r)))throw Error(`Use 1-${max} distinct delivered references from the correct namespace`);
  return value.map(ref=>allowed.get(ref)!);
 }
 async execute(a:any){
  const after=a.afterMs??0,before=a.beforeMs??this.cutoff;
  if(!Number.isFinite(after)||!Number.isFinite(before)||after<0||before<after||before>this.cutoff)throw Error(`Time range must be within [0, ${this.cutoff}]; omit unknown bounds to use the available range`);
  const range=this.records.filter(r=>r.atMs>=after&&r.atMs<=before),cursor=a.cursor??0;
  if(!Number.isInteger(cursor)||cursor<0)throw Error('Invalid pagination cursor');
  const deliver=(page:MemoryEntry[],full:boolean)=>{for(const r of page){this.returned.set(r.memoryRef,r);if(full)this.read.set(r.memoryRef,r);}return page;};
  if(a.op==='timeline'||a.op==='find'){
   let hits=range;
   if(a.op==='find'){
    if(!Array.isArray(a.terms)||!a.terms.length||a.terms.length>6||a.terms.some((t:any)=>typeof t!=='string'||!t.trim()||t.length>80)||!['any','all'].includes(a.match??'any'))throw Error('Expected 1-6 literal terms and any/all');
    const terms:string[]=a.terms.map((t:string)=>t.toLowerCase());hits=range.filter(r=>(a.match==='all'?terms.every(t=>r.text.toLowerCase().includes(t)):terms.some(t=>r.text.toLowerCase().includes(t))));
   }
   const n=a.op==='timeline'?48:12,page=hits.slice(cursor,cursor+n),samples=a.op==='timeline'?page.filter((_,i)=>i%4===0||i===page.length-1):page;
   return {previews:deliver(samples,false).map(r=>({...r,text:r.text.slice(0,240)})),total: hits.length,nextCursor:cursor+page.length<hits.length?cursor+page.length:null,scope:'Preview only; zero text matches do not establish absence'};
  }
  if(a.op==='coverage')return {available:range.length,read:range.filter(r=>this.read.has(r.memoryRef)).length,inspected:range.filter(r=>this.inspected.has(r.observationId)).length,unread:range.filter(r=>!this.read.has(r.memoryRef)).slice(0,24).map(r=>({memoryRef:r.memoryRef,atMs:r.atMs})),semanticCoverageCertified:false};
  let page:MemoryEntry[];
  if(a.op==='read')page=range.slice(cursor,cursor+24);
  else if(a.op==='recall'||a.op==='inspect'){
   if(!Array.isArray(a.memoryRefs))throw Error('memoryRefs must be an array of returned memory-v references; memoryRef is only for around');
   page=this.select(a.memoryRefs,a.op==='inspect'?3:12,this.returned);
  }
  else if(a.op==='around'){
   const record=this.returned.get(a.memoryRef),left=a.before??6,right=a.after??6;
   if(!record||!Number.isInteger(left)||!Number.isInteger(right)||left<0||right<0||left>12||right>12)throw Error('Expected returned reference and 0-12 neighboring records');
   const i=this.records.indexOf(record);page=this.records.slice(Math.max(0,i-left),i+right+1);
  }else throw Error('Unknown memory operation');
  deliver(page,true);
  if(a.op==='inspect')for(const r of page){const original=this.observation(r.observationId);if(original.atMs!==r.atMs)throw Error('Original clock mismatch');this.inspected.set(original.id,original);}
  return {records:page,...a.op==='read'?{nextCursor:cursor+page.length<range.length?cursor+page.length:null,rangeRecords:range.length}:{},semanticCoverageCertified:false};
 }
}
