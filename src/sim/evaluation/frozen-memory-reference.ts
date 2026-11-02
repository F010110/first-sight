export type ReferenceFact={id:string;camera:'front'|'left'|'right';text:string;importance:'core'|'detail'};
export type FrameReference={id:string;atMs:number;facts:ReferenceFact[];unknowns:string[];authority:string};
export function validateReferenceDraft(raw:any){
 if(!raw||!Array.isArray(raw.facts)||raw.facts.length>18||!Array.isArray(raw.unknowns)||raw.unknowns.some((s:any)=>typeof s!=='string'||!s.trim()))throw Error('Invalid visual reference draft');
 for(const f of raw.facts)if(!f||!['front','left','right'].includes(f.camera)||!['core','detail'].includes(f.importance)||typeof f.text!=='string'||!f.text.trim()||f.text.length>350)throw Error('Invalid fixed reference fact');
 return {facts:raw.facts.map((f:any,i:number)=>({id:`f${i}`,camera:f.camera,text:f.text,importance:f.importance})) as ReferenceFact[],unknowns:raw.unknowns as string[]};
}
export function verifyReference(draft:ReturnType<typeof validateReferenceDraft>,raw:any){
 if(!raw||!Array.isArray(raw.checks)||raw.checks.length!==draft.facts.length||new Set(raw.checks.map((c:any)=>c.id)).size!==draft.facts.length||raw.checks.some((c:any)=>!draft.facts.some(f=>f.id===c.id)||!['supported','rejected','uncertain'].includes(c.verdict)||typeof c.reason!=='string')||!Array.isArray(raw.unknowns)||raw.unknowns.some((s:any)=>typeof s!=='string'))throw Error('Invalid complete reference verification');
 return {facts:draft.facts.filter(f=>raw.checks.find((c:any)=>c.id===f.id).verdict==='supported'),unknowns:[...draft.unknowns,...raw.unknowns],checks:raw.checks};
}
export type ReferenceMatch={factId:string;coverage:'full'|'partial'|'missing'|'reference-disputed';reason:string};
export function validateReferenceScore(raw:any,reference:FrameReference){
 if(!raw||!Array.isArray(raw.matches)||raw.matches.length!==reference.facts.length||new Set(raw.matches.map((m:any)=>m.factId)).size!==reference.facts.length||raw.matches.some((m:any)=>!reference.facts.some(f=>f.id===m.factId)||!['full','partial','missing','reference-disputed'].includes(m.coverage)||typeof m.reason!=='string')||!Array.isArray(raw.errors)||raw.errors.some((e:any)=>!['contradiction','not-in-reference'].includes(e.kind)||typeof e.quote!=='string'||!e.quote.trim()||typeof e.reason!=='string'||e.kind==='contradiction'&&!reference.facts.some(f=>f.id===e.referenceFactId))||typeof raw.reason!=='string')throw Error('Invalid fixed-reference score');
 return raw as {matches:ReferenceMatch[];errors:Array<{kind:'contradiction'|'not-in-reference';referenceFactId:string|null;quote:string;reason:string}>;reason:string};
}
export function referenceCoverage(reference:FrameReference,score:ReturnType<typeof validateReferenceScore>|null){
 const facts=reference.facts.filter(f=>f.importance==='core');
 return {earned:score&&!facts.some(f=>score.matches.find(m=>m.factId===f.id)!.coverage==='reference-disputed')?facts.reduce((n,f)=>{const c=score.matches.find(m=>m.factId===f.id)!.coverage;return n+(c==='full'?1:c==='partial'?.5:0);},0):null,possible:facts.length};
}
