import {createHash} from 'node:crypto';
export interface PlaceScope {name:string;definition:string;boundaryRules:string[];sourceIds:string[]}
export interface GroupMember {id:string;atMs:number}
export interface GroupCheckPlan {groupId:string;version:number;contractHash:string;current:GroupMember;pages:GroupMember[][]}
export interface GroupPageAnswer {groupId:string;version:number;pageIndex:number;currentId:string;scopeMatch:'yes'|'no'|'uncertain';reason:string;memberChecks:Array<{id:string;relation:'compatible'|'conflict'|'unobservable';evidence:string}>;sourceIds:string[]}
const nonempty=(v:unknown):v is string=>typeof v==='string'&&!!v.trim();
export function parsePlaceScope(value:unknown,members:GroupMember[]):PlaceScope{
 const v=value as any;
 if(!v||!nonempty(v.name)||v.name.length>80||!nonempty(v.definition)||v.definition.length>400||!Array.isArray(v.boundaryRules)||v.boundaryRules.length<1||v.boundaryRules.length>4||!v.boundaryRules.every((r:unknown)=>nonempty(r)&&r.length<=240)||!Array.isArray(v.sourceIds)||v.sourceIds.length!==members.length||new Set(v.sourceIds).size!==members.length||members.some(m=>!v.sourceIds.includes(m.id)))throw Error('Place scope needs a fixed name, concrete definition, boundaryRules and every seed original.');
 return {name:v.name,definition:v.definition,boundaryRules:[...v.boundaryRules],sourceIds:[...v.sourceIds]};
}
/** Opt-in candidate group. All members are retained, never replaced by the last image.
 * A locked name describes scope; it is not ground truth or a reason to ignore images. */
export class FixedScopePlaceGroup {
 private readonly scope:PlaceScope;
 private readonly contractHash:string;
 private members:GroupMember[];
 private version=1;
 constructor(readonly id:string,scope:PlaceScope,members:GroupMember[]){
  if(!nonempty(id)||!members.length||new Set(members.map(m=>m.id)).size!==members.length||members.some(m=>!nonempty(m.id)||!Number.isFinite(m.atMs)))throw Error('Invalid group seed members');
  this.scope=parsePlaceScope(scope,members);this.members=structuredClone(members);this.contractHash=createHash('sha256').update(JSON.stringify(this.scope)).digest('hex');
 }
 snapshot(){return structuredClone({id:this.id,version:this.version,scope:this.scope,contractHash:this.contractHash,members:this.members,status:'candidate-not-ground-truth'});}
 plan(current:GroupMember,pageSize=3):GroupCheckPlan{
  if(!nonempty(current.id)||!Number.isFinite(current.atMs)||this.members.some(m=>m.id===current.id||m.atMs>=current.atMs)||!Number.isInteger(pageSize)||pageSize<1||pageSize>3)throw Error('Group check requires a new causal observation and 1–3 members per page');
  return {groupId:this.id,version:this.version,contractHash:this.contractHash,current:structuredClone(current),pages:Array.from({length:Math.ceil(this.members.length/pageSize)},(_,i)=>structuredClone(this.members.slice(i*pageSize,(i+1)*pageSize)))};
 }
 evaluate(plan:GroupCheckPlan,values:unknown[]){
  this.checkPlan(plan);
  if(values.length!==plan.pages.length)throw Error('Incomplete whole-group coverage: every page must be checked before membership can change');
  const answers:GroupPageAnswer[]=[],seen=new Set<number>();
  for(const value of values){
   const v=value as any;
   if(!v||v.groupId!==this.id||v.version!==plan.version||v.currentId!==plan.current.id||!Number.isInteger(v.pageIndex)||seen.has(v.pageIndex)||!plan.pages[v.pageIndex]||!['yes','no','uncertain'].includes(v.scopeMatch)||!nonempty(v.reason)||!Array.isArray(v.memberChecks)||!Array.isArray(v.sourceIds)||!v.sourceIds.includes(plan.current.id))throw Error('Malformed group page decision');
   const page=plan.pages[v.pageIndex]!;const ids=new Set(page.map(m=>m.id));
   if(v.memberChecks.length!==page.length||new Set(v.memberChecks.map((c:any)=>c?.id)).size!==page.length||v.memberChecks.some((c:any)=>!c||!ids.has(c.id)||!['compatible','conflict','unobservable'].includes(c.relation)||!nonempty(c.evidence)||!v.sourceIds.includes(c.id))||v.sourceIds.some((id:unknown)=>id!==plan.current.id&&!ids.has(id as string)))throw Error('Every group member on the page requires its delivered original comparison and citation');
   seen.add(v.pageIndex);answers.push(structuredClone(v));
  }
  const checks=answers.flatMap(a=>a.memberChecks),conflicts=checks.filter(c=>c.relation==='conflict').map(c=>c.id);
  const verdict=conflicts.length||answers.some(a=>a.scopeMatch==='no')?'different':answers.some(a=>a.scopeMatch==='uncertain')||!checks.some(c=>c.relation==='compatible')?'uncertain':'belongs';
  return {verdict,checkedMemberIds:checks.map(c=>c.id),conflictIds:conflicts,scopeName:this.scope.name,contractHash:this.contractHash,wholeGroupCovered:true,status:'model-judgment-not-ground-truth'};
 }
 append(plan:GroupCheckPlan,answers:unknown[]){const result=this.evaluate(plan,answers);if(result.verdict!=='belongs')throw Error('Do not append a conflicting or uncertain observation to the named group');this.members.push(structuredClone(plan.current));this.version++;return this.snapshot();}
 private checkPlan(plan:GroupCheckPlan){
  if(plan.groupId!==this.id||plan.version!==this.version||plan.contractHash!==this.contractHash||!nonempty(plan.current.id)||!Number.isFinite(plan.current.atMs)||plan.current.atMs<=Math.max(...this.members.map(m=>m.atMs))||this.members.some(m=>m.id===plan.current.id)||!Array.isArray(plan.pages)||plan.pages.some(page=>!Array.isArray(page)||!page.length||page.length>3)||JSON.stringify(plan.pages.flat())!==JSON.stringify(this.members))throw Error('Stale, noncausal or incomplete group plan');
 }
}

