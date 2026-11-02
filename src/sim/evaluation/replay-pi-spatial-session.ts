import {readFile,writeFile,mkdir,statfs} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spatialJsonVlm} from '../../agent/spatial-json-vlm.js';
import {createSpatialSession} from '../../assistant/harness/spatial-session.js';

const [inputArg,outArg,flag]=process.argv.slice(2);
if(!inputArg||!outArg||!['--confirm-paid','--resume-paid'].includes(flag!))throw Error('Usage: replay-pi-spatial-session PUBLIC-INPUT OUTPUT --confirm-paid|--resume-paid');
const resume=flag==='--resume-paid';
const inputPath=resolve(inputArg),root=resolve(outArg),bytes=await readFile(inputPath),input=JSON.parse(bytes.toString());
const rows=input.observations;
if(!Array.isArray(rows)||!rows.length||rows.some((r:any,i:number)=>typeof r.id!=='string'||!Number.isFinite(r.atMs)||!Array.isArray(r.views)||r.views.length!==3||i>0&&r.atMs<=rows[i-1].atMs))throw Error('Invalid chronological triplet input');
const space=await statfs(dirname(root));if(space.bavail*space.bsize<20_000_000_000)throw Error('20GB reserve');
if(resume){const old=JSON.parse(await readFile(join(root,'plan.json'),'utf8'));if(old.inputSHA256!==createHash('sha256').update(bytes).digest('hex')||old.observations!==rows.length)throw Error('Resume input changed');}
else{await mkdir(root,{recursive:false});await writeFile(join(root,'plan.json'),JSON.stringify({schema:'pi-spatial-session-replay-v1',inputPath,inputSHA256:createHash('sha256').update(bytes).digest('hex'),observations:rows.length,questions:0,scope:'Chronological original-image replay; no old extracted facts, private annotations, questions, grading, maps or future observations',maxCalls:4000,maxEstimatedUSD:60,costMeaning:'Emergency runaway guard; list-price estimates are not bills or verified quota'},null,2),{flag:'wx'});}
const files=['src/assistant/harness/spatial-session.ts','src/assistant/harness/session-context.ts','src/assistant/harness/provider-boundary.ts','skills/first-sight/spatial-memory/SKILL.md','skills/first-sight/current-visual-evidence/SKILL.md','skills/first-sight/context-compaction/SKILL.md'];
let completed=resume?(await readFile(join(root,'checkpoints.jsonl'),'utf8')).trim().split('\n').filter(Boolean).length:0;
if(completed>=rows.length)throw Error('Replay already complete');
await writeFile(join(root,resume?`implementation-resume-${completed+1}-${Date.now()}.json`:'implementation.json'),JSON.stringify(Object.fromEntries(await Promise.all(files.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')]))),null,2),{flag:'wx'});
const session=await createSpatialSession(root,spatialJsonVlm(join(root,'requests'),4000,60,true,1600),{resume});
try{
 for(const row of rows.slice(completed)){
  try{await readFile(join(root,'STOP'));throw Error('Replay stopped by STOP file');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const views=row.views.map((v:any)=>({id:row.id,direction:v.direction,path:v.path,sha256:v.sha256}));
  const checkpoint=await session.observe({id:row.id,atMs:row.atMs,sourceAtMs:row.sourceAtMs,views});completed++;
  await writeFile(join(root,'progress.json'),JSON.stringify({completed,planned:rows.length,lastAtMs:row.atMs,lastTipId:checkpoint.tipId}));
  console.log(JSON.stringify({completed,planned:rows.length,id:row.id,atMs:row.atMs}));
 }
 await writeFile(join(root,'complete.json'),JSON.stringify({completed,planned:rows.length,complete:completed===rows.length}));
}catch(error){await writeFile(join(root,resume?`failure-resume-${completed+1}-${Date.now()}.json`:'failure.json'),JSON.stringify({completed,planned:rows.length,error:String(error)}),{flag:'wx'});throw error;}
finally{await session.close();}
