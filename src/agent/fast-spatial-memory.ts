import type {SpatialJsonRequest,SpatialJsonImage} from './spatial-json-vlm.js';
import {visualDistance} from './spatial-visual-recall.js';

export type FastObservation={id:string;atMs:number;views:SpatialJsonImage[];features:number[][]};
type Place={id:string;name:string;representative:FastObservation;lastSeenMs:number;members:string[]};
export type FastDecision={observationId:string;visibleFacts:string[];relation:'new'|'candidate'|'uncertain';candidateId:string|null;name:string;reason:string;sourceIds:string[]};
export const fastSpatialPrompt=`根据CURRENT原图同时记录当前可见事实和地点候选。参考图仅是各候选的代表视图，不是全部历史成员；不能声称完整组核查通过。当前事实必须独立于历史；不得按时间最近、名字、同款家具或缺少共同视野确认同一房间。不确定时uncertain。候选关联尚未确认，不是地点真值。只输出JSON：{"observationId":"当前ID","visibleFacts":["当前原图直接可见的事实"],"relation":"new或candidate或uncertain","candidateId":"输入候选ID或null","name":"当前区域简短名称","reason":"视觉依据及限制","sourceIds":["当前及实际支持判断的参考观察ID"]}。new表示提出新地点假设，不证明与所有未检索历史不同。`;

/** Experimental one-request updates. Representative matches never become confirmed membership. */
export class FastSpatialMemory{
 private places:Place[]=[];private last=-Infinity;private busy=false;
 private pendingReview=new Map<string,{observationId:string;candidateId:string;reason:string}>();
 private reviewDropped=0;
 readonly decisions:FastDecision[]=[];
 constructor(private request:(r:SpatialJsonRequest)=>Promise<unknown>,private reviewCapacity=8){
  if(!Number.isInteger(reviewCapacity)||reviewCapacity<1)throw Error('Invalid review capacity');
 }
 snapshot(){return structuredClone({places:this.places,decisions:this.decisions,reviews:[...this.pendingReview.values()],reviewDropped:this.reviewDropped,reviewExecution:'not-implemented',verifiedAssociations:0});}
 async observe(current:FastObservation){
  if(this.busy||!current.id||current.atMs<=this.last||!Number.isFinite(current.atMs)||!current.views.length||current.views.length>3||this.decisions.some(d=>d.observationId===current.id)||current.views.some(v=>v.id!==current.id)||current.features.length!==current.views.length||current.features.some(f=>f.length!==72||f.some(n=>!Number.isFinite(n))))throw Error('Invalid or concurrent fast observation');
  this.busy=true;
  try{
   const ranked=this.places.map(p=>({p,d:visualDistance(current.features,p.representative.features)}));
   const recent=[...ranked].sort((a,b)=>b.p.lastSeenMs-a.p.lastSeenMs).slice(0,1);
   const visual=[...ranked].sort((a,b)=>a.d-b.d).slice(0,2);
   const candidates=[...new Map([...recent,...visual].map(r=>[r.p.id,r.p])).values()];
   const images=[...current.views,...candidates.flatMap(p=>p.representative.views)];
   const raw=await this.request({phase:'identity',prompt:fastSpatialPrompt,data:{current:{id:current.id,atMs:current.atMs},candidates:candidates.map(p=>({id:p.id,name:p.name,representativeId:p.representative.id,status:'provisional'}))},images});
   const v=raw as FastDecision;const delivered=new Set(images.map(i=>i.id));
   if(!v||v.observationId!==current.id||!['new','candidate','uncertain'].includes(v.relation)||!Array.isArray(v.visibleFacts)||!v.visibleFacts.length||v.visibleFacts.length>6||v.visibleFacts.some(x=>typeof x!=='string'||!x.trim()||x.length>500)||typeof v.name!=='string'||!v.name.trim()||v.name.length>80||typeof v.reason!=='string'||!v.reason.trim()||v.reason.length>1200||!Array.isArray(v.sourceIds)||!v.sourceIds.includes(current.id)||v.sourceIds.some(id=>!delivered.has(id))||(v.relation==='candidate'? !candidates.some(p=>p.id===v.candidateId&&v.sourceIds.includes(p.representative.id)):v.candidateId!==null))throw Error('Invalid joint decision; no hidden repair');
   if(v.relation==='new')this.places.push({id:`place-${this.places.length+1}`,name:v.name,representative:structuredClone(current),lastSeenMs:current.atMs,members:[current.id]});
   if(v.relation==='candidate'){
    const p=this.places.find(p=>p.id===v.candidateId)!;p.lastSeenMs=current.atMs;
    // Coalesce per-place verification work; never append unverified members or mutate representative.
    this.pendingReview.delete(p.id);
    this.pendingReview.set(p.id,{observationId:current.id,candidateId:p.id,reason:v.reason});
    while(this.pendingReview.size>this.reviewCapacity){this.pendingReview.delete(this.pendingReview.keys().next().value!);this.reviewDropped++;}
   }
   this.decisions.push(structuredClone(v));this.last=current.atMs;return structuredClone(v);
  }finally{this.busy=false;}
 }
}

