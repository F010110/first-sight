import type {StoredState,HistoryRecord,WorkingContext,Location} from './contracts.js';

export type SpatialSnapshot={state:StoredState;context:WorkingContext;history:HistoryRecord[];visits:Array<{placeId:string;observationIds:string[]}>;transitions:Array<{fromObservationId:string;toObservationId:string;fromPlaceId:string|null;toPlaceId:string|null}>};
export interface SpatialReader{
 latest():{state:StoredState;context:WorkingContext;current:{id:string;atMs:number};currentLocation:Location|null;pendingCurrent:boolean}|null;
 snapshotAt(version:number,knownAtMs:number):SpatialSnapshot;
 inspectAt(version:number,knownAtMs:number,ids:string[]):Promise<Array<{id:string;direction:string;path:string;sha256:string}>>;
}

/** Causal, read-only projection for user questions. No write path is exposed. */
export class SpatialQuestionView{
 private delivered=new Map<string,HistoryRecord>();
 private inspected=new Set<string>();
 private constructor(readonly version:number,readonly knownAtMs:number,private snapshot:SpatialSnapshot,private reader:SpatialReader){}
 static open(reader:SpatialReader,version:number,knownAtMs:number){
  if(!Number.isInteger(version)||version<1||!Number.isFinite(knownAtMs)||knownAtMs<0)throw Error('Invalid question spatial cutoff');
  return new SpatialQuestionView(version,knownAtMs,reader.snapshotAt(version,knownAtMs),reader);
 }
 currentLocation(){return structuredClone(this.snapshot.state.assessment.location);}
 private deliver(record:HistoryRecord){this.delivered.set(record.observationId,record);for(const member of record.window?.observations??[])this.delivered.set(member.id,record);}
 summary(){
  const s=this.snapshot,anchorPlaces=[...new Set([...s.context.anchors.map(a=>a.assessment.location.placeId),...s.history.map(r=>r.location.placeId)].filter((p):p is string=>p!==null))];
  return structuredClone({version:this.version,knownAtMs:this.knownAtMs,atMs:s.state.atMs,current:s.state.assessment.location,activeUnresolved:s.state.assessment.unresolved,recent:s.context.recent.map(r=>({observationId:r.observationId,atMs:r.atMs,location:r.assessment.location,facts:r.facts})),anchorPlaces,coverage:{historyRecords:s.history.length,textRead:0,imagesInspected:0,semanticCompleteness:false as const}});
 }
 timeline(options:{afterMs?:number;beforeMs?:number;cursor?:number}={}){
  const after=options.afterMs??0,before=options.beforeMs??this.snapshot.state.atMs,cursor=options.cursor??0;
  if(!Number.isFinite(after)||!Number.isFinite(before)||after<0||before<after||before>this.snapshot.state.atMs||!Number.isInteger(cursor)||cursor<0)throw Error('Timeline range must be inside the committed snapshot');
  const range=this.snapshot.history.filter(r=>r.atMs>=after&&r.atMs<=before),page=range.slice(cursor,cursor+24);
   for(const r of page)this.deliver(r);
   return structuredClone({records:page.map(r=>({observationId:r.observationId,atMs:r.atMs,location:r.location,facts:r.facts,windowMemberIds:r.window?.observations.map(o=>o.id)})),nextCursor:cursor+page.length<range.length?cursor+page.length:null,total:range.length,scope:'Committed spatial versions only; member IDs are sources of a window judgment, not per-frame positions; text read is not image inspection'});
 }
 find(terms:string[]){
  if(!Array.isArray(terms)||!terms.length||terms.length>6||terms.some(t=>typeof t!=='string'||!t.trim()||t.length>80))throw Error('Expected 1-6 literal terms');
  const lowered=terms.map(t=>t.toLowerCase()),hits=this.snapshot.history.filter(r=>lowered.some(t=>JSON.stringify(r).toLowerCase().includes(t)));
   const page=hits.slice(0,12);for(const r of page)this.deliver(r);
   return structuredClone({records:page.map(r=>({observationId:r.observationId,atMs:r.atMs,location:r.location,facts:r.facts,windowMemberIds:r.window?.observations.map(o=>o.id)})),total:hits.length,scope:'Literal candidates only; no match does not establish absence'});
 }
 read(ids:string[]){
  if(!Array.isArray(ids)||!ids.length||ids.length>12||new Set(ids).size!==ids.length)throw Error('Require distinct delivered observation IDs');
  const records=ids.map(id=>this.delivered.get(id));if(records.some(r=>!r))throw Error('Read requires previously delivered IDs');
  return structuredClone(records);
 }
 async inspect(ids:string[]){
  const records=this.read(ids);if(ids.length>3)throw Error('At most three historical originals per inspection');
  const images=await this.reader.inspectAt(this.version,this.knownAtMs,ids);
  if(images.length!==ids.length*3||images.some(i=>!ids.includes(i.id)))throw Error('Unexpected inspection image set');
  for(const id of ids)this.inspected.add(id);
  return structuredClone({records,images,scope:'Original historical images actually inspected; not a new spatial judgment'});
 }
 coverage(){
  return structuredClone({available:this.snapshot.history.length,delivered:this.delivered.size,inspected:this.inspected.size,semanticCompleteness:false as const,note:'Inspected current-window image is not historical inspection; absence is never certified'});
 }
}
