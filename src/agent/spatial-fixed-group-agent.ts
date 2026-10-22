import {randomUUID} from 'node:crypto';
import {FixedScopePlaceGroup,parsePlaceScope,groupMembershipPrompt,type GroupMember,type PlaceScope} from './spatial-place-contract.js';
export function fixedGroupPagePrompt(version:number,pageIndex:number){
 if(!Number.isInteger(version)||version<1||!Number.isInteger(pageIndex)||pageIndex<0)throw Error('Invalid group version/page');
 return groupMembershipPrompt.replace('"version":1,"pageIndex":0',`"version":${version},"pageIndex":${pageIndex}`)+' version和pageIndex必须逐字复制INPUT数值。不声称围栏两侧无法互通，不推断未见路径。';
}
export interface FixedGroupModels {
  protocolAttempts?:number;
 selectCandidates?(input:{current:GroupMember;groups:ReturnType<FixedScopePlaceGroup['snapshot']>[]}):Promise<{groupIds:string[];[key:string]:unknown}>;
 perceive?(current:GroupMember):Promise<unknown>;
 createScope(current:GroupMember,perception?:unknown):Promise<unknown>;
  checkPage(input:{current:GroupMember;groupId:string;version:number;pageIndex:number;scope:PlaceScope;memberIds:string[];perception?:unknown;protocolFeedback?:string}):Promise<unknown>;
 disambiguate?(input:{current:GroupMember;groups:ReturnType<FixedScopePlaceGroup['snapshot']>[]}):Promise<unknown>;
}
/** Experimental causal online grouping. No temporal same shortcut or mutable name.
 * All groups/all member pages are checked; budget exhaustion must stop the run. */
