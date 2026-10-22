/** Evidence graph, NOT a metric map or navigability assertion. One recording per graph. */
export interface TopologyVisit {id:string;atMs:number;placeId:string|null;name?:string}
interface VisitEdge {from:string;to:string;kind:'observed-consecutive-transition'|'temporal-proximity-hint';count:number;minGapMs:number;maxGapMs:number;evidence:Array<{fromId:string;toId:string;fromMs:number;toMs:number}>}
export class SpatialVisitTopology {
 private visits:TopologyVisit[]=[];
 private nodes=new Map<string,{id:string;name:string;firstAtMs:number;lastAtMs:number;observations:number}>();
 private edges=new Map<string,VisitEdge>();
 private lastKnown:TopologyVisit|null=null;
 constructor(readonly maxConsecutiveGapMs=2500,readonly temporalWindowMs=30000){
  if(!Number.isFinite(maxConsecutiveGapMs)||maxConsecutiveGapMs<=0||!Number.isFinite(temporalWindowMs)||temporalWindowMs<maxConsecutiveGapMs)throw Error('Invalid topology time windows');
 }
 observe(value:TopologyVisit){
  const visit=structuredClone(value),previous=this.visits.at(-1);
  if(!visit.id||!Number.isFinite(visit.atMs)||previous&&visit.atMs<=previous.atMs||this.visits.some(v=>v.id===visit.id)||visit.placeId!==null&&(!visit.placeId||!visit.name?.trim()))throw Error('Invalid causal topology visit');
  const node=visit.placeId?this.nodes.get(visit.placeId):null;
  if(node&&node.name!==visit.name)throw Error('Topology cannot silently rename a place');
  if(visit.placeId){
   if(node){node.lastAtMs=visit.atMs;node.observations++;}
   else this.nodes.set(visit.placeId,{id:visit.placeId,name:visit.name!,firstAtMs:visit.atMs,lastAtMs:visit.atMs,observations:1});
   const last=this.lastKnown;
   if(last?.placeId&&last.placeId!==visit.placeId){
    const gap=visit.atMs-last.atMs;
    if(previous?.placeId===last.placeId&&gap<=this.maxConsecutiveGapMs)this.addEdge(last,visit,'observed-consecutive-transition');
    if(gap<=this.temporalWindowMs)this.addEdge(last,visit,'temporal-proximity-hint');
   }
   this.lastKnown=visit;
  }
  this.visits.push(visit);
 }
 private addEdge(from:TopologyVisit,to:TopologyVisit,kind:VisitEdge['kind']){
  const key=JSON.stringify([from.placeId,to.placeId,kind]),gap=to.atMs-from.atMs;
  let edge=this.edges.get(key);
  if(!edge){edge={from:from.placeId!,to:to.placeId!,kind,count:0,minGapMs:gap,maxGapMs:gap,evidence:[]};this.edges.set(key,edge);}
  edge.count++;edge.minGapMs=Math.min(edge.minGapMs,gap);edge.maxGapMs=Math.max(edge.maxGapMs,gap);
  edge.evidence.push({fromId:from.id,toId:to.id,fromMs:from.atMs,toMs:to.atMs});
 }
 snapshot(){return structuredClone({schema:'spatial-visit-topology-v1',nodes:[...this.nodes.values()],edges:[...this.edges.values()],visits:this.visits,policy:{maxConsecutiveGapMs:this.maxConsecutiveGapMs,temporalWindowMs:this.temporalWindowMs,directTraversability:'not-established',timeProvesMetricProximity:false,assignments:'model-candidates-not-ground-truth',note:'Consecutive recognized samples are transition evidence only. Unknowns and long gaps never establish a direct edge. Full visit sequence retained.'}});}
 context(asOfMs:number,groupIds:string[],includeRelations=true){
  if(!Number.isFinite(asOfMs)||this.visits.some(v=>v.atMs>=asOfMs)||new Set(groupIds).size!==groupIds.length||groupIds.length>16)throw Error('Noncausal or unbounded topology context');
  const allowed=new Set(groupIds);
  return {
   interpretation:'历史线索，不是当前身份或通行证明。连续转移仅表示相邻采样的地点变化；时间相近不证明物理距离近。图不替代下方访问序列。原图区域冲突优先，不能因有边就判同地或把两个节点合并。未列出的边只是未知，不表示不可达。',
   recentVisits:this.visits.slice(-6).map(v=>({atMs:v.atMs,groupId:v.placeId&&allowed.has(v.placeId)?v.placeId:null,status:!v.placeId?'unknown':allowed.has(v.placeId)?'candidate':'outside-recalled-candidates'})),
   places:[...this.nodes.values()].filter(n=>allowed.has(n.id)).map(n=>({groupId:n.id,name:n.name,lastVisitedMs:n.lastAtMs,relations:includeRelations?[...this.edges.values()].filter(e=>e.from===n.id&&allowed.has(e.to)).map(e=>({groupId:e.to,kind:e.kind,count:e.count,minGapMs:e.minGapMs,lastObservedMs:e.evidence.at(-1)!.toMs,directTraversability:'unknown'})):[]})),
   omittedEdges:'Only edges between recalled candidates; no graph expansion of recall',
  };
 }
}
