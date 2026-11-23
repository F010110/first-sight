import type {RevisitMatchEntry,RevisitMatchResult} from './revisit-candidates.js';

export type UlvnRevisitDecision={observationId:string;placeId:string;historicalObservationId:string;policy:'ulvn-two-view-60-035-v1';pairs:RevisitMatchEntry[]};

/** Identity authority is local geometry, never a VLM vote. Conflicting old IDs abstain. */
export function decideUlvnRevisits(result:RevisitMatchResult,previousPlaceId:string|null){
 if(!result.ok)throw Error('ULVN revisit decision unavailable: '+result.error);
 const groups=new Map<string,RevisitMatchEntry[]>();
 for(const pair of result.results){
  if(!pair.queryObservationId||pair.placeId===previousPlaceId||pair.inliers<60||(pair.ratio??0)<.35)continue;
  const key=JSON.stringify([pair.queryObservationId,pair.placeId,pair.observationId]);groups.set(key,[...(groups.get(key)??[]),pair]);
 }
 const accepted:UlvnRevisitDecision[]=[];
 for(const pairs of groups.values()){
  const independent=pairs.some((a,i)=>pairs.slice(i+1).some(b=>a.queryDirection&&a.historicalDirection&&b.queryDirection&&b.historicalDirection&&a.queryDirection!==b.queryDirection&&a.historicalDirection!==b.historicalDirection&&a.querySHA256&&b.querySHA256&&a.querySHA256!==b.querySHA256&&a.historicalSHA256&&b.historicalSHA256&&a.historicalSHA256!==b.historicalSHA256));
  if(independent){const p=pairs[0]!;accepted.push({observationId:p.queryObservationId!,placeId:p.placeId,historicalObservationId:p.observationId,policy:'ulvn-two-view-60-035-v1',pairs});}
 }
 const out:UlvnRevisitDecision[]=[];
 for(const id of new Set(accepted.map(d=>d.observationId))){const matches=accepted.filter(d=>d.observationId===id);if(new Set(matches.map(d=>d.placeId)).size!==1)continue;out.push(matches.sort((a,b)=>Math.max(...b.pairs.map(p=>p.inliers))-Math.max(...a.pairs.map(p=>p.inliers)))[0]!);}
 return out;
}
