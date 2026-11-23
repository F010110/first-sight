export type RevisitMember={observationId:string;atMs:number;path:string;sha256:string;direction:string};
export type RevisitPlace={placeId:string;name:string;members:RevisitMember[]};
export type RevisitImage={id:string;direction:string;path:string;sha256:string};
export type RevisitMatchEntry={placeId:string;observationId:string;path?:string;queryObservationId?:string;queryPath?:string;inliers:number;similarity:number;ratio?:number;queryDirection?:string;historicalDirection?:string;querySHA256?:string;historicalSHA256?:string};
export type RevisitMatchResult={ok:boolean;best:RevisitMatchEntry|null;nearest:RevisitMatchEntry|null;results:RevisitMatchEntry[];error?:string;stats?:Record<string,unknown>;method?:'sift-ransac-plus-global-layout'|'megaloc-lightglue-ransac'};

/** Local visual matcher (SIFT+RANSAC). Scores only propose candidates; they never accept identity. */
export interface PlaceMatcher{
 match(current:RevisitImage[],candidates:Array<{placeId:string;image:RevisitImage}>):Promise<RevisitMatchResult>;
 close?():Promise<void>;
}

export type RevisitCandidate={
 placeId:string;name:string;matchedObservationId:string;matchedAtMs:number;
 bestInliers:number;bestSimilarity:number;supportedMembers:number;
  images:RevisitImage[];
  matchedPair?:{current:RevisitImage;historical:RevisitImage};
  globalPair?:{current:RevisitImage;historical:RevisitImage;similarity:number};
};

export type RevisitRecall={
 status:'ok'|'unavailable';
  method:'sift-ransac-plus-global-layout'|'megaloc-lightglue-ransac';
 consideredPlaces:number;excludedPreviousPlaceId:string|null;limit:number;
 candidates:RevisitCandidate[];
 error:string|null;
 note:string;
};

/** Broad candidate recall. The matcher does not rank identity; scores stay internal. */
export function selectRevisitCandidates(places:RevisitPlace[],result:RevisitMatchResult,previousPlaceId:string|null,limit=100,maxImages=3,current:RevisitImage[]=[]){
 if(!Number.isInteger(limit)||limit<1||limit>200)throw Error('Invalid revisit candidate limit');
 const allowed=new Set(places.map(p=>p.placeId).filter(id=>id!==previousPlaceId));
 const byPlace=new Map<string,RevisitMatchEntry[]>();
 for(const entry of result.results)if(allowed.has(entry.placeId))byPlace.set(entry.placeId,[...(byPlace.get(entry.placeId)??[]),entry]);
 const candidates=places.flatMap(place=>{
  const matches=byPlace.get(place.placeId);if(!matches?.length)return [];
  const best=matches.reduce((a,b)=>b.inliers>a.inliers||b.inliers===a.inliers&&b.similarity>a.similarity?b:a),
    matched=place.members.find(m=>m.observationId===best.observationId&&(!best.path||m.path===best.path));if(!matched)return [];
   const query=current.find(m=>m.path===best.queryPath);
   const global=matches.reduce((a,b)=>b.similarity>a.similarity?b:a),globalQuery=current.find(m=>m.path===global.queryPath),globalOld=place.members.find(m=>m.observationId===global.observationId&&m.path===global.path);
  const ordered=[...place.members].sort((a,b)=>b.atMs-a.atMs),images=[...new Map([matched,...ordered].map(m=>[m.observationId,m])).values()].slice(0,maxImages)
   .map(m=>({id:m.observationId,direction:m.direction,path:m.path,sha256:m.sha256}));
   return [{placeId:place.placeId,name:place.name,matchedObservationId:matched.observationId,matchedAtMs:matched.atMs,bestInliers:best.inliers,bestSimilarity:best.similarity,supportedMembers:new Set(matches.map(m=>m.observationId)).size,images,...query?{matchedPair:{current:query,historical:{id:matched.observationId,direction:matched.direction,path:matched.path,sha256:matched.sha256}}}:{},...globalQuery&&globalOld?{globalPair:{current:globalQuery,historical:{id:globalOld.observationId,direction:globalOld.direction,path:globalOld.path,sha256:globalOld.sha256},similarity:global.similarity}}:{}}];
 });
 // Do not present an inlier ranking as an answer. A stable time order is only navigation.
  candidates.sort((a,b)=>b.bestInliers-a.bestInliers||b.bestSimilarity-a.bestSimilarity||a.placeId.localeCompare(b.placeId));
 return candidates.slice(0,limit);
}

