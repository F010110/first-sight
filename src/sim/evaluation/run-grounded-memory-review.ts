import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {prepareHolisticBundle} from './holistic-memory-bundle.js';
import {runGroundedReview} from './grounded-memory-review.js';

const [run,reference,out,confirm]=process.argv.slice(2);
if(!run||!reference||!out||confirm!=='--confirm-paid'||process.argv.length!==6)throw Error('Usage: run-grounded-memory-review RUN REFERENCE-SAMPLE.json NEW-OUTPUT --confirm-paid');
const base=process.env.QWEN_BASE_URL,key=process.env.QWEN_API_KEY;if(!base||!key)throw Error('Missing Qwen configuration');
const registry=await (await fetch(base.replace(/\/$/,'')+'/models',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(30000)})).json() as any;
const judgeModel=process.env.JUDGE_MODEL||'qwen3.8-flash';
const model=registry.data?.find((m:any)=>m.id===judgeModel);if(!model)throw Error('Requested judge model unavailable: '+judgeModel);if(!/^qwen3\.8-(max(?:-\d+)?|flash)$/.test(judgeModel))throw Error('Judge must be a configured Qwen 3.8 Max/Flash id');
const bundle=await prepareHolisticBundle(run,reference,out);
await writeFile(join(out,'model.json'),JSON.stringify(model),{flag:'wx'});
execFileSync(resolve('.venv/Scripts/python.exe'),['scripts/review/build-memory-judge-sheets.py',join(out,'bundle.json'),join(out,'sheets')],{stdio:'inherit'});
await readFile(join(out,'sheets/manifest.json'));
const report=await runGroundedReview(bundle,resolve(out),undefined,{model:judgeModel});
console.log(JSON.stringify({completed:report.completed,judge:judgeModel,overall:report.scores.overall,dimensions:report.requestedScores,caps:report.caps,contradicted:report.coverage.contradicted,uncertain:report.coverage.uncertain,windows:report.coverage.windows,chunks:report.chunks,out}));
