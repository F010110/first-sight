import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sha} from './holistic-memory-bundle.js';

/** Keep raw model scores immutable; a conflicting audit is not silently averaged away or assigned zero. */
export function combineHolisticReviews(primary:any,verification:any){
 const findings=verification?.review?.findings??[],contradicted=findings.filter((f:any)=>f.verdict==='contradicted'),uncertain=findings.filter((f:any)=>f.verdict==='uncertain');
 const status=!primary?.completed||!verification?.completed?'incomplete':contradicted.length?'disputed':uncertain.length?'needs-human-review':'model-reviewed-not-certified';
 return {schema:'holistic-memory-workflow-result-v1',status,primaryCompleted:primary?.completed===true,sourceFirstCompleted:verification?.completed===true,provisionalScores:primary?.scores??null,acceptedScores:null,contradicted,uncertain,primaryScoreOverwritten:false,automatic813:false,reason:status==='disputed'?'Source-first verification found a contradiction missed or differently assessed by the holistic judge; raw scores are not accepted':status==='incomplete'?'Evaluation execution or evidence coverage incomplete':'Model judgments still require human pilot review; no statistical accuracy or automatic pass claim'};
}

export async function saveHolisticWorkflow(out:string,primaryPath:string,verificationPath:string){
 const primary=await readFile(primaryPath),verification=await readFile(verificationPath),result={...combineHolisticReviews(JSON.parse(primary.toString()),JSON.parse(verification.toString())),artifactHashes:{primary:sha(primary),verification:sha(verification)}};
 await writeFile(join(out,'workflow-result.json'),JSON.stringify(result,null,2),{flag:'wx'});return result;
}
