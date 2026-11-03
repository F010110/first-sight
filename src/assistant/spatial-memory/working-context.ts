import type {Observation,StoredState,HistoryRecord,WorkingContext,Location} from './contracts.js';

/** Ephemeral working memory, never rebuilt by sweeping the long-term archive. */
export class SpatialWorkingMemory{
 private current:Observation|null=null;
 private recent:StoredState[]=[];
 private anchors:StoredState[]=[];
 private retrieved:HistoryRecord[]=[];
 private pendingLocation:Location|null=null;
 private summary:WorkingContext['summary'];
 private unresolved:string[]=[];
 private awaiting=false;
 constructor(private horizonMs=60000,private recentLimit=6,private anchorLimit=4,private retrievedLimit=4){}
  begin(row:Observation,reassessment=false){
   if(this.current&&(row.atMs<this.current.atMs||row.atMs===this.current.atMs&&!reassessment))throw Error('Working memory time regression');
   this.current=structuredClone(row);this.retrieved=[];this.pendingLocation=null;this.awaiting=true;
   const evicted=this.recent.filter(s=>s.atMs<row.atMs-this.horizonMs);
   this.summarize(evicted);
   this.recent=this.recent.filter(s=>s.atMs>=row.atMs-this.horizonMs);
   this.anchors=this.anchors.filter(s=>s.atMs>=row.atMs-this.horizonMs);
 }
 view():WorkingContext{
  if(!this.current)throw Error('No active observation');
  const state=this.recent.find(s=>s.observationId===this.current!.id);
   return structuredClone({current:{id:this.current.id,atMs:this.current.atMs},location:this.awaiting?this.pendingLocation:state?.assessment.location??this.pendingLocation,recent:this.recent,anchors:this.anchors,retrieved:this.retrieved,...this.summary?{summary:this.summary}:{},unresolved:this.unresolved});
 }
  evaluate(location:Location){if(!this.current)throw Error('No active observation');this.pendingLocation=structuredClone(location);}
  reconcile(state:StoredState){
   if(!this.current||state.atMs>=this.current.atMs)throw Error('Only historical interpretations can refresh current working references');
   const present=this.recent.some(s=>s.observationId===state.observationId)||this.anchors.some(s=>s.observationId===state.observationId);
   if(!present)return; // Never rebuild expired/cold working context from the archive.
   this.recent=this.recent.map(s=>s.observationId===state.observationId?structuredClone(state):s);
   this.anchors=this.anchors.filter(s=>s.observationId!==state.observationId);
   if(state.assessment.location.placeId&&!this.anchors.some(s=>s.assessment.location.placeId===state.assessment.location.placeId))this.anchors.push(structuredClone(state));
   this.anchors=this.anchors.slice(-this.anchorLimit);
  }
 deliver(records:HistoryRecord[]){
  if(!this.current||records.some(r=>r.atMs>=this.current!.atMs))throw Error('Future working evidence');
  for(const r of records){this.retrieved=this.retrieved.filter(v=>v.observationId!==r.observationId);this.retrieved.push(structuredClone(r));}
  this.retrieved=this.retrieved.slice(-this.retrievedLimit);
 }
  commit(state:StoredState){
   if(!this.current||state.observationId!==this.current.id||state.atMs!==this.current.atMs)throw Error('Working commit mismatch');
   this.awaiting=false;
  for(const revision of state.assessment.revisions??[]){
   for(const item of [...this.recent,...this.anchors])if(item.observationId===revision.observationId)item.assessment.location=structuredClone(revision.location);
   for(const record of this.retrieved)if(record.observationId===revision.observationId)record.location=structuredClone(revision.location);
  }
  this.anchors=this.anchors.filter((s,i,all)=>s.assessment.location.placeId!==null&&all.findIndex(a=>a.assessment.location.placeId===s.assessment.location.placeId)===i);
   this.recent=this.recent.filter(s=>s.observationId!==state.observationId);this.recent.push(structuredClone(state));this.summarize(this.recent.slice(0,-this.recentLimit));this.recent=this.recent.slice(-this.recentLimit);
  const place=state.assessment.location.placeId;
  if(place&&!this.anchors.some(s=>s.assessment.location.placeId===place))this.anchors.push(structuredClone(state));
   this.anchors=this.anchors.slice(-this.anchorLimit);
   this.unresolved=structuredClone(state.assessment.unresolved);
   // Versioned deterministic working projection; durable records remain untouched.
   if(JSON.stringify(this.view()).length>24000){
    this.summarize(this.recent.slice(0,-2));this.recent=this.recent.slice(-2);this.anchors=this.anchors.slice(-2);this.retrieved=this.retrieved.slice(-2);
    for(const s of [...this.recent,...this.anchors]){
     if(s.facts)s.facts={summary:s.facts.summary.slice(0,400),details:s.facts.details.slice(-3).map(d=>d.slice(0,240))};
     s.assessment.location.reason=s.assessment.location.reason.slice(0,400);
     s.assessment.hypotheses=s.assessment.hypotheses.slice(-2).map(v=>v.slice(0,240));
     s.assessment.unresolved=s.assessment.unresolved.slice(-4).map(v=>v.slice(0,240));
     s.assessment.relations=s.assessment.relations.slice(-2).map(r=>({...r,reason:r.reason.slice(0,160)}));
     if(s.assessment.revisions)s.assessment.revisions=s.assessment.revisions.map(r=>({...r,location:{...r.location,reason:r.location.reason.slice(0,160)}}));
     if(s.window)for(const o of s.window.observations)if(o.facts)o.facts={summary:o.facts.summary.slice(0,240),details:[]};
    }
    this.unresolved=this.unresolved.slice(-4).map(v=>v.slice(0,240));
    this.retrieved=this.retrieved.map(r=>{const {window,...record}=r;return {...record,facts:r.facts?{summary:r.facts.summary.slice(0,240),details:[]}:null};});
   }
 }
  restore(row:Observation,view:WorkingContext,retainCurrentDeliveries=false){
  if(this.current||row.id!==view.current.id||row.atMs!==view.current.atMs||view.recent.some(s=>s.atMs>row.atMs)||view.anchors.some(s=>s.atMs>row.atMs))throw Error('Invalid explicit working checkpoint');
   this.current=structuredClone(row);this.recent=structuredClone(view.recent);this.anchors=structuredClone(view.anchors);this.retrieved=retainCurrentDeliveries?structuredClone(view.retrieved):[];this.summary=structuredClone(view.summary);this.unresolved=structuredClone(view.unresolved??[]);
  }
 private summarize(states:StoredState[]){
  if(!states.length)return;
  this.summary={policy:'spatial-working-extractive-v1-24000chars-tail2',text:[this.summary?.text??'',...states.map(s=>`${s.observationId}@${s.atMs}: ${s.assessment.location.name}; ${s.assessment.location.reason.slice(0,160)}`)].join('\n').slice(-1600),sourceIds:[...new Set([...(this.summary?.sourceIds??[]),...states.map(s=>s.observationId)])].slice(-32),throughAtMs:states.at(-1)!.atMs};
 }
}
