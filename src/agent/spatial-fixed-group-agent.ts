import {randomUUID} from 'node:crypto';
import {FixedScopePlaceGroup,parsePlaceScope,groupMembershipPrompt,type GroupMember,type PlaceScope} from './spatial-place-contract.js';
export function fixedGroupPagePrompt(version:number,pageIndex:number){
 if(!Number.isInteger(version)||version<1||!Number.isInteger(pageIndex)||pageIndex<0)throw Error('Invalid group version/page');
 return groupMembershipPrompt.replace('"version":1,"pageIndex":0',`"version":${version},"pageIndex":${pageIndex}`)+' version和pageIndex必须逐字复制INPUT数值。不声称围栏两侧无法互通，不推断未见路径。';
}
export interface FixedGroupModels {
 perceive?(current:GroupMember):Promise<unknown>;
 createScope(current:GroupMember,perception?:unknown):Promise<unknown>;
 checkPage(input:{current:GroupMember;groupId:string;version:number;pageIndex:number;scope:PlaceScope;memberIds:string[];perception?:unknown}):Promise<unknown>;
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
   const reviews=[];
   for(const group of this.groups){
    const plan=group.plan(current),snapshot=group.snapshot(),answers=[];
    for(const [pageIndex,page] of plan.pages.entries())answers.push(await this.model.checkPage({current:structuredClone(current),groupId:group.id,version:snapshot.version,pageIndex,scope:snapshot.scope,memberIds:page.map(m=>m.id),...perception===undefined?{}:{perception:structuredClone(perception)}}));
    reviews.push({group,plan,answers,evaluation:group.evaluate(plan,answers)});
   }
   const matches=reviews.filter(r=>r.evaluation.verdict==='belongs');
   let placeId:string|null=null,action:'join'|'new'|'unknown'='unknown';
   // Competing memberships or an unruled-out group do not justify duplication.
   if(matches.length===1&&reviews.every(r=>r===matches[0]||r.evaluation.verdict==='different')){
    const match=matches[0]!;match.group.append(match.plan,match.answers);placeId=match.group.id;action='join';
   }else if(!matches.length&&reviews.every(r=>r.evaluation.verdict==='different')){
    const raw=await this.model.createScope(structuredClone(current),structuredClone(perception)) as any;
    if(!raw||typeof raw.coherent!=='boolean')throw Error('Invalid scope creation response');
    if(raw.coherent){const scope=parsePlaceScope(raw.scope,[current]);placeId=randomUUID();this.groups.push(new FixedScopePlaceGroup(placeId,scope,[current]));action='new';}
   }
   this.lastMs=current.atMs;
   return {id:current.id,atMs:current.atMs,placeId,action,perception,reviews:reviews.map(r=>({groupId:r.group.id,answers:r.answers,evaluation:r.evaluation})),groups:this.snapshot(),status:'completed' as const};
  }finally{this.busy=false;}
 }
}
