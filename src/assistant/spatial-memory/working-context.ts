import type {Observation,StoredState,HistoryRecord,WorkingContext,Location} from './contracts.js';

/** Ephemeral working memory, never rebuilt by sweeping the long-term archive. */
export class SpatialWorkingMemory{
 private current:Observation|null=null;
 private recent:StoredState[]=[];
 private anchors:StoredState[]=[];
 private retrieved:HistoryRecord[]=[];
 private pendingLocation:Location|null=null;
 constructor(private horizonMs=60000,private recentLimit=6,private anchorLimit=4,private retrievedLimit=4){}
 begin(row:Observation){
  if(this.current&&row.atMs<=this.current.atMs)throw Error('Working memory time regression');
  this.current=structuredClone(row);this.retrieved=[];this.pendingLocation=null;
  this.recent=this.recent.filter(s=>s.atMs>=row.atMs-this.horizonMs);
  this.anchors=this.anchors.filter(s=>s.atMs>=row.atMs-this.horizonMs);
 }
 view():WorkingContext{
  if(!this.current)throw Error('No active observation');
  const state=this.recent.find(s=>s.observationId===this.current!.id);
  return structuredClone({current:{id:this.current.id,atMs:this.current.atMs},location:state?.assessment.location??this.pendingLocation,recent:this.recent,anchors:this.anchors,retrieved:this.retrieved});
 }
 evaluate(location:Location){if(!this.current)throw Error('No active observation');this.pendingLocation=structuredClone(location);}
 deliver(records:HistoryRecord[]){
  if(!this.current||records.some(r=>r.atMs>=this.current!.atMs))throw Error('Future working evidence');
  for(const r of records){this.retrieved=this.retrieved.filter(v=>v.observationId!==r.observationId);this.retrieved.push(structuredClone(r));}
  this.retrieved=this.retrieved.slice(-this.retrievedLimit);
 }
 commit(state:StoredState){
  if(!this.current||state.observationId!==this.current.id||state.atMs!==this.current.atMs)throw Error('Working commit mismatch');
  for(const revision of state.assessment.revisions??[]){
   for(const item of [...this.recent,...this.anchors])if(item.observationId===revision.observationId)item.assessment.location=structuredClone(revision.location);
   for(const record of this.retrieved)if(record.observationId===revision.observationId)record.location=structuredClone(revision.location);
  }
  this.anchors=this.anchors.filter((s,i,all)=>s.assessment.location.placeId!==null&&all.findIndex(a=>a.assessment.location.placeId===s.assessment.location.placeId)===i);
  this.recent.push(structuredClone(state));this.recent=this.recent.slice(-this.recentLimit);
  const place=state.assessment.location.placeId;
  if(place&&!this.anchors.some(s=>s.assessment.location.placeId===place))this.anchors.push(structuredClone(state));
  this.anchors=this.anchors.slice(-this.anchorLimit);
 }
 restore(row:Observation,view:WorkingContext){
  if(this.current||row.id!==view.current.id||row.atMs!==view.current.atMs||view.recent.some(s=>s.atMs>row.atMs)||view.anchors.some(s=>s.atMs>row.atMs))throw Error('Invalid explicit working checkpoint');
  this.current=structuredClone(row);this.recent=structuredClone(view.recent);this.anchors=structuredClone(view.anchors);this.retrieved=[];
 }
}
