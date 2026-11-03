import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {Assessment,StoredState} from './contracts.js';

const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function originalAssessment(state:StoredState){const a=structuredClone(state.assessment);a.location.status=state.locationDecision??a.location.status;if(a.location.status==='new')a.location.placeId=null;return a;}
function toolAssessment(args:any){
 const a=structuredClone(args.assessment);for(const key of ['contextRefs','boundary','regionChangeEvidence','continuityCandidate'])if(a.location[key]===null)delete a.location[key];
 for(const key of ['placeUpdates','revisions'])if(a[key]===null)delete a[key];
 return {...a,memoryNotes:args.notes??[]};
}
export function commitResult(state:StoredState){return {kind:'committed',observationId:state.observationId,version:state.version,location:state.assessment.location,visitId:state.visitId,memory:state.memoryReceipt,terminate:true};}
export async function sessionBranch(path:string,tip:string|null){
 const entries=new Map<string,any>();for(const line of (await readFile(path,'utf8')).split('\n').filter(Boolean)){const records=JSON.parse(line);for(const r of Array.isArray(records)?records:[records])if(r.kind==='entry')entries.set(r.id,r);}
 const branch:any[]=[],seen=new Set<string>();while(tip){if(seen.has(tip)||!entries.has(tip))throw Error('Invalid durable Pi branch');seen.add(tip);const e=entries.get(tip);branch.push(e);tip=e.parentId;}return branch.reverse();
}
/** Both the original tool arguments and the successful effect receipt must agree. */
export function verifiedCommitEntry(branch:any[],state:StoredState){
 for(const entry of branch){const m=entry.message;if(m?.role!=='toolResult'||m.isError||m.toolName!=='memory_add')continue;
  let result;try{result=JSON.parse(m.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n'));}catch{continue;}
  if(digest(result)!==digest(commitResult(state)))continue;
  const call=branch.flatMap(e=>e.message?.role==='assistant'?e.message.content:[]).find((b:any)=>b.type==='toolCall'&&b.id===m.toolCallId&&b.name==='memory_add');
  if(!call||digest(toolAssessment(call.arguments))!==digest(originalAssessment(state)))throw Error('Pi effect arguments do not match durable spatial state');
  return entry;
 }
 return undefined;
}
export function verifyCommitMemo(memo:any,state:StoredState,assessment:Assessment,sessionId:string){
 if(!memo||memo.sessionId!==sessionId||memo.version!==state.version||memo.observationId!==state.observationId||memo.assessmentHash!==digest(assessment)||memo.assessmentHash!==digest(originalAssessment(state))||digest(memo.memberIds)!==digest(state.window?.observations.map(o=>o.id)??[state.observationId]))throw Error('Unverifiable Pi/SQLite commit recovery');
}
