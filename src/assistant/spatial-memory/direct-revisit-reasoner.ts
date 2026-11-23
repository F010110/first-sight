import type {SpatialReasoner,JudgeBatchInput} from './contracts.js';
import type {PlaceMatcher} from './revisit-candidates.js';
import {decideUlvnRevisits,type UlvnRevisitDecision} from './ulvn-revisit-decision.js';
import {enforceDirectRevisits,projectDirectRevisits} from './direct-revisit-batch.js';
import type {RevisitImage} from './revisit-candidates.js';

/** Decorates the original complete Pi batch reasoner; no replacement perception/storage. */
export function withDirectUlvnRevisits(reasoner:SpatialReasoner,matcher:PlaceMatcher,originals:(ids:string[])=>Promise<RevisitImage[]>,audit?:(input:JudgeBatchInput,decisions:UlvnRevisitDecision[])=>Promise<void>):SpatialReasoner{
 if(!reasoner.judgeBatch)throw Error('Direct ULVN revisit mode requires original batch reasoner');
 return {...reasoner,async judgeBatch(input:JudgeBatchInput){
  const previousPlaceId=input.history.at(-1)?.location.placeId??null;
  const members=input.history.flatMap(record=>(record.window?.observations??[{id:record.observationId,atMs:record.atMs}]).map(member=>({id:member.id,atMs:member.atMs,placeId:record.location.placeId})));
  // Equivalent to 30 observations on the full 2s replay; selected gaps must not
  // turn a long-ago source into a recent one merely because intervening rows were omitted.
  const eligible=[...new Map(members.map(m=>[m.id,m])).values()].filter(m=>m.atMs<input.rows[0]!.atMs-60000&&m.placeId&&m.placeId!==previousPlaceId);
  const candidates=[];
  // Machine evidence has a separate read path; never mark it VLM-delivered/inspected.
  for(let start=0;start<eligible.length;start+=32){const chunk=eligible.slice(start,start+32),images=await originals(chunk.map(m=>m.id));for(const image of images)candidates.push({placeId:chunk.find(m=>m.id===image.id)!.placeId!,image});}
  const decisions:UlvnRevisitDecision[]=[];
  for(const row of input.rows){const result=await matcher.match(row.views,candidates);decisions.push(...decideUlvnRevisits(result,previousPlaceId));}
  await audit?.(input,decisions);
  const names=new Map(input.history.flatMap(r=>r.location.placeId?[[r.location.placeId,r.location.name] as const]:[]));
  const instruction='ULVN_REVISIT_AUTHORITY '+JSON.stringify({previousPlaceId,decisions:decisions.map(({pairs,...decision})=>decision),instruction:'ULVN alone decides historical revisits. The memory_add tool mechanically applies these bindings and splits before normal validation/commit. Do not confirm, reject or reproduce the bindings. Keep normal new/continuity/boundary decisions and all other duties. No hit is not evidence of new. Inspect historical sources only for provenance, not identity voting.'});
  const {revisit, ...base}=input;
  return reasoner.judgeBatch!({...base,preloadImages:[],preloadNote:instruction,projectRevisits:segments=>projectDirectRevisits(segments,decisions,names,previousPlaceId),feedback:[instruction,input.feedback].filter(Boolean).join('\n'),commitSegments:async(segments,evidence)=>{enforceDirectRevisits(segments,decisions,previousPlaceId);return input.commitSegments(segments,evidence);}});
 }};
}
