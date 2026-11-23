import {FixedGroupSpatialAgent} from './spatial-fixed-group-agent.js';
import {PoseRouteTopology,type PlaceVisit} from './pose-route-topology.js';
import {RouteDescriptionAgent} from './route-description-agent.js';

/** Composition only: existing fixed recognizer never receives pose or graph fields. */
export class FixedPoseRouteAssistant {
 constructor(readonly recognizer:FixedGroupSpatialAgent,readonly graph:PoseRouteTopology,readonly narrator:RouteDescriptionAgent){}
 async observe(observation:Omit<PlaceVisit,'placeId'|'name'>){
  this.graph.validateVisit({...observation,placeId:null,name:null});
  const result=await this.recognizer.observe({id:observation.id,atMs:observation.atMs});
  const group=result.groups.find(g=>g.id===result.placeId);
  this.graph.recordVisit({...observation,placeId:result.placeId,name:group?.scope.name??null});return result;
 }
 async answer(fromVisitId:string,goalPlaceId:string){
  const route=this.graph.plan(fromVisitId,goalPlaceId),descriptions=[];
  for(const step of route)descriptions.push(await this.narrator.describe(this.graph,step));
  const places=route.length?[route[0]!.from,...route.map(s=>s.to)]:[goalPlaceId];
  return {path:places.filter((id,i)=>!i||id!==places[i-1]),route,descriptions,text:descriptions.length?descriptions.map(d=>this.narrator.render(d)).join('\n'):'已在目标地点候选范围内；这不表示已到达具体目标位置。',status:'historical-route-only'};
 }
}
