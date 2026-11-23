import {createHash} from 'node:crypto';
import type {SpatialJsonImage} from './spatial-json-vlm.js';

export interface RoutePose {atMs:number;x:number;y:number;z:number;yawDeg:number;frameId:string;recordingId:string;source:'ideal-pose-experiment'|'measured-pose'}
export interface PlaceVisit {id:string;atMs:number;placeId:string|null;name:string|null;images:SpatialJsonImage[]}
export interface PoseRouteEdge {id:string;kind:'within-place'|'between-place';from:string;to:string;fromVisitId:string;toVisitId:string;samples:RoutePose[];reversible:boolean;distanceM:number}
export type RouteTurn='straight'|'left'|'right'|'reverse';
export interface RouteMovement {index:number;turn:RouteTurn;distanceM:number;bearingDeg:number}
export interface Traversal {edgeId:string;direction:'forward'|'reverse';from:string;to:string;fromVisitId:string;toVisitId:string;startHeadingDeg:number;samples:RoutePose[];movements:RouteMovement[];fingerprint:string}
interface CachedDescription {fingerprint:string;edgeId:string;direction:'forward'|'reverse';startHeadingDeg:number;value:unknown}
export interface PoseRouteSnapshot {schema:'pose-route-topology-v1';poses:RoutePose[];visits:PlaceVisit[];oneWayEdges:string[];descriptions:CachedDescription[];policy:{maxPoseGapMs:number;joinToleranceM:number}}
export function angleDifference(from:number,to:number){return ((to-from+180)%360+360)%360-180;}
export function routeTurn(from:number,to:number):RouteTurn{const d=angleDifference(from,to);return Math.abs(d)<=25?'straight':Math.abs(d)>=155?'reverse':d>0?'right':'left';}
const distance=(a:RoutePose,b:RoutePose)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validText=(s:unknown):s is string=>typeof s==='string'&&s.trim().length>0;

