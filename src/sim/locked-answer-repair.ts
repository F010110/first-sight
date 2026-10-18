import {answerFailures,type RepairQuestion} from './memory-answer-repair.js';
import type {MemoryRow} from './memory-evaluation-session.js';

export function parseAnswerObject(raw:string):Record<string,unknown>{
 const value=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.answer!=='string'||!value.answer.trim())throw Error('No lockable original answer');
 return value;
}

/** Model proposes metadata only. Never silently add citations or change facts. */
export function applyLockedProtocolPatch(originalRaw:string,patchRaw:string,q:RepairQuestion,rows:MemoryRow[],inspected:Set<string>):{raw:string;value:Record<string,unknown>}{
 const original=parseAnswerObject(originalRaw),patch=JSON.parse(patchRaw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
 if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['historicalEvidenceIds','abstained'].includes(k)))throw Error('Patch may contain ONLY historicalEvidenceIds and abstained; original answer is immutable');
 if(typeof patch.abstained!=='boolean'||!Array.isArray(patch.historicalEvidenceIds)||patch.historicalEvidenceIds.some((id:unknown)=>typeof id!=='string'))throw Error('Patch needs boolean abstained and string[] historicalEvidenceIds');
 if(patch.historicalEvidenceIds.some((id:string)=>!inspected.has(id)))throw Error('Patch cites evidence not actually viewed in original attempt');
 const value={...original,historicalEvidenceIds:patch.historicalEvidenceIds,abstained:patch.abstained};
 const raw=JSON.stringify(value),failures=answerFailures(raw,q,rows,inspected);
 if(failures.length)throw Error(failures.join(' '));
 return {raw,value};
}

export function lockedRepairPrompt(originalRaw:string,reasons:string[],q:RepairQuestion,sources:unknown[]):string{
 return `You are a protocol-metadata repair worker, NOT an answer writer. The original factual answer is IMMUTABLE. Do not solve the question again, rewrite it, improve it or guess a reference answer. Return ONLY {"historicalEvidenceIds":string[],"abstained":boolean}; no other keys. This patch will be rejected if it changes any other field. Select citations yourself from the actual supplied, originally viewed images below, only if they support the existing answer. Comparisons need citations for BOTH parts, including CURRENT images. CURRENT observation IDs are valid evidence IDs despite the field name historicalEvidenceIds. Never invent or automatically include every ID. If the locked answer explicitly cannot confirm the requested fact, abstained must be true, even when that phrase is after a subject prefix. A statement limited to something not visible in CURRENT view does not establish hidden contents; if that is the reason the requested hidden fact is not answered, abstained=true is appropriate. Do not use abstained=true to conceal a confident unsupported assertion. If the factual answer cannot be preserved with valid metadata, emit {"unrepairable":true}; it will be rejected and the original retained. No correctness label or answer key is available.\nPUBLIC QUESTION: ${q.question}\nIMMUTABLE ORIGINAL JSON: ${originalRaw}\nVALIDATION FAILURES: ${JSON.stringify(reasons)}\nACTUALLY VIEWED SOURCES (each image below has its own adjacent label): ${JSON.stringify(sources)}`;
}
