export type RevisitMember={observationId:string;atMs:number;path:string;sha256:string;direction:string};
export type RevisitPlace={placeId:string;name:string;members:RevisitMember[]};
export type RevisitImage={id:string;direction:string;path:string;sha256:string};
export type RevisitMatchEntry={placeId:string;observationId:string;queryObservationId?:string;queryPath?:string;inliers:number;similarity:number};
export type RevisitMatchResult={ok:boolean;best:RevisitMatchEntry|null;nearest:RevisitMatchEntry|null;results:RevisitMatchEntry[];error?:string};

/** Local visual matcher (SIFT+RANSAC). Scores only propose candidates; they never accept identity. */
export interface PlaceMatcher{
 match(current:RevisitImage[],candidates:Array<{placeId:string;image:RevisitImage}>):Promise<RevisitMatchResult>;
}

export type RevisitCandidate={
 placeId:string;name:string;matchedObservationId:string;matchedAtMs:number;
 bestInliers:number;bestSimilarity:number;supportedMembers:number;
 images:RevisitImage[];
};

export type RevisitRecall={
 status:'ok'|'unavailable';
 method:'sift-ransac-plus-global-layout';
 consideredPlaces:number;excludedPreviousPlaceId:string|null;limit:number;
 candidates:RevisitCandidate[];
 error:string|null;
 note:string;
};

/** The immediately preceding place is continuity, not a revisit. */
export function selectRevisitCandidates(places:RevisitPlace[],result:RevisitMatchResult,previousPlaceId:string|null,limit=2,maxImages=3){
 if(!Number.isInteger(limit)||limit<1||limit>4)throw Error('Invalid revisit candidate limit');
 const allowed=new Set(places.map(p=>p.placeId).filter(id=>id!==previousPlaceId));
 const byPlace=new Map<string,RevisitMatchEntry[]>();
 for(const entry of result.results)if(allowed.has(entry.placeId))byPlace.set(entry.placeId,[...(byPlace.get(entry.placeId)??[]),entry]);
 const candidates=places.flatMap(place=>{
  const matches=byPlace.get(place.placeId);if(!matches?.length)return [];
  const best=matches.reduce((a,b)=>b.inliers>a.inliers||b.inliers===a.inliers&&b.similarity>a.similarity?b:a),
   matched=place.members.find(m=>m.observationId===best.observationId);if(!matched)return [];
  const ordered=[...place.members].sort((a,b)=>b.atMs-a.atMs),images=[...new Map([matched,...ordered].map(m=>[m.observationId,m])).values()].slice(0,maxImages)
   .map(m=>({id:m.observationId,direction:m.direction,path:m.path,sha256:m.sha256}));
  return [{placeId:place.placeId,name:place.name,matchedObservationId:matched.observationId,matchedAtMs:matched.atMs,bestInliers:best.inliers,bestSimilarity:best.similarity,supportedMembers:new Set(matches.map(m=>m.observationId)).size,images}];
 });
 candidates.sort((a,b)=>b.bestInliers-a.bestInliers||b.bestSimilarity-a.bestSimilarity||b.matchedAtMs-a.matchedAtMs);
 return candidates.slice(0,limit);
}

/** Recall is a navigation aid, not evidence that the current camera is at that place. */
export function revisitRecallUnavailable(places:RevisitPlace[],previousPlaceId:string|null,error:string,limit:number):RevisitRecall{
 return {status:'unavailable',method:'sift-ransac-plus-global-layout',consideredPlaces:places.length,excludedPreviousPlaceId:previousPlaceId,limit,candidates:[],error,note:'Visual candidate recall failed. A missing candidate is not proof of a new place; the agent may inspect history or remain unknown, and no automatic place creation is authorized by this failure alone.'};
}

export function summarizeRevisitRecall(places:RevisitPlace[],previousPlaceId:string|null,result:RevisitMatchResult,limit:number):RevisitRecall{
 const candidates=result.ok?selectRevisitCandidates(places,result,previousPlaceId,limit):[];
 return {status:result.ok?'ok':'unavailable',method:'sift-ransac-plus-global-layout',consideredPlaces:places.length,excludedPreviousPlaceId:previousPlaceId,
  limit,candidates:candidates.map(c=>({...c,images:c.images.map(i=>({...i}))})),error:result.ok?null:result.error??'visual matcher unavailable',
  note:'Automatically recalled older places. Scores are navigation hints, not identity: omitted or unmatched places are not proven different, and similarity is not proof of the same place. Historical images are not evidence of what is currently visible.'};
}

/** Stable representation for the model input; current window sources remain separate. */
export function revisitProjection(recall:RevisitRecall){
 return {status:recall.status,method:recall.method,consideredPlaces:recall.consideredPlaces,excludedPreviousPlaceId:recall.excludedPreviousPlaceId,error:recall.error,
  candidates:recall.candidates.map(c=>({placeId:c.placeId,name:c.name,matchedObservationId:c.matchedObservationId,matchedAtMs:c.matchedAtMs,bestInliers:c.bestInliers,bestSimilarity:c.bestSimilarity,supportedMembers:c.supportedMembers,imageIds:c.images.map(i=>i.id)})),note:recall.note};
}
