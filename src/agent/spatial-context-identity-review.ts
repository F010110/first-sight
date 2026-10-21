import type {SpatialLoopModel,SpatialLoopDecision} from './spatial-context-loop.js';
import type {SpatialContextView} from './spatial-working-context.js';
import type {SpatialObservation} from './incremental-spatial-memory.js';

type Input=Parameters<SpatialLoopModel>[0];
type Comparison={referenceId:string;relation:'same'|'different'|'uncertain';layoutEvidence:string};
type Reviewed={observationId:string;placeId:string|null;sourceIds:string[];observerRegion:string;comparisons:Comparison[]};
const isNew=(id:string)=>/^new(?:-[1-9][0-9]*)?$/.test(id);

/** Latest actual observation plus the oldest still-visible anchor of its identity.
 * No label, answer, map, coordinate or old-run prediction is consulted. */
export function spatialReferenceIds(context:SpatialContextView,observations:SpatialObservation[]){
 const recent=context.recent.filter(e=>e.atMs<observations[0]!.atMs).sort((a,b)=>b.atMs-a.atMs);
 const latest=recent[0];if(!latest)return [];
 const anchor=latest.placeId?context.anchors.find(e=>e.placeId===latest.placeId&&e.atMs<latest.atMs):undefined;
 return [...new Set([latest.observationId,...anchor?[anchor.observationId]:[]])];
}

/** Checks evidence workflow and internal consistency, NOT visual truth. */
export function spatialIdentityReviewError(value:unknown,input:Input):string|null{
 const assessments=(value as any)?.assessments;
 if(!Array.isArray(assessments)||assessments.length!==input.observations.length)return 'Review needs one assessment per observation.';
 if(assessments.some(a=>!a||typeof a!=='object'||typeof a.observationId!=='string')||new Set(assessments.map(a=>a.observationId)).size!==assessments.length)return 'Review assessments need unique exact observation IDs.';
 const references=input.context.retrieved.filter(e=>input.evidenceImages.some(image=>image.id===e.id));
 const places=new Map(references.map(e=>[e.id,e.placeId]));
 for(let index=0;index<input.observations.length;index++){
  const observation=input.observations[index]!,a=assessments.find((entry:Reviewed)=>entry.observationId===observation.id) as Reviewed|undefined;
  if(!a||typeof a.observerRegion!=='string'||!a.observerRegion.trim()||!Array.isArray(a.comparisons)||!Array.isArray(a.sourceIds)||a.sourceIds.some(id=>typeof id!=='string'))return 'Each assessment needs observerRegion, comparisons and sourceIds.';
  if(a.comparisons.some(c=>!c||typeof c!=='object'||typeof c.referenceId!=='string'))return 'Comparison entries must be objects with exact reference IDs.';
  if(a.placeId!==null&&typeof a.placeId!=='string')return 'placeId must be string or null.';
  const ids=[...references.map(e=>e.id),...index?[input.observations[index-1]!.id]:[]];
  if(a.comparisons.length!==ids.length||new Set(a.comparisons.map(c=>c.referenceId)).size!==ids.length)return 'Compare EVERY delivered reference and the previous window observation exactly once.';
  for(const id of ids){
   const c=a.comparisons.find(c=>c.referenceId===id);
   if(!c||!['same','different','uncertain'].includes(c.relation)||typeof c.layoutEvidence!=='string'||!c.layoutEvidence.trim()||!a.sourceIds.includes(id))return 'Comparison requires exact referenceId, relation, concrete layoutEvidence and a citation of its delivered image.';
   if(a.placeId!==null){
    const other=places.get(id);
    if(c.relation==='uncertain'&&isNew(a.placeId))return 'Uncertain comparison cannot justify a new identity; leave identity unknown instead of manufacturing a boundary.';
    if(c.relation==='same'&&other!==null&&other!==undefined&&other!==a.placeId)return 'Same physical region cannot receive a different/new identity. Reuse its ID, or reassess the relation with visual boundary evidence.';
    if(other===a.placeId&&c.relation!=='same')return 'Reusing an identity requires a same-region comparison, not uncertainty or contradictory boundary evidence.';
   }
  }
  if(a.placeId!==null&&typeof a.placeId!=='string')return 'placeId must be string or null.';
  if(a.placeId&&!isNew(a.placeId)&&!a.comparisons.some(c=>places.get(c.referenceId)===a.placeId&&c.relation==='same'))return 'Known identity requires a directly compared original image of that identity.';
  places.set(observation.id,a.placeId);
 }
 return null;
}

export const spatialReviewInstructions=`实验空间核验策略：判断观察者所在的具体可辨区域，不是画面中能看到的对象或建筑用途。共现红砖墙、树木、围栏不证明同地；隔围栏可见的球场不等于身处球场。先比较最近原图，再比较该身份较早代表图；比较地面/路径、围栏哪一侧、开口、墙体与通行区域的相对布局。转向、遮挡、光照或新增物体不是新区域的充分证据；也不能仅因时间连续就沿用。新地点必须有与最近地点不相容的正面布局/边界证据，不能只拿更早的无关地点比较。无法确定是否同地时placeId=null，不用新ID伪装确定，也不要硬沿用。首次没有历史时允许基于正面布局建立候选。
每项assessment除原字段外增加observerRegion（简短描述自身所在区域）和comparisons数组。对每张已交付HISTORICAL来源及本窗口紧邻前一观察，恰好给一项：{"referenceId":"准确ID","relation":"same或different或uncertain","layoutEvidence":"具体相对布局或边界依据，不抄对象清单"}。sourceIds包含当前ID及所有比较ID。same意味着同一具体区域，应沿用对应placeId；不同区域用new-1等窗口别名。仅当历史身份未知时，同区域可以首次赋予候选ID。不得从未核实旧outputs复制身份或reason。next用finish。本实验没有用户问题。`;

/** At most two corrections; rejected outputs remain in the adapter raw journal.
 * Exhaustion explicitly yields unknown, never silently accepts a rejected ID. */
export function reviewedSpatialModel(base:SpatialLoopModel,onReject:(value:unknown)=>Promise<void>):SpatialLoopModel{
 return async input=>{
  let feedback=input.feedback??'';
  for(let attempt=0;attempt<3;attempt++){
   const decision=await base({...input,feedback:`${spatialReviewInstructions}\n${feedback}`});
   const error=spatialIdentityReviewError(decision,input);
   if(!error)return decision;
   await onReject({status:'rejected-spatial-comparison',attempt,error,decision});feedback=error;
  }
  await onReject({status:'spatial-comparison-exhausted',fallback:'explicit-unknown'});
  return {assessments:input.observations.map(o=>({observationId:o.id,atMs:o.atMs,placeId:null,reason:'空间比较核验未完成，身份待定；不接受被拒绝的分组。',sourceIds:[o.id]})),next:{kind:'finish'}} as SpatialLoopDecision;
 };
}