/** Recall is a navigation aid, not evidence that the current camera is at that place. */
export function revisitRecallUnavailable(places:RevisitPlace[],previousPlaceId:string|null,error:string,limit:number):RevisitRecall{
 return {status:'unavailable',method:'sift-ransac-plus-global-layout',consideredPlaces:places.length,excludedPreviousPlaceId:previousPlaceId,limit,candidates:[],error,note:'Visual candidate recall failed. A missing candidate is not proof of a new place; the agent may inspect history or remain unknown, and no automatic place creation is authorized by this failure alone.'};
}

export function summarizeRevisitRecall(places:RevisitPlace[],previousPlaceId:string|null,result:RevisitMatchResult,limit:number,current:RevisitImage[]=[]):RevisitRecall{
 const candidates=result.ok?selectRevisitCandidates(places,result,previousPlaceId,limit,3,current):[];
  return {status:result.ok?'ok':'unavailable',method:result.method??'sift-ransac-plus-global-layout',consideredPlaces:places.length,excludedPreviousPlaceId:previousPlaceId,
  limit,candidates:candidates.map(c=>({...c,images:c.images.map(i=>({...i}))})),error:result.ok?null:result.error??'visual matcher unavailable',
  note:'Automatically recalled older places. Scores are navigation hints, not identity: omitted or unmatched places are not proven different, and similarity is not proof of the same place. Historical images are not evidence of what is currently visible.'};
}

/** Stable representation for the model input; current window sources remain separate. */
export function revisitProjection(recall:RevisitRecall){
 return {status:recall.status,method:recall.method,consideredPlaces:recall.consideredPlaces,excludedPreviousPlaceId:recall.excludedPreviousPlaceId,error:recall.error,limit:recall.limit,
  candidates:recall.candidates.map(c=>({placeId:c.placeId,name:c.name,matchedObservationId:c.matchedObservationId,matchedAtMs:c.matchedAtMs,imageIds:c.images.map(i=>i.id),...c.matchedPair?{matchedPair:{current:{id:c.matchedPair.current.id,direction:c.matchedPair.current.direction},historical:{id:c.matchedPair.historical.id,direction:c.matchedPair.historical.direction}}}:{}})),note:recall.note};
}

/** Bounded dual-channel evidence selection, never an identity decision. */
export function selectRevisitImagePairs(recall:RevisitRecall,currentIds:string[],maxPairs=3){
 if(!Number.isInteger(maxPairs)||maxPairs<1||maxPairs>5)throw Error('Invalid pair budget');
 const geometry=recall.candidates.filter(c=>c.matchedPair).map(c=>({placeId:c.placeId,channel:'geometry',...c.matchedPair!}));
 const global=recall.candidates.filter(c=>c.globalPair).sort((a,b)=>b.globalPair!.similarity-a.globalPair!.similarity).map(c=>({placeId:c.placeId,channel:'global',current:c.globalPair!.current,historical:c.globalPair!.historical}));
 const selected:typeof geometry=[],used=new Set<string>();
 const add=(p:typeof geometry[number])=>{const key=p.current.path+'\0'+p.historical.path;if(used.has(key))return false;used.add(key);selected.push(p);return true;};
 if(geometry[0])add(geometry[0]);
 if(maxPairs>1)for(const p of global)if(add(p))break;
 const pool=[...geometry,...global];
 while(selected.length<maxPairs){
  const usedBuckets=new Set(selected.map(p=>Math.min(2,Math.floor(currentIds.indexOf(p.current.id)*3/Math.max(1,currentIds.length)))));
  const remaining=pool.filter(p=>!used.has(p.current.path+'\0'+p.historical.path));if(!remaining.length)break;
  const pick=remaining.find(p=>!usedBuckets.has(Math.min(2,Math.floor(currentIds.indexOf(p.current.id)*3/Math.max(1,currentIds.length)))))??remaining.find(p=>!selected.some(s=>s.placeId===p.placeId))??remaining[0]!;
  add(pick);
 }
 return selected;
}
