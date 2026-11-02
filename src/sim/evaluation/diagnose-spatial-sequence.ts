import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spatialJsonVlm} from '../../agent/spatial-json-vlm.js';
import {createSpatialSession} from '../../assistant/harness/spatial-session.js';

const [outArg,confirm,mode]=process.argv.slice(2);
if(!outArg||confirm!=='--confirm-paid')throw Error('Usage: diagnose-spatial-sequence NEW-OUTPUT --confirm-paid');
const root=resolve(outArg),input=JSON.parse(await readFile('run/unioncity-questions90-v2-run1/input.json','utf8'));
if(mode!==undefined&&!['--evidence-ledger','--recall-probe'].includes(mode))throw Error('Unknown candidate mode');
const probe=mode==='--recall-probe',ledger=mode==='--evidence-ledger'||probe,indices=ledger?[71,90,164,180,250,385,793]:[71,90,164,180,793],rows=indices.map(i=>input.observations[i-1]);
const probeSkill=probe?(await readFile('skills/diagnostics/spatial-memory-ablation/SKILL.md','utf8')).split('## recall-probe\n')[1]!.trim():null;
await mkdir(root,{recursive:false});
await writeFile(join(root,'plan.json'),JSON.stringify({schema:'spatial-small-observation-integration-v2',indices,plannedObservations:rows.length,source:'same original triplets; ledger candidate adds one historical revisit source',diagnosticPerView:true,diagnosticSourceProjection:!ledger,diagnosticEvidenceLedger:ledger,limitations:['Sparse chronological observations; not a complete route','Short source-only request view alone does not demonstrate long-memory association retention','No full replay or user-question evaluation authorized by this run']},null,2));
const session=await createSpatialSession(root,spatialJsonVlm(join(root,'requests'),72,5,true,1600),{diagnosticPerView:true,diagnosticSourceProjection:!ledger,diagnosticEvidenceLedger:ledger,...probe?{diagnosticTaskForObservation:(id:string)=>['rerender-v2-000385','rerender-v2-000793'].includes(id)?probeSkill:null}:{}});
try{for(const row of rows){const result=await session.observe({...row,views:row.views.map((v:any)=>({...v,id:row.id}))});console.log(JSON.stringify({id:row.id,update:result.update}));}await writeFile(join(root,'complete.json'),JSON.stringify({completed:rows.length,planned:rows.length}));}finally{await session.close();}
