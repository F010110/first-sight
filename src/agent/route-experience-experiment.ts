import type {SpatialJsonImage, SpatialJsonRequest} from './spatial-json-vlm.js';

/** Privileged experimental input, NEVER a production sensor contract. XY metres, CCW yaw radians. */
export interface IdealPose {x:number;y:number;yaw:number;frameId:string;source:'ideal_pose_experiment'}
export interface RouteObservation {id:string;atMs:number;images:SpatialJsonImage[];pose:IdealPose}
export interface CoarseMotion {source:'ideal_pose_experiment';translation:'stationary'|'short'|'medium'|'long';turn:'straight'|'left'|'right'|'reverse';headingAvailable:true}
export interface RouteExperience {observation:RouteObservation;motion:CoarseMotion|null;placeId:string|null;description:string}
export interface RouteExperimentState {version:1;mode:'ideal-pose-experiment';sequence:RouteExperience[]}
type Model=(request:SpatialJsonRequest)=>Promise<unknown>;
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=600;
export function validateRouteObservation(o:RouteObservation){
 if(!o||!text(o.id)||!Number.isFinite(o.atMs)||!o.pose||o.pose.source!=='ideal_pose_experiment'||!text(o.pose.frameId)||![o.pose.x,o.pose.y,o.pose.yaw].every(Number.isFinite)||!Array.isArray(o.images)||o.images.length<1||o.images.length>3||o.images.some(i=>i.id!==o.id||!text(i.path)||!text(i.direction)||!text(i.sha256)))throw Error('Invalid experimental observation/pose/images');
}
export function coarseMotion(a:IdealPose,b:IdealPose):CoarseMotion{
 if(a.frameId!==b.frameId)throw Error('Pose frame changed');
 const distance=Math.hypot(b.x-a.x,b.y-a.y),yaw=Math.atan2(Math.sin(b.yaw-a.yaw),Math.cos(b.yaw-a.yaw)),degrees=yaw*180/Math.PI;
 return {source:'ideal_pose_experiment',translation:distance<.2?'stationary':distance<2?'short':distance<8?'medium':'long',turn:Math.abs(degrees)<25?'straight':Math.abs(degrees)>150?'reverse':degrees>0?'left':'right',headingAvailable:true};
}
/** Canonical memory is the append-only sequence; no graph image or automatic coordinate clustering. */
export class RouteExperienceExperiment {
 private state:RouteExperimentState={version:1,mode:'ideal-pose-experiment',sequence:[]};
 constructor(private readonly model:Model,saved?:RouteExperimentState){
  if(saved){
   if(saved.version!==1||saved.mode!=='ideal-pose-experiment'||!Array.isArray(saved.sequence))throw Error('Invalid experiment snapshot');
   const seen=new Set<string>();let previous:RouteExperience|undefined;
   for(const e of saved.sequence){validateRouteObservation(e.observation);if(seen.has(e.observation.id)||(previous&&e.observation.atMs<=previous.observation.atMs)||!text(e.description)||(e.placeId!==null&&!text(e.placeId))||JSON.stringify(e.motion)!==JSON.stringify(previous?coarseMotion(previous.observation.pose,e.observation.pose):null))throw Error('Invalid sequence');seen.add(e.observation.id);previous=e;}
   this.state=structuredClone(saved);
  }
 }
 snapshot(){return structuredClone(this.state);}
 observationRequest(o:RouteObservation):SpatialJsonRequest{
  validateRouteObservation(o);
  const last=this.state.sequence.at(-1);
  if(this.state.sequence.some(e=>e.observation.id===o.id)||last&&o.atMs<=last.observation.atMs)throw Error('Duplicate or noncausal observation');
  const motion=last?coarseMotion(last.observation.pose,o.pose):null;
  const recent=this.state.sequence.slice(-2),anchors=this.state.sequence.filter(e=>e.placeId!==null&&!recent.includes(e)).slice(-1);
  const evidence=[...anchors,...recent];
  return {phase:'identity',prompt:'你是视障辅助路线记忆实验。按时间理解实际经历，不读图形拓扑。运动来自理想位姿的粗摘要，不是IMU，也不是地点真值；short/medium/long仅是采样间端点位移分档，不是路径长度。turn是相机朝向净变化，不证明转弯位置、身体朝向或可通行。用当前和历史原图判断地点；相似或运动连续不足以确认同地。只输出JSON：decision为new/same/uncertain；placeId仅same时为已提供候选ID，否则null；description为当前可见地点描述；sourceIds为实际引用的观察ID，必须包含当前ID。不要输出坐标。',data:{current:{id:o.id,atMs:o.atMs},motion,history:evidence.map(e=>({id:e.observation.id,atMs:e.observation.atMs,placeId:e.placeId,description:e.description,motion:e.motion})),candidates:[...new Set(evidence.flatMap(e=>e.placeId?[e.placeId]:[]))]},images:[...o.images,...evidence.flatMap(e=>e.observation.images)].slice(0,12)};
 }
 async observe(o:RouteObservation){
  const request=this.observationRequest(o),v=await this.model(request) as any;
  const ids=new Set(request.images.map(i=>i.id)),candidates=(request.data as any).candidates as string[];
  if(!v||!['same','new','uncertain'].includes(v.decision)||!text(v.description)||!Array.isArray(v.sourceIds)||!v.sourceIds.includes(o.id)||new Set(v.sourceIds).size!==v.sourceIds.length||v.sourceIds.some((id:unknown)=>!ids.has(id as string))||(v.decision==='same'? !candidates.includes(v.placeId)||!this.state.sequence.some(e=>e.placeId===v.placeId&&v.sourceIds.includes(e.observation.id)):v.placeId!==null))throw Error('Invalid place proposal/evidence');
  const previous=this.state.sequence.at(-1);
  const entry:RouteExperience={observation:structuredClone(o),motion:previous?coarseMotion(previous.observation.pose,o.pose):null,placeId:v.decision==='new'?`place-${this.state.sequence.length}`:v.placeId,description:v.description};
  this.state.sequence.push(entry);return structuredClone(entry);
 }
 /** Select an actual directed recorded sequence, not a shortest path through inferred edges. */
 routeRequest(fromObservationId:string,toObservationId:string):SpatialJsonRequest{
  const start=this.state.sequence.findIndex(e=>e.observation.id===fromObservationId),end=this.state.sequence.findIndex(e=>e.observation.id===toObservationId);
  if(start<0||end<=start)throw Error('Route must follow a recorded forward sequence');
  const entries=this.state.sequence.slice(start,end+1);
  if(entries.length>4||entries.some(e=>e.placeId===null))throw Error('Route unresolved or exceeds evidence budget; select a shorter segment');
  return {phase:'identity',prompt:'根据记录的正向通行经历生成中文路线回顾，不是实时安全导航。只输出JSON：description字符串、sourceIds观察ID数组。逐步用可见地标解释，标明当前朝向和通行状态尚未确认。不得把相机转动等同身体左转，不报精确距离，不编造障碍物安全性，不把历史路线当当前可通行保证。输入不含精确位姿。',data:{current:{id:entries.at(-1)!.observation.id},task:'describe-recorded-route-not-live-guidance',sequence:entries.map((e,i)=>({id:e.observation.id,placeId:e.placeId,description:e.description,motion:i===0?null:e.motion}))},images:entries.flatMap(e=>e.observation.images)};
 }
 async describeRoute(from:string,to:string){
  const request=this.routeRequest(from,to),v=await this.model(request) as any,ids=new Set(request.images.map(i=>i.id));
  if(!v||!text(v.description)||!Array.isArray(v.sourceIds)||v.sourceIds.length!==ids.size||new Set(v.sourceIds).size!==ids.size||v.sourceIds.some((id:unknown)=>!ids.has(id as string)))throw Error('Invalid route evidence');
  return {description:v.description,sourceIds:v.sourceIds as string[],status:'historical-route-unverified-for-live-use' as const};
 }
}