export const placeScopePrompt='这些SEED原图是一个候选地点组的历史成员，不一定正确。先核对是否能定义一个具体一致的所在区域；不能把只共享物体但位于边界两侧的图片硬凑一组。只输出JSON：{"coherent":true,"scope":{"name":"简短稳定名称","definition":"观察者可占据区域及稳定边界关系，不只是物体清单","boundaryRules":["不能吸收哪些相邻区域，基于原图可见证据"],"sourceIds":["所有SEED准确ID"]},"reason":"依据"}。如果成员存在不可兼容的区域冲突，coherent=false且scope=null，说明原因。名称是根据这些原图提出的候选定义，不是官方名称或真值，不要求室内房间，也不把整个建筑一律当一个地点。';
export const groupMembershipPrompt='判断CURRENT是否属于同一个GROUP的固定区域范围，而不是只像最近一张图片。给出的所有MEMBER属于这个候选组；参考图不是多个独立可任选的地点。使用全部本页原图，逐项找具体区域兼容性或冲突。不同视角/光照或缺少共同视野可unobservable，不应凭此判不同；边界另一侧、脚下通行区域不相容等正面证据是conflict。若提供scope，名称与definition/boundaryRules必须保持稳定，不能为吸收当前图而扩大或改写；但名字错了也不能强迫图片符合它，冲突应如实指出。若没有scope，从所有成员共同支持的具体区域判断，不可只凭时间相邻。不要把不同方向的围栏自动当成同一道。只输出JSON：{"groupId":"输入groupId","version":1,"pageIndex":0,"currentId":"准确CURRENT ID","scopeMatch":"yes或no或uncertain","reason":"具体区域与组范围的依据","memberChecks":[{"id":"每个本页MEMBER准确ID","relation":"compatible或conflict或unobservable","evidence":"原图具体依据"}],"sourceIds":["CURRENT及本页全部MEMBER ID"]}。分页只为图片预算，程序会汇总全部页；不可隐去早期不相容成员。';
