import type {MemoryRow} from './memory-evaluation-session.js';
export interface RepairQuestion{id:string;question:string;queryAtMs:number;currentObservationId:string}
/** Public source addresses only; no correctness/answerability labels. */
export function publicRequiredEvidenceIds(question:RepairQuestion,rows:MemoryRow[]):string[]{
 const required=new Set<string>();if(question.question.includes('当前'))required.add(question.currentObservationId);
 for(const match of question.question.matchAll(/第\s*(\d+)\s*段\s*([\d.]+)\s*秒/g)){
  const row=rows.find(r=>r.episodeNumber===Number(match[1])&&Math.abs(r.sourceAtMs-Number(match[2])*1000)<1&&r.atMs<question.queryAtMs);
  if(row)required.add(row.id);
 }
 return [...required];
}
/** Uses only the public question and actual inspected IDs, not grading truth. */
export function answerFailures(raw:string,question:RepairQuestion,rows:MemoryRow[],inspected:Set<string>):string[]{
 let p:any;try{p=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch(e){return [`Invalid JSON: ${String(e)}. Escape quotes inside strings and emit only a JSON object.`];}
 const failures:string[]=[];
 if(typeof p.answer!=='string'||!p.answer.trim())failures.push('answer must be a non-empty string.');
 if(typeof p.abstained!=='boolean')failures.push('abstained must be an explicit boolean.');
 if(!Array.isArray(p.historicalEvidenceIds)||p.historicalEvidenceIds.some((id:unknown)=>typeof id!=='string'))return [...failures,'historicalEvidenceIds must be an array of string IDs.'];
 const ids=p.historicalEvidenceIds as string[];
 if(ids.some(id=>!inspected.has(id)))failures.push('Some citations were not actually inspected. Search and inspect them before citing, or remove unsupported claims.');
 const answer=typeof p.answer==='string'?p.answer:'';
  // A visibility-limited refusal is not a confident claim about hidden contents.
  // Do not treat unrestricted "history never contained X" as such a refusal.
  const limitedVisibility=/^(?:当前(?:视野|画面|视角)(?:中|内)?)(?:未检测到|未看到|看不到|未显示)/.test(answer);
  const uncertain=limitedVisibility||/无法|不能确认|不能确定|不能证明|无法证明|不确定|不知道|证据不足|无法判断|无法从|不能[。！，]/.test(answer);
 if(p.abstained===true&&!uncertain)failures.push('abstained=true conflicts with a substantive answer without uncertainty. Align the flag with the answer; do not invent certainty.');
  if(p.abstained===false&&/无法确认|无法确定|无法判断|无法证明|不能确认|不能确定|不能证明|证据不足|^(无法|不确定|不知道|不能[。！，])/.test(answer))failures.push('The answer explicitly refuses verification, but abstained=false. Set abstained=true when evidence cannot establish the requested fact.');
 if(p.abstained===false){
  const required=publicRequiredEvidenceIds(question,rows);
  if(!ids.length)failures.push('Non-abstained answers require original evidence citations.');
  const missing=required.filter(id=>!ids.includes(id));
  if(missing.length)failures.push(`Missing evidence for explicitly named records: ${missing.join(', ')}. These IDs are derived from public timestamps/current record, not an answer key. Search and inspect the requested records and cite every supported part, or abstain.`);
 }
 return failures;
}

export function repairFeedback(previous:string,reasons:string[]):string{
 return `Your previous output failed runtime validation. Reasons: ${JSON.stringify(reasons)}\nPrevious output: ${previous.slice(0,6000)}\nRepair the format/citations/flag using actual available evidence. Do not change the factual answer merely to satisfy a guessed answer key. No correctness label or reference answer is supplied. If you lack evidence, explicitly abstain. Return the mandatory JSON object.`;
}