/** Geometry stays outside the place recognizer. NED yaw degrees, positive right. */
export class PoseRouteTopology {
 private poses:RoutePose[]=[];
 private visits:PlaceVisit[]=[];
 private oneWay=new Set<string>();
 private descriptions=new Map<string,CachedDescription>();
 constructor(readonly maxPoseGapMs=150,readonly joinToleranceM=.25){if(!Number.isFinite(maxPoseGapMs)||maxPoseGapMs<=0||!Number.isFinite(joinToleranceM)||joinToleranceM<0)throw Error('Invalid route policy');}
 ingestPose(p:RoutePose){
  const last=this.poses.at(-1);
  if(!p||![p.atMs,p.x,p.y,p.z,p.yawDeg].every(Number.isFinite)||!validText(p.frameId)||!validText(p.recordingId)||!['ideal-pose-experiment','measured-pose'].includes(p.source)||last&&p.atMs<=last.atMs)throw Error('Invalid/noncausal pose');
  this.poses.push(structuredClone(p));
 }
 validateVisit(v:PlaceVisit){
  if(!v||!validText(v.id)||!Number.isFinite(v.atMs)||this.visits.some(x=>x.id===v.id)||this.visits.at(-1)&&v.atMs<=this.visits.at(-1)!.atMs||!this.poses.some(p=>p.atMs===v.atMs)||v.placeId!==null&&(!validText(v.placeId)||!validText(v.name))||!Array.isArray(v.images)||v.images.length<1||v.images.length>3||v.images.some(i=>i.id!==v.id||!validText(i.path)||!validText(i.sha256)||!validText(i.direction)))throw Error('Invalid/noncausal place visit or missing endpoint pose');
  if(v.placeId&&this.visits.some(x=>x.placeId===v.placeId&&x.name!==v.name))throw Error('Place cannot silently rename');
 }
 recordVisit(v:PlaceVisit){this.validateVisit(v);this.visits.push(structuredClone(v));}
 nodes(){const nodes=new Map<string,{id:string;name:string;status:'fixed-model-candidate';visits:PlaceVisit[]}>();for(const v of this.visits)if(v.placeId){if(!nodes.has(v.placeId))nodes.set(v.placeId,{id:v.placeId,name:v.name!,status:'fixed-model-candidate',visits:[]});nodes.get(v.placeId)!.visits.push(structuredClone(v));}return [...nodes.values()];}
 edges():PoseRouteEdge[]{
  const edges:PoseRouteEdge[]=[];let anchor:PlaceVisit|null=null;
  for(const visit of this.visits){
   if(!visit.placeId)continue;
   if(!anchor){anchor=visit;continue;}
   const samples=this.poses.filter(p=>p.atMs>=anchor!.atMs&&p.atMs<=visit.atMs);
   const continuous=samples.length>=2&&samples.every((p,i)=>!i||(p.atMs-samples[i-1]!.atMs<=this.maxPoseGapMs&&p.frameId===samples[i-1]!.frameId&&p.recordingId===samples[i-1]!.recordingId&&p.source===samples[i-1]!.source));
   if(!continuous){anchor=visit;continue;}
   const id=`edge-${anchor.id}-${visit.id}`;
   edges.push({id,kind:visit.placeId===anchor.placeId?'within-place':'between-place',from:anchor.placeId!,to:visit.placeId,fromVisitId:anchor.id,toVisitId:visit.id,samples:structuredClone(samples),reversible:!this.oneWay.has(id),distanceM:samples.slice(1).reduce((s,p,i)=>s+distance(samples[i]!,p),0)});
   anchor=visit;
  }
  return edges;
 }
 setReversible(edgeId:string,value:boolean){if(!this.edges().some(e=>e.id===edgeId))throw Error('Unknown edge');if(value)this.oneWay.delete(edgeId);else this.oneWay.add(edgeId);for(const [key,d] of this.descriptions)if(d.edgeId===edgeId)this.descriptions.delete(key);}
 traversal(edgeId:string,direction:'forward'|'reverse',initialHeading?:number):Traversal{
  const edge=this.edges().find(e=>e.id===edgeId);if(!edge||direction==='reverse'&&!edge.reversible)throw Error('Unknown/one-way route edge');
  const reverse=direction==='reverse',samples=structuredClone(reverse?[...edge.samples].reverse():edge.samples);
  // Reverse sample order, NEVER pretend recorded camera yaw rotates by 180 degrees.
  const startHeadingDeg=initialHeading??samples[0]!.yawDeg;if(!Number.isFinite(startHeadingDeg))throw Error('Invalid initial heading');
  return {edgeId,direction,from:reverse?edge.to:edge.from,to:reverse?edge.from:edge.to,fromVisitId:reverse?edge.toVisitId:edge.fromVisitId,toVisitId:reverse?edge.fromVisitId:edge.toVisitId,startHeadingDeg,samples,movements:movementSummary(samples,startHeadingDeg),fingerprint:hash({edge,direction,startHeadingDeg})};
 }
 plan(fromVisitId:string,goalPlaceId:string):Traversal[]{
  const start=this.visits.find(v=>v.id===fromVisitId);if(!start?.placeId||!this.nodes().some(n=>n.id===goalPlaceId))throw Error('Unknown route start/goal');
  if(start.placeId===goalPlaceId)return [];
  const startPose=this.poses.find(p=>p.atMs===start.atMs)!;
  const outgoing=this.edges().flatMap(e=>[this.traversal(e.id,'forward'),...(e.reversible?[this.traversal(e.id,'reverse')]:[])]);
  const queue:Array<{place:string;pose:RoutePose;steps:Traversal[];cost:number}>=[{place:start.placeId,pose:startPose,steps:[],cost:0}],best=new Map<string,number>();
  while(queue.length){
   queue.sort((a,b)=>a.cost-b.cost);const state=queue.shift()!;
   const key=hash([state.place,state.pose.x,state.pose.y,state.pose.z,state.pose.frameId,state.pose.recordingId]);
   if((best.get(key)??Infinity)<=state.cost)continue;best.set(key,state.cost);
   if(state.place===goalPlaceId){let heading=startPose.yawDeg;return state.steps.map(step=>{const oriented=this.traversal(step.edgeId,step.direction,heading);heading=oriented.movements.at(-1)?.bearingDeg??heading;return oriented;});}
   for(const e of outgoing){const first=e.samples[0]!,last=e.samples.at(-1)!;
    if(e.from!==state.place||first.frameId!==state.pose.frameId||first.recordingId!==state.pose.recordingId||distance(first,state.pose)>this.joinToleranceM)continue;
    const cost=state.cost+e.samples.slice(1).reduce((s,p,i)=>s+distance(e.samples[i]!,p),0)+.001;
    queue.push({place:e.to,pose:last,steps:[...state.steps,e],cost});
   }
  }
  throw Error('No continuous recorded route from this visit anchor; same place does not imply same position');
 }
 evidence(step:Traversal){const first=step.samples[0]!.atMs,last=step.samples.at(-1)!.atMs,mid=(first+last)/2;const between=this.visits.filter(v=>v.atMs>=Math.min(first,last)&&v.atMs<=Math.max(first,last));const middle=[...between].sort((a,b)=>Math.abs(a.atMs-mid)-Math.abs(b.atMs-mid))[0];const ids=new Set([step.fromVisitId,step.toVisitId,...middle?[middle.id]:[]]);return this.visits.filter(v=>ids.has(v.id)).flatMap(v=>structuredClone(v.images));}
 getDescription(step:Traversal){return structuredClone(this.descriptions.get(step.fingerprint)?.value??null);}
 storeDescription(step:Traversal,value:unknown){if(this.traversal(step.edgeId,step.direction,step.startHeadingDeg).fingerprint!==step.fingerprint)throw Error('Stale edge description');this.descriptions.set(step.fingerprint,{fingerprint:step.fingerprint,edgeId:step.edgeId,direction:step.direction,startHeadingDeg:step.startHeadingDeg,value:structuredClone(value)});}
 snapshot():PoseRouteSnapshot{return structuredClone({schema:'pose-route-topology-v1',poses:this.poses,visits:this.visits,oneWayEdges:[...this.oneWay],descriptions:[...this.descriptions.values()],policy:{maxPoseGapMs:this.maxPoseGapMs,joinToleranceM:this.joinToleranceM}});}
 static restore(s:PoseRouteSnapshot){
  if(s?.schema!=='pose-route-topology-v1')throw Error('Invalid pose graph schema');
  const g=new PoseRouteTopology(s.policy.maxPoseGapMs,s.policy.joinToleranceM);for(const p of s.poses)g.ingestPose(p);for(const v of s.visits)g.recordVisit(v);for(const id of s.oneWayEdges)g.setReversible(id,false);
  for(const d of s.descriptions){const step=g.traversal(d.edgeId,d.direction,d.startHeadingDeg);if(step.fingerprint!==d.fingerprint)throw Error('Stale cached route');g.descriptions.set(d.fingerprint,structuredClone(d));}return g;
 }
}

/** RDP removes small measurement jitter; explicit max error 0.5m, not a trained motion model. */
export function movementSummary(samples:RoutePose[],initialHeading=samples[0]?.yawDeg??0):RouteMovement[]{
 if(samples.length<2)return [];
 const simplify=(points:RoutePose[]):RoutePose[]=>{
  if(points.length<3)return points;const a=points[0]!,b=points.at(-1)!,dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
  let max=.5,index=-1;
  for(let i=1;i<points.length-1;i++){const p=points[i]!,t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0,d=Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);if(d>max){max=d;index=i;}}
  return index<0?[a,b]:[...simplify(points.slice(0,index+1)).slice(0,-1),...simplify(points.slice(index))];
 };
 const points=simplify(samples),result:RouteMovement[]=[];let heading=initialHeading;
 for(let i=1;i<points.length;i++){const a=points[i-1]!,b=points[i]!,length=Math.hypot(b.x-a.x,b.y-a.y);if(length<.2)continue;const bearing=(Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI+360)%360;result.push({index:result.length,turn:routeTurn(heading,bearing),distanceM:Math.round(length),bearingDeg:Math.round(bearing)});heading=bearing;}
 return result;
}
