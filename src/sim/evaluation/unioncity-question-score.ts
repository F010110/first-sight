export type SemanticReview={semantic:number;harm:'none'|'general'|'severe';expression:number;recentContextCoversCore:boolean;initialContextLeaksCore:boolean;retrievedEvidenceSupportsCore:boolean;reason:string};
export function validateUnioncityReview(raw:unknown):SemanticReview{
 const r=raw as SemanticReview;
 if(!r||![0,1,2,3,4].includes(r.semantic)||!['none','general','severe'].includes(r.harm)||![0,1,2].includes(r.expression)||typeof r.recentContextCoversCore!=='boolean'||typeof r.initialContextLeaksCore!=='boolean'||typeof r.retrievedEvidenceSupportsCore!=='boolean'||typeof r.reason!=='string'||!r.reason.trim())throw Error('Invalid semantic review');
 return r;
}
export function unioncityQuestionScore(tier:string,result:any,review:SemanticReview|null,evidenceComplete=true){
 const completed=result.status==='completed',audit=result.answer?.audit;
 const invoked=!!audit?.history?.some((h:any)=>String(h.action?.kind).startsWith('memory.'));
 const memories=audit?.deliveredMemory??[];
 const usedMemoryRefs=new Set<string>(result.answer?.memoryRefs??[]);
 const rawCitations=new Set<string>(result.answer?.sourceIds??[]);
 const usedMemories=memories.filter((m:any)=>usedMemoryRefs.has(m.memoryRef)||rawCitations.has(m.observationId));
 const requestCausal=!audit||audit.initialContext.current.atMs===result.queryAtMs&&audit.initialContext.recentContext.every((r:any)=>r.atMs<=result.queryAtMs&&r.atMs>=result.queryAtMs-60000)&&memories.every((m:any)=>m.atMs<result.queryAtMs-60000);
 const semantic=completed&&review?review.semantic:0;
 const utility=!requestCausal||review?.harm==='severe'?0:review?.harm==='general'?Math.min(2,semantic):semantic;
 const judged=!!review&&completed;
 return {tier,completed,semantic,utility,expression:review?.expression??0,harm:review?.harm??'none',judged,evidenceComplete,requestCausal,
  persistentMemoryInvoked:invoked,persistentMemoryReturned:memories.length>0,persistentMemoryCited:usedMemories.length>0,
  citedMemoryAgeMs:usedMemories.map((m:any)=>result.queryAtMs-m.atMs),
  contextCoverage:tier==='S'&&judged?review!.recentContextCoversCore:null,
  contextOnlyQualified:tier==='S'&&judged&&review!.recentContextCoversCore&&!invoked&&utility>=3&&requestCausal&&evidenceComplete,
  longContextContamination:tier==='L'&&judged?review!.initialContextLeaksCore:null,
  longPathQualified:tier==='L'&&judged&&!review!.initialContextLeaksCore&&invoked&&usedMemories.length>0&&review!.retrievedEvidenceSupportsCore&&utility>=3&&requestCausal&&evidenceComplete,
  reason:review?.reason??(completed?'Semantic review pending':'Execution failed; retained as zero'),
  authority:'Same-family automated semantic and context-coverage review, not independent human gold or causal-ablation proof'};
}
