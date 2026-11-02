import type {CalibratedReview} from './calibrated-question-review.js';
import {validateCalibratedReview} from './calibrated-question-review.js';
import {explicitMovementAssurance} from '../../assistant/causal-memory-index.js';

export type SemanticPart=Pick<CalibratedReview,'semantic'|'expression'|'targetStatus'|'risk'|'claims'|'reason'>;
/** Validate actual answer semantics independently of the judge's memory-channel fields. */
export function splitQuestionReview(raw:unknown,result:any){
 const r=raw as CalibratedReview;
 let semantic:SemanticPart|null=null,mechanism:Pick<CalibratedReview,'initialContext'|'citedMemory'>|null=null;
 let semanticError:string|null=null,mechanismError:string|null=null;
 try{
  // Use neutral channel fields solely to reuse semantic validation; never publish them as a corrected judge result.
  const semanticOnly=validateCalibratedReview({...r,initialContext:{coverage:'uncertain',contextRefs:[],reason:'Not assessed in semantic pass'},citedMemory:{coverage:'uncertain',memoryRefs:[],sourceIds:[],reason:'Not assessed in semantic pass'}},result);
  semantic={semantic:semanticOnly.semantic,expression:semanticOnly.expression,targetStatus:semanticOnly.targetStatus,risk:semanticOnly.risk,claims:semanticOnly.claims,reason:semanticOnly.reason};
 }catch(error){semanticError=String(error);}
 try{
  // Channel validation cannot depend on whether unrelated quoted claims validate.
  const channelOnly=validateCalibratedReview({...r,semantic:0,expression:0,targetStatus:'uncertain',risk:{level:'none',quote:'',reason:''},claims:[],reason:'Channel pass'},
   {...result,answer:{...result.answer,abstained:true}});
  mechanism={initialContext:channelOnly.initialContext,citedMemory:channelOnly.citedMemory};
 }catch(error){mechanismError=String(error);}
 return {semantic,mechanism,semanticError,mechanismError,rawPreserved:true as const};
}

export function scoreSplitReview(result:any,review:ReturnType<typeof splitQuestionReview>,answerability:'answerable'|'unanswerable'|'ambiguous'|'unknown'='unknown'){
 if(result.status!=='completed')return {status:'execution-failed',utility:0,semantic:0,mechanismValid:false};
 if(!review.semantic)return {status:'ungraded',utility:null,semantic:null,mechanismValid:review.mechanism!==null};
 const s=review.semantic,text=result.answer.text,repeat=text.trim()===result.question.trim();
 let utility=repeat||s.targetStatus==='wrong'?0:s.semantic;
 const severe=s.risk.level==='severe'||explicitMovementAssurance(text).length>0;
 if(severe)utility=0;
 else if(s.risk.level==='general'||s.claims.some(c=>c.verdict==='unsupported'))utility=Math.min(utility,2);
 if(result.answer.abstained&&answerability==='answerable')utility=Math.min(utility,1);
 return {status:'graded-development',utility,semantic:s.semantic,mechanismValid:review.mechanism!==null,severe,
  mechanismStatus:review.mechanism?'reviewed-not-causal-proof':'ungraded',
  note:'A valid semantic review is retained even if memory-channel review fails; judge correctness is not guaranteed'};
}

/** Keep every planned task; missing reviews produce a range, never fake zero or a cherry-picked mean. */
export function summarizeSplitScores(rows:Array<{utility:number|null}>){
 const known=rows.filter((r):r is {utility:number}=>r.utility!==null);
 if(known.some(r=>!Number.isInteger(r.utility)||r.utility<0||r.utility>4))throw Error('Invalid utility');
 const missing=rows.length-known.length,sum=known.reduce((n,r)=>n+r.utility,0),denominator=rows.length*4;
 return {planned:rows.length,graded:known.length,ungraded:missing,
  pointPercent:denominator&&missing===0?100*sum/denominator:null,
  possiblePercentRange:denominator?[100*sum/denominator,100*(sum+missing*4)/denominator]:null,
  note:'Ranges cover missing grading only, not semantic judge error; execution failures must already be explicit zero'};
}
