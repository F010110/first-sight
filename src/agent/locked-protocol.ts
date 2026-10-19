/** No factual rewrite, unknown keys, automatic citations or hidden answer selection. */
export function lockedProtocolPatch(originalRaw:string,patchRaw:string):string{
 const parse=(s:string)=>JSON.parse(s.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
 const original=parse(originalRaw),patch=parse(patchRaw);
 if(!original||typeof original.answer!=='string'||!original.answer.trim())throw Error('Original answer is not lockable');
 if(!patch||Array.isArray(patch)||Object.keys(patch).some(k=>!['historicalEvidenceIds','abstained'].includes(k))||typeof patch.abstained!=='boolean'||!Array.isArray(patch.historicalEvidenceIds)||!patch.historicalEvidenceIds.every((id:unknown)=>typeof id==='string'))throw Error('Invalid metadata-only patch');
 return JSON.stringify({...original,historicalEvidenceIds:patch.historicalEvidenceIds,abstained:patch.abstained});
}
