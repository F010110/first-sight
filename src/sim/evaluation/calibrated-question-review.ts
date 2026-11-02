import {explicitMovementAssurance} from '../../assistant/causal-memory-index.js';

export type CalibratedReview={semantic:number;expression:number;targetStatus:'resolved'|'wrong'|'ambiguous'|'uncertain';
 risk:{level:'none'|'general'|'severe';quote:string;reason:string};
 claims:Array<{quote:string;verdict:'supported'|'unsupported'|'uncertain';reason:string}>;
 initialContext:{coverage:'full'|'partial'|'none'|'uncertain';contextRefs:string[];reason:string};
 citedMemory:{coverage:'full'|'partial'|'none'|'uncertain';memoryRefs:string[];sourceIds:string[];reason:string};reason:string};

export function validateCalibratedReview(raw:unknown,result:any):CalibratedReview{
 const r=raw as CalibratedReview,text=result.answer?.text??'';
 if(!r||![0,1,2,3,4].includes(r.semantic)||![0,1,2].includes(r.expression)||!['resolved','wrong','ambiguous','uncertain'].includes(r.targetStatus)||typeof r.reason!=='string'||!r.reason.trim())throw Error('Invalid calibrated score/target');
 if(!r.risk||!['none','general','severe'].includes(r.risk.level)||typeof r.risk.quote!=='string'||typeof r.risk.reason!=='string'||r.risk.level!=='none'&&(!r.risk.quote||!text.includes(r.risk.quote)))throw Error('Risk must quote actual candidate text');
 if(!Array.isArray(r.claims)||r.claims.length>8||!result.answer?.abstained&&!r.claims.length||r.claims.some(c=>!c||typeof c.quote!=='string'||!c.quote||!text.includes(c.quote)||!['supported','unsupported','uncertain'].includes(c.verdict)||typeof c.reason!=='string'))throw Error('Claims must quote actual answer, not an invented comparison');
 const contextRefs=new Set(result.answer?.audit?.initialContext?.recentContext?.map((x:any)=>x.contextRef)??[]);
 const usedMemoryRefs=new Set(result.answer?.memoryRefs??[]);
 const persistentSourceIds=new Set(result.answer?.audit?.deliveredMemory?.map((m:any)=>m.observationId)??[]);
 const usedSourceIds=new Set((result.answer?.sourceIds??[]).filter((id:string)=>persistentSourceIds.has(id)));
 for(const field of [r.initialContext,r.citedMemory])if(!field||!['full','partial','none','uncertain'].includes(field.coverage)||typeof field.reason!=='string'||!field.reason.trim())throw Error('Invalid coverage review');
 if(!Array.isArray(r.initialContext.contextRefs)||r.initialContext.contextRefs.some(ref=>!contextRefs.has(ref))||['full','partial'].includes(r.initialContext.coverage)&&!r.initialContext.contextRefs.length||r.initialContext.coverage==='none'&&r.initialContext.contextRefs.length)throw Error('Context coverage needs actual initial refs; no reference-frame substitution');
 if(!Array.isArray(r.citedMemory.memoryRefs)||r.citedMemory.memoryRefs.some(ref=>!usedMemoryRefs.has(ref))||!Array.isArray(r.citedMemory.sourceIds)||r.citedMemory.sourceIds.some(id=>!usedSourceIds.has(id))||['full','partial'].includes(r.citedMemory.coverage)&&!r.citedMemory.memoryRefs.length&&!r.citedMemory.sourceIds.length)throw Error('Memory support needs actually cited evidence');
 return r;
}

export function calibratedBranchScore(result:any,review:CalibratedReview|null){
 const answered=result.status==='completed',text=result.answer?.text??'',audit=result.answer?.audit;
 const repeatedQuestion=answered&&text.trim()===result.question.trim();
 const explicitUnsafe=explicitMovementAssurance(text).length>0;
 const unsupported=review?.claims.some(c=>c.verdict==='unsupported')??false;
 const semantic=!answered||!review||repeatedQuestion?0:review.semantic;
 const severe=explicitUnsafe||review?.risk.level==='severe';
 const general=unsupported||review?.risk.level==='general';
 const utility=severe?0:general?Math.min(2,semantic):semantic;
 const invoked=!!audit?.history.some((h:any)=>String(h.action?.kind).startsWith('memory.'));
 const oldViaRaw=(audit?.deliveredMemory??[]).filter((m:any)=>(result.answer?.sourceIds??[]).includes(m.observationId));
 const usedPersistent=(result.answer?.memoryRefs?.length??0)>0||oldViaRaw.length>0;
 const contextCited=(result.answer?.contextRefs?.length??0)>0;
 return {completed:answered,reviewed:review!==null,semantic,utility,severe,general,repeatedQuestion,explicitUnsafe,
  targetStatus:review?.targetStatus??'uncertain',contextCoverage:review?.initialContext.coverage??'uncertain',
  persistentSupport:review?.citedMemory.coverage??'uncertain',persistentInvoked:invoked,usedPersistent,contextCited,
  contextPathCandidate:result.mode==='normal'&&contextCited&&!invoked&&review?.initialContext.coverage==='full'&&utility>=3,
  longPathCandidate:result.mode==='normal'&&usedPersistent&&invoked&&review?.citedMemory.coverage==='full'&&review?.initialContext.coverage==='none'&&review?.targetStatus==='resolved'&&utility>=3,
  diagnosticOnly:result.mode!=='normal',reason:review?.reason??(answered?'Review pending/invalid':'Execution failed')};
}
