/** Development scores: ordinal model review, never an image-ground-truth accuracy claim. */
export type ObservationReview={grounding:number;coverage:number;direction:number;temporal:number;issues:Array<{quote:string;kind:'unsupported'|'wrong_direction'|'stale'|'missing';reason:string}>;reason:string};
export type AssociationReview={support:number;calibration:number;revisitFound:boolean|null;unsupportedIdentity:boolean;reason:string};
export type Metric={score:number|null;numerator:number;denominator:number;unit:string};
const rating=(n:unknown)=>Number.isInteger(n)&&Number(n)>=0&&Number(n)<=4;
export function validateObservationReview(raw:unknown,candidate:string):ObservationReview{
 const r=raw as ObservationReview;
 if(!r||![r.grounding,r.coverage,r.direction,r.temporal].every(rating)||typeof r.reason!=='string'||!r.reason.trim()||!Array.isArray(r.issues)||r.issues.length>12)throw Error('Invalid observation review');
 for(const issue of r.issues){
  if(!issue||!['unsupported','wrong_direction','stale','missing'].includes(issue.kind))throw Error('Invalid review issue kind');
  if(typeof issue.reason!=='string'||!issue.reason.trim()||typeof issue.quote!=='string'||issue.kind!=='missing'&&(!issue.quote||!candidate.includes(issue.quote)))throw Error('Issue must quote actual candidate text; missing facts are separate');
 }
 return r;
}
export function validateAssociationReview(raw:unknown,positive:boolean):AssociationReview{
 const r=raw as AssociationReview;
 if(!r||!rating(r.support)||!rating(r.calibration)||typeof r.unsupportedIdentity!=='boolean'||typeof r.reason!=='string'||!r.reason.trim()||(positive?typeof r.revisitFound!=='boolean':r.revisitFound!==null))throw Error('Invalid association review');
 return r;
}
export function metric(numerator:number,denominator:number,unit='percent'):Metric{return {score:denominator?100*numerator/denominator:null,numerator,denominator,unit};}
export type ObservationGrade={id:string;status:'completed'|'failed'|'not_run';review:ObservationReview|null;error:string|null};
export type AssociationGrade={id:string;positive:boolean;review:AssociationReview|null;error:string|null;targetDelivered:boolean;targetReadViaTool:boolean};
export function spatialScorecard(observations:ObservationGrade[],associations:AssociationGrade[],integrity:{checks:number;violations:string[]},planned:number){
 const reviewed=observations.filter(o=>o.review),ar=associations.filter(a=>a.review),positive=associations.filter(a=>a.positive);
 const dimension=(key:'grounding'|'coverage'|'direction'|'temporal')=>metric(observations.reduce((sum,o)=>sum+(o.status==='completed'?o.review?.[key]??0:0),0),planned*4,'ordinal-review-points-normalized');
 const dimensions={completion:metric(observations.filter(o=>o.status==='completed').length,planned),reviewCoverage:metric(reviewed.length,planned),
  grounding:dimension('grounding'),coverage:dimension('coverage'),direction:dimension('direction'),temporal:dimension('temporal'),
  associationReviewCoverage:metric(ar.length,associations.length),associationSupport:metric(associations.reduce((s,a)=>s+(a.review?.support??0),0),associations.length*4,'ordinal-review-points-normalized'),
  calibration:metric(associations.reduce((s,a)=>s+(a.review?.calibration??0),0),associations.length*4,'ordinal-review-points-normalized'),
  positiveRevisitRecall:metric(positive.filter(a=>a.review?.revisitFound).length,positive.length),
  positiveTargetDelivered:metric(positive.filter(a=>a.targetDelivered).length,positive.length),positiveTargetReadViaTool:metric(positive.filter(a=>a.targetReadViaTool).length,positive.length)};
 const unsupportedIdentity=ar.filter(a=>a.review!.unsupportedIdentity).length;
 // Fixed development routing thresholds, not a production acceptance claim or replacement for old 15-question gates.
 const coverageAdequate=planned>=6&&positive.length>=1&&associations.some(a=>!a.positive);
 const complete=observations.length===planned&&observations.every(o=>o.status==='completed'&&o.review)&&associations.every(a=>a.review);
 const passed=complete&&coverageAdequate&&integrity.violations.length===0&&unsupportedIdentity===0&&['grounding','coverage','direction','temporal','associationSupport','calibration','positiveRevisitRecall'].every(key=>{
  const value=dimensions[key as keyof typeof dimensions];return value.denominator===0||value.score!==null&&value.score>=({grounding:90,coverage:85,direction:95,temporal:95,associationSupport:90,calibration:90,positiveRevisitRecall:90} as Record<string,number>)[key]!;
 });
 return {dimensions,integrity,unsupportedIdentity,reviewed:reviewed.length,planned,gate:{passed,status:complete?(passed?'development-pass-not-production-certified':'failed'):'incomplete',coverageAdequate,policy:'development-routing-v1'},noSingleAggregate:true};
}
