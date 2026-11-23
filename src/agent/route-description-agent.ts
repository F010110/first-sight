import type {SpatialJsonRequest} from './spatial-json-vlm.js';
import {PoseRouteTopology,type Traversal,type RouteTurn} from './pose-route-topology.js';

interface SegmentLanguage {index:number;turn:RouteTurn;text:string;sourceIds:string[]}
export interface EdgeDescription {fingerprint:string;direction:'forward'|'reverse';segments:SegmentLanguage[];uncertainties:string[];status:'historical-camera-route-not-human-safe-guidance'}
const turnWords:Record<RouteTurn,string>={straight:'沿当前行进方向',left:'向左对齐行进方向',right:'向右对齐行进方向',reverse:'转向相反的行进方向'};
export class RouteDescriptionAgent {
 constructor(private readonly model:(request:SpatialJsonRequest)=>Promise<unknown>){}
 request(graph:PoseRouteTopology,step:Traversal):SpatialJsonRequest{
  return {phase:'identity',prompt:'你是独立的历史路线说明Agent，不做地点识别、路径选择或角度运算。地点和每段turn/distanceM已经由程序计算，不得改变。根据运动事件及原图写简短中文说明；地标仅在原图清楚可见时使用，无法确定就不写，不把中途未拍到的门/台阶补出来。只输出JSON：segments数组（每项index、turn逐字复制输入、text中文一句话、sourceIds实际引用图像ID数组），uncertainties字符串数组。每个运动事件恰好一项，text不报精确米数，不把历史机器人路线说成当前人体可安全通行；描述相机/行进方向而不是人体身体朝向。不输出坐标或新路径。',data:{current:{id:step.fromVisitId},direction:step.direction,from:step.from,to:step.to,movements:step.movements,note:'NED positive right; all direction arithmetic already done; historical camera alignment only; original image camera roles may differ on reverse traversal'},images:graph.evidence(step)};
 }
 validate(raw:unknown,graph:PoseRouteTopology,step:Traversal):EdgeDescription{
  const v=raw as any,delivered=new Set(graph.evidence(step).map(i=>i.id));
  if(!v||!Array.isArray(v.segments)||v.segments.length!==step.movements.length||!Array.isArray(v.uncertainties)||v.uncertainties.some((s:unknown)=>typeof s!=='string'||s.length>400))throw Error('Invalid route description schema');
  for(const [i,s] of v.segments.entries()){
   if(s?.index!==i||s.turn!==step.movements[i]!.turn||typeof s.text!=='string'||!s.text.trim()||s.text.length>500||!Array.isArray(s.sourceIds)||!s.sourceIds.length||new Set(s.sourceIds).size!==s.sourceIds.length||s.sourceIds.some((id:unknown)=>!delivered.has(id as string)))throw Error('Description altered movement or cites missing evidence');
   // A narrow contradiction check, NOT proof of full linguistic/landmark correctness.
   const wrong=s.turn==='left'?/右转|向右转/:s.turn==='right'?/左转|向左转/:s.turn==='straight'?/左转|右转|掉头/:/左转|右转/;
   if(wrong.test(s.text))throw Error('Text contradicts program turn');
  }
  return {fingerprint:step.fingerprint,direction:step.direction,segments:structuredClone(v.segments),uncertainties:structuredClone(v.uncertainties),status:'historical-camera-route-not-human-safe-guidance'};
 }
 async describe(graph:PoseRouteTopology,step:Traversal){
  const cached=graph.getDescription(step);if(cached)return this.validate(cached,graph,step);
  const result=this.validate(await this.model(this.request(graph,step)),graph,step);graph.storeDescription(step,result);return result;
 }
 render(description:EdgeDescription){return ['以下是历史记录路线说明，人体朝向和当前通行安全尚未确认。',...description.segments.map(s=>`${turnWords[s.turn]}：${s.text}`),...description.uncertainties].join('\n');}
}