export class FixedGroupSpatialAgent {
 private groups:FixedScopePlaceGroup[]=[];
 private lastMs=-Infinity;
 private busy=false;
 constructor(private readonly model:FixedGroupModels){}
 snapshot(){return this.groups.map(g=>g.snapshot());}
 async observe(current:GroupMember){
  if(this.busy)throw Error('Fixed-group agent busy');this.busy=true;
  try{
   if(!current.id||!Number.isFinite(current.atMs)||current.atMs<=this.lastMs||this.groups.some(g=>g.snapshot().members.some(m=>m.id===current.id)))throw Error('Observations must be unique and advance causally');
   const perception=this.model.perceive?await this.model.perceive(structuredClone(current)):undefined;
   const selection=this.model.selectCandidates?await this.model.selectCandidates({current:structuredClone(current),groups:this.snapshot()}):null;
   if(selection&&(!Array.isArray(selection.groupIds)||new Set(selection.groupIds).size!==selection.groupIds.length||selection.groupIds.some(id=>!this.groups.some(g=>g.id===id))||this.groups.length>0&&selection.groupIds.length===0))throw Error('Invalid candidate recall selection');
   const candidates=selection?this.groups.filter(g=>selection.groupIds.includes(g.id)):this.groups;
   const reviews=[];
   for(const group of candidates){
    const plan=group.plan(current),snapshot=group.snapshot(),answers=[];
     for(const [pageIndex,page] of plan.pages.entries()){
      const attempts=this.model.protocolAttempts??1;
      if(!Number.isInteger(attempts)||attempts<1||attempts>3)throw Error('Invalid protocol retry bound');
      let feedback:string|undefined;
      for(let attempt=0;attempt<attempts;attempt++){
       const answer=await this.model.checkPage({current:structuredClone(current),groupId:group.id,version:snapshot.version,pageIndex,scope:snapshot.scope,memberIds:page.map(m=>m.id),...perception===undefined?{}:{perception:structuredClone(perception)},...feedback?{protocolFeedback:feedback}:{}});
       const v=answer as any;
       const valid=v&&v.groupId===group.id&&v.version===snapshot.version&&v.pageIndex===pageIndex&&v.currentId===current.id&&['yes','no','uncertain'].includes(v.scopeMatch)&&typeof v.reason==='string'&&v.reason.trim()&&Array.isArray(v.memberChecks)&&v.memberChecks.length===page.length&&new Set(v.memberChecks.map((c:any)=>c?.id)).size===page.length&&v.memberChecks.every((c:any)=>c&&page.some(m=>m.id===c.id)&&['compatible','conflict','unobservable'].includes(c.relation)&&typeof c.evidence==='string'&&c.evidence.trim())&&Array.isArray(v.sourceIds)&&[current.id,...page.map(m=>m.id)].every(id=>v.sourceIds.includes(id))&&v.sourceIds.every((id:unknown)=>id===current.id||page.some(m=>m.id===id));
       if(valid){answers.push(answer);break;}
       if(attempt+1===attempts)throw Error('Group page protocol invalid after bounded attempts');
       feedback='上次返回未通过协议校验。请重新检查全部原图并输出完整JSON；groupId/version/pageIndex/currentId必须与INPUT完全一致，每个本页member必须逐项比较及引用。不得为通过校验改变或隐瞒视觉冲突。';
      }
     }
    reviews.push({group,plan,answers,evaluation:group.evaluate(plan,answers)});
   }
   const matches=reviews.filter(r=>r.evaluation.verdict==='belongs');
   let resolution:unknown=null;
   let resolvedId:string|null=null;
   if(matches.length>=1&&reviews.filter(r=>r.evaluation.verdict!=='different').length>1&&this.model.disambiguate){
    const options=reviews.filter(r=>r.evaluation.verdict!=='different');
    resolution=await this.model.disambiguate({current:structuredClone(current),groups:options.map(r=>r.group.snapshot())});
    const answer=resolution as any;
    const sourceIds=new Set([current.id,...options.flatMap(r=>r.plan.pages.flat().map(m=>m.id))]);
    if(!answer||(answer.selectedGroupId!==null&&!matches.some(r=>r.group.id===answer.selectedGroupId))||!Array.isArray(answer.groupChecks)||answer.groupChecks.length!==options.length||new Set(answer.groupChecks.map((c:any)=>c?.groupId)).size!==options.length||!Array.isArray(answer.sourceIds)||new Set(answer.sourceIds).size!==sourceIds.size||answer.sourceIds.some((id:unknown)=>!sourceIds.has(id as string)))throw Error('Invalid comparative identity resolution');
    for(const option of options){
     const c=answer.groupChecks.find((c:any)=>c.groupId===option.group.id);
     if(!c||!['instance-supported','shared-appearance-only','conflict','uncertain'].includes(c.support)||typeof c.evidence!=='string'||!c.evidence.trim())throw Error('Comparative resolution needs every candidate with original evidence');
    }
    if(answer.selectedGroupId!==null){
     const selected=answer.groupChecks.find((c:any)=>c.groupId===answer.selectedGroupId);
     if(selected.support!=='instance-supported'||answer.groupChecks.some((c:any)=>c.groupId!==answer.selectedGroupId&&!['shared-appearance-only','conflict'].includes(c.support)))throw Error('Do not resolve competing positive identities by arbitrary preference');
     resolvedId=answer.selectedGroupId;
    }
   }
   let placeId:string|null=null,action:'join'|'new'|'unknown'='unknown';
   // Competing memberships or an unruled-out group do not justify duplication.
   if(resolvedId||matches.length===1&&reviews.every(r=>r===matches[0]||r.evaluation.verdict==='different')){
    const match=resolvedId?matches.find(r=>r.group.id===resolvedId)!:matches[0]!;match.group.append(match.plan,match.answers);placeId=match.group.id;action='join';
   }else if(!matches.length&&reviews.every(r=>r.evaluation.verdict==='different')){
    const raw=await this.model.createScope(structuredClone(current),structuredClone(perception)) as any;
    if(!raw||typeof raw.coherent!=='boolean')throw Error('Invalid scope creation response');
    if(raw.coherent){const scope=parsePlaceScope(raw.scope,[current]);placeId=randomUUID();this.groups.push(new FixedScopePlaceGroup(placeId,scope,[current]));action='new';}
   }
   this.lastMs=current.atMs;
   return {id:current.id,atMs:current.atMs,placeId,action,perception,resolution,selection,newScopeBasis:action==='new'?(selection?'no-match-in-recalled-candidates-not-global-novelty':'all-existing-groups-different'):null,reviews:reviews.map(r=>({groupId:r.group.id,answers:r.answers,evaluation:r.evaluation})),groups:this.snapshot(),status:'completed' as const};
  }finally{this.busy=false;}
 }
}
