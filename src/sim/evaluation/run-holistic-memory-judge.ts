import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {prepareHolisticBundle} from './holistic-memory-bundle.js';
import {runHolisticJudge} from './holistic-memory-judge.js';
import {verifyHolisticJudge} from './verify-holistic-memory-judge.js';
import {saveHolisticWorkflow} from './holistic-memory-workflow.js';
import {evaluationJsonVlm} from './evaluation-json-vlm.js';

const [run,reference,out,confirm]=process.argv.slice(2);
if(!run||!reference||!out||confirm!=='--confirm-paid'||process.argv.length!==6)throw Error('Usage: run-holistic-memory-judge RUN REFERENCE-SAMPLE.json NEW-OUTPUT --confirm-paid');
const base=process.env.QWEN_BASE_URL,key=process.env.QWEN_API_KEY;if(!base||!key)throw Error('Missing Qwen configuration');
const response=await fetch(base.replace(/\/$/,'')+'/models',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Qwen registry HTTP '+response.status);const registry=await response.json() as any;
const model=registry.data?.find((m:any)=>m.id==='qwen3.8-max-0902');if(!model)throw Error('Requested same-version Max unavailable; no fallback');
const bundle=await prepareHolisticBundle(run,reference,out);await writeFile(join(out,'model.json'),JSON.stringify(model),{flag:'wx'});
execFileSync(resolve('.venv/Scripts/python.exe'),['scripts/review/build-memory-judge-sheets.py',join(out,'bundle.json'),join(out,'sheets')],{stdio:'inherit'});
await readFile(join(out,'sheets/manifest.json'));
// One shared ledger bounds the entire workflow (2 controls + 8 Agent turns + 2 blind-first checks).
const request=evaluationJsonVlm(join(out,'requests'),12,{transport:'qwen',allowTextOnly:true,maxInputChars:240000,maxTotalTokens:900000});
await writeFile(join(out,'workflow-policy.json'),JSON.stringify({maxCalls:12,maxTotalTokens:900000,stages:['two batched calibrations','bounded holistic Agent (max8)','source-first independent verification (max2)'],noAutomatic813:true}),{flag:'wx'});
const result=await runHolisticJudge(bundle,resolve(out),request);
await verifyHolisticJudge(join(out,'bundle.json'),join(out,'source-first'),request);
const workflow=await saveHolisticWorkflow(out,join(out,'report.json'),join(out,'source-first/report.json'));
console.log(JSON.stringify({completed:result.completed,scores:result.scores,coverage:result.coverage,workflow,out}));
