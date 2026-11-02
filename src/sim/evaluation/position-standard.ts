export function derivePositionStandard(sample:any){
 const frames=sample.frames as any[],segments=sample.segments as any[];
 const core=(f:any)=>f.annotation.visibility==='clear'&&!f.annotation.boundaryUncertain;
 const representative=(segment:any)=>frames.slice(segment.startIndex,segment.endIndex+1).filter(core).sort((a,b)=>Math.abs(a.index-(segment.startIndex+segment.endIndex)/2)-Math.abs(b.index-(segment.startIndex+segment.endIndex)/2))[0];
 const visits=segments.map(s=>({segment:s,frame:representative(s)})).filter(v=>v.frame);
 const cases:any[]=[];
 const add=(kind:string,a:any,b:any)=>{
  const x=a.frame,y=b.frame;
  cases.push({id:`${kind}-${a.segment.id}-${b.segment.id}`,kind,expected:kind==='positive'?'same-region':kind==='negative'?'different-region':'same-facility-different-region',referenceId:x.id,currentId:y.id,referenceIndex:x.index,currentIndex:y.index,referenceAtMs:x.atMs,currentAtMs:y.atMs,gapMs:y.atMs-x.atMs,referenceRegion:x.annotation.placeId,currentRegion:y.annotation.placeId,referenceFacility:x.annotation.facilityId,currentFacility:y.annotation.facilityId,referenceVisit:{startIndex:a.segment.startIndex,endIndex:a.segment.endIndex},currentVisit:{startIndex:b.segment.startIndex,endIndex:b.segment.endIndex},authority:'Deterministically derived from user-confirmed region/facility labels; not newly inferred image identity'});
 };
 for(let i=0;i<visits.length;i++)for(let j=i+1;j<visits.length;j++){
  const a=visits[i]!,b=visits[j]!,x=a.frame.annotation,y=b.frame.annotation;
  if(x.placeId===y.placeId&&b.frame.atMs-a.frame.atMs>=60000)add('positive',a,b);
  else if(x.placeId!==y.placeId&&x.facilityId&&x.facilityId===y.facilityId)add('hierarchy',a,b);
 }
 // Balanced, deterministic distinct-region controls; no visual-similarity claims or new labels.
 const seen=new Set<string>();
 for(const a of visits)for(const b of visits){
  const x=a.frame.annotation,y=b.frame.annotation;
  if(a.frame.index>=b.frame.index||b.frame.atMs-a.frame.atMs<60000||x.placeId===y.placeId||x.facilityId===y.facilityId||a.segment.kind!==b.segment.kind)continue;
  const key=[x.placeId,y.placeId].sort().join('|');if(seen.has(key))continue;seen.add(key);
  if(cases.filter(c=>c.kind==='negative').length<16)add('negative',a,b);
 }
 return {cases,coreFrames:frames.filter(core).length,excludedBoundaryOrLimited:frames.filter(f=>!core(f)).length,visitsWithoutCore:segments.filter(s=>!representative(s)).map(s=>s.id)};
}