/** Latest ordinary update plus bounded FIFO of caller-designated important events. Originals external. */
export class BoundedObservationInbox<T extends {id:string}>{
 private latest:T|null=null;private events=new Map<string,T>();private sequence=0;private order=new Map<string,number>();
 readonly dropped:Array<{id:string;reason:string}>=[];
 droppedCount=0;
 private drop(id:string,reason:string){this.order.delete(id);this.droppedCount++;this.dropped.push({id,reason});if(this.dropped.length>1000)this.dropped.shift();}
 constructor(private capacity=4){if(!Number.isInteger(capacity)||capacity<1)throw Error('Invalid capacity');}
 offer(row:T,important=false){
  if(!this.order.has(row.id))this.order.set(row.id,++this.sequence);
  if(important){
   if(this.latest?.id===row.id)this.latest=null;
   this.events.set(row.id,row);
   while(this.events.size>this.capacity){const id=this.events.keys().next().value!;this.events.delete(id);this.drop(id,'event-capacity');}
  }else if(!this.events.has(row.id)){
   if(this.latest&&this.latest.id!==row.id)this.drop(this.latest.id,'superseded');
   this.latest=row;
  }
 }
 take():T|null{
  const first=this.events.keys().next();
  if(!first.done&&(!this.latest||this.order.get(first.value)!<this.order.get(this.latest.id)!)){
   const row=this.events.get(first.value)!;this.events.delete(first.value);this.order.delete(first.value);return row;
  }
  const row=this.latest;this.latest=null;if(row)this.order.delete(row.id);return row;
 }
 get pending(){return this.events.size+(this.latest?1:0);}
}

/** Experimental image-only trigger, not a room boundary or event detector. */
export class VisualUpdateGate{
 private last:{atMs:number;features:number[][]}|null=null;
 constructor(private changeThreshold=.003,private maxIntervalMs=10000){
  if(!Number.isFinite(changeThreshold)||changeThreshold<0||!Number.isFinite(maxIntervalMs)||maxIntervalMs<=0)throw Error('Invalid visual gate');
 }
 consider(row:{atMs:number;features:number[][]},important=false){
  if(!Number.isFinite(row.atMs)||!row.features.length||row.features.some(v=>v.length!==72||v.some(n=>!Number.isFinite(n)))||this.last&&row.atMs<=this.last.atMs)throw Error('Invalid gate input');
  const distance=this.last?visualDistance(row.features,this.last.features):null;
  const reason=!this.last?'initial':important?'important-evidence':row.atMs-this.last.atMs>=this.maxIntervalMs?'heartbeat':distance!>=this.changeThreshold?'visual-change':'deferred-similar';
  const analyze=reason!=='deferred-similar';
  if(analyze)this.last=structuredClone(row);
  return {analyze,reason,distance,identityInferred:false};
 }
}

/** Opt-in worker: never blocks acquisition; archival must finish before offer(). */
export class FastSpatialWorker{
 readonly inbox=new BoundedObservationInbox<FastObservation>(4);
 private gate=new VisualUpdateGate();private running:Promise<void>|null=null;
 private closed=false;private lastOffered=-Infinity;
 constructor(private memory:FastSpatialMemory,private audit:(event:unknown)=>void=()=>{}){}
 offer(row:FastObservation,important=false){
  if(this.closed||!Number.isFinite(row.atMs)||row.atMs<=this.lastOffered)throw Error('Worker stopped or noncausal input');
  this.lastOffered=row.atMs;
  const decision=this.gate.consider(row,important);
  this.audit({kind:'trigger',id:row.id,...decision,originalArchivedExternally:true});
  if(!decision.analyze)return;
  const before=this.inbox.droppedCount;
  this.inbox.offer(structuredClone(row),important);
  if(this.inbox.droppedCount>before)this.audit({kind:'queue-drop',dropped:this.inbox.dropped.slice(-(this.inbox.droppedCount-before)),totalDropped:this.inbox.droppedCount});
  if(!this.running)this.running=this.drain().finally(()=>{this.running=null;});
 }
 private async drain(){
  while(!this.closed){
   const row=this.inbox.take();if(!row)break;
   const started=performance.now();
   try{const result=await this.memory.observe(row);this.audit({kind:'updated',id:row.id,result,elapsedMs:performance.now()-started});}
   catch(error){this.audit({kind:'failed',id:row.id,error:String(error),automaticRetry:false});}
  }
 }
 async idle(){await this.running;}
 async stop(){this.closed=true;while(this.inbox.take()){}await this.running;}
}
