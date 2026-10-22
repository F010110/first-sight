import {FixedGroupSpatialAgent,fixedGroupPagePrompt} from '../agent/spatial-fixed-group-agent.js';
import {parsePlaceScope} from '../agent/spatial-place-contract.js';
import {fixedScopeCreationPrompt} from '../agent/spatial-fixed-prompts.js';
import {groundFirstSpatialPrompt} from '../agent/spatial-ground-first.js';
import {parseSpatialPerception} from '../agent/spatial-separated-protocol.js';
import {aliasedSpatialRequest} from '../agent/spatial-reference-aliases.js';
import {visualDistance} from '../agent/spatial-visual-recall.js';
import {SpatialVisitTopology} from '../agent/spatial-visit-topology.js';
import type {SpatialJsonRequest} from '../agent/spatial-json-vlm.js';
import type {LiveOriginal} from './realtime-memory.js';
const single=' 当前只有一张真实前方图，左右视图缺失，不能补画看不到的边界。空间粒度为具体连续区域，不是每件物体前的站位；只有可见实墙、门洞、围栏两侧等正面证据才拆分。同区转向或家具变化不自动新建地点，范围不清明确uncertain。';
/** Method2 semantics with genuinely ONE feature/image view; never duplicate into three. */
export class RealtimeMethod2{
 private originals=new Map<string,LiveOriginal>();private recalled:string[]=[];
 private graph=new SpatialVisitTopology();private lastVisit=-Infinity;
 readonly agent:FixedGroupSpatialAgent;
 constructor(provider:(request:SpatialJsonRequest)=>Promise<unknown>){
  const request=aliasedSpatialRequest(provider);
  const images=(ids:string[],atMs:number)=>ids.map(id=>{const row=this.originals.get(id);if(!row?.pngPath||!row.pngSha256||row.atMs>atMs)throw Error('Missing or future live original');return {id,direction:'front',path:row.pngPath,sha256:row.pngSha256};});
  this.agent=new FixedGroupSpatialAgent({protocolAttempts:3,
   selectCandidates:async({current,groups})=>{
    const query=this.originals.get(current.id)!.features!;
    const ranked=groups.map(g=>({id:g.id,last:Math.max(...g.members.map(m=>m.atMs)),distance:Math.min(...g.members.map(m=>visualDistance(query,this.originals.get(m.id)!.features!)))}));
    this.recalled=[...new Set([...ranked.sort((a,b)=>b.last-a.last).slice(0,2),...ranked.sort((a,b)=>a.distance-b.distance).slice(0,2)].map(g=>g.id))];
    return {groupIds:this.recalled,method:'method2-single-view/recent2-visual2-sequence6',omittedGroups:groups.length-this.recalled.length};
   },
   perceive:async current=>{
    let feedback='';for(let attempt=0;attempt<2;attempt++){
     const raw=await request({phase:'perception',prompt:groundFirstSpatialPrompt+single,data:{current,...feedback?{feedback}:{}},images:images([current.id],current.atMs)});
     try{return parseSpatialPerception(raw,current.id);}catch(error){if(attempt===1)throw error;feedback=String(error);}
    }throw Error('Perception exhausted');
   },
   createScope:async(current,perception)=>{
    let feedback='';for(let attempt=0;attempt<2;attempt++){
     const raw=await request({phase:'identity',prompt:fixedScopeCreationPrompt(current.id)+single,data:{current,perception,...feedback?{feedback}:{}},images:images([current.id],current.atMs)}) as any;
     try{if(typeof raw?.coherent!=='boolean')throw Error('coherent must be boolean');if(raw.coherent)parsePlaceScope(raw.scope,[current]);return raw;}catch(error){if(attempt===1)throw error;feedback=String(error);}
    }throw Error('Scope exhausted');
   },
   checkPage:async data=>request({phase:'identity',prompt:fixedGroupPagePrompt(data.version,data.pageIndex)+single,data:{...data,visitMemory:this.graph.context(data.current.atMs,this.recalled,false)},images:images([data.current.id,...data.memberIds],data.current.atMs)}),
   disambiguate:async data=>{
    const ids=[...new Set([data.current.id,...data.groups.flatMap(g=>g.members.map(m=>m.id))])];
    if(ids.length>12)return {selectedGroupId:null,groupChecks:data.groups.map(g=>({groupId:g.id,support:'uncertain',evidence:'All-original comparison exceeds 12-image cap; references not silently omitted'})),sourceIds:ids};
    return request({phase:'identity',prompt:'用全部候选成员原图比较当前属于哪个固定区域。不能改范围或按名字／时间选。只输出JSON：{"selectedGroupId":"准确groupId或null","groupChecks":[{"groupId":"候选groupId","support":"instance-supported或shared-appearance-only或conflict或uncertain","evidence":"原图具体依据"}],"sourceIds":["CURRENT和所有MEMBER ID"]}。仅在一个候选有实例支持且其他候选为共享外观或冲突时选择，否则null。'+single,data,images:images(ids,data.current.atMs)});
   }
  });
 }
 interrupt(row:LiveOriginal){if(row.atMs<=this.lastVisit)return;this.graph.observe({id:row.id,atMs:row.atMs,placeId:null});this.lastVisit=row.atMs;}
 async observe(row:LiveOriginal){
  if(!row.features||row.features.length!==1||row.features[0]?.length!==72)throw Error('Require one genuine live descriptor');
  this.originals.set(row.id,structuredClone(row));const result=await this.agent.observe({id:row.id,atMs:row.atMs});
  const place=result.groups.find(g=>g.id===result.placeId);this.graph.observe({id:row.id,atMs:row.atMs,placeId:result.placeId,...place?{name:place.scope.name}:{}});this.lastVisit=row.atMs;
  return result;
 }
 snapshot(){return this.agent.snapshot();}
}
