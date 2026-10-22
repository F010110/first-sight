import type {GroupMember} from './spatial-place-contract.js';
import {visualDistance} from './spatial-visual-recall.js';
export interface RecallGroup {id:string;members:GroupMember[]}
export interface RecallFeatures {id:string;features:number[][]}
/** Local image descriptor index. Images only; scores propose candidates, never identity.
 * Linear local scan for this prototype; bounded VLM context, not ANN-scale latency. */
export class SpatialCandidateRecall {
 private features=new Map<string,number[][]>();
 constructor(rows:RecallFeatures[],readonly recentLimit=2,readonly visualLimit=2){
  if(!Number.isInteger(recentLimit)||recentLimit<1||recentLimit>8||!Number.isInteger(visualLimit)||visualLimit<1||visualLimit>8)throw Error('Invalid recall limits');
  for(const row of rows){if(!row.id||this.features.has(row.id)||row.features.length!==3||row.features.some(v=>v.length!==72||v.some(n=>!Number.isFinite(n)||n<0||n>1)))throw Error('Invalid RGB recall features');this.features.set(row.id,structuredClone(row.features));}
 }
 select(current:GroupMember,groups:RecallGroup[]){
  const query=this.features.get(current.id);if(!query)throw Error('Missing current visual descriptor');
  if(new Set(groups.map(g=>g.id)).size!==groups.length)throw Error('Duplicate recall group');
  const ranked=groups.map(group=>{
   if(!group.members.length||group.members.some(m=>m.atMs>=current.atMs||m.id===current.id))throw Error('Noncausal recall member');
   let distance=Infinity,matchedId='';
   for(const member of group.members){const f=this.features.get(member.id);if(!f)throw Error('Missing historical descriptor');const d=visualDistance(query,f);if(d<distance){distance=d;matchedId=member.id;}}
   return {groupId:group.id,lastVisitedMs:Math.max(...group.members.map(m=>m.atMs)),distance,matchedId};
  });
  const recent=[...ranked].sort((a,b)=>b.lastVisitedMs-a.lastVisitedMs||a.groupId.localeCompare(b.groupId)).slice(0,this.recentLimit);
  const visual=[...ranked].sort((a,b)=>a.distance-b.distance||a.groupId.localeCompare(b.groupId)).slice(0,this.visualLimit);
  const groupIds=[...new Set([...recent,...visual].map(g=>g.groupId))];
  return {groupIds,recent,visual,totalGroups:groups.length,omittedGroups:groups.length-groupIds.length,method:'rgb-layout-v1/recent-plus-visual',limits:{recent:this.recentLimit,visual:this.visualLimit},note:'Candidate recall only. Omitted places are not proven different; new groups remain provisional. No future members, names, GPS or evaluation labels used.'};
 }
}
