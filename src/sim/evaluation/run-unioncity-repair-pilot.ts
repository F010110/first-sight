import {readFile,writeFile,mkdir,appendFile,stat,statfs} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {answerCausalContextQuestionV2} from '../../assistant/causal-context-question-v2.js';
import {aliasedSpatialRequest} from '../../agent/spatial-reference-aliases.js';
import {spatialJsonVlm} from '../../agent/spatial-json-vlm.js';
import type {SpatialObservation} from '../../agent/incremental-spatial-memory.js';
import type {ThreeAgentStore} from '../../assistant/three-agent-store.js';
import {OrganizedExperienceMemory} from '../../assistant/organized-experience-memory.js';
import {answerWithPiHarness} from '../../assistant/harness/first-sight-harness.js';

const [freezeArg,outArg,...flags]=process.argv.slice(2);
if(!freezeArg||!outArg||flags.length!==1||flags[0]!=='--confirm-paid')throw Error('Usage: run-unioncity-repair-pilot PILOT-FREEZE NEW-OUTPUT --confirm-paid');
const freeze=resolve(freezeArg),out=resolve(outArg),load=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
const sha=(r:Buffer|string)=>createHash('sha256').update(r).digest('hex');
const plan=await load(join(freeze,'plan.json')),taskRaw=await readFile(join(freeze,'tasks.json')),snapshotRaw=await readFile(join(freeze,'snapshots.json'));
for(const previous of plan.previousAttempts??[]){const raw=await readFile(join(previous.path,'requests/usage.json'));if(sha(raw)!==previous.usageSHA256)throw Error('Previous pilot usage changed');}
if(sha(taskRaw)!==plan.tasksSHA256||sha(snapshotRaw)!==plan.snapshotsSHA256)throw Error('Pilot freeze changed');
const tasks=JSON.parse(taskRaw.toString()) as any[],snapshots=JSON.parse(snapshotRaw.toString());
let spatialBases:Record<string,any>|undefined;
if(plan.spatialReplay){
 const raw=await readFile(join(freeze,'spatial-bases.json'));
 if(sha(raw)!==plan.spatialReplay.basesSHA256||sha(await readFile(join(plan.spatialReplay.path,'checkpoints.jsonl')))!==plan.spatialReplay.checkpointsSHA256)throw Error('Spatial replay/session changed');
 for(const binding of plan.spatialReplay.sessions??[])if(sha(await readFile(binding.path))!==binding.sha256)throw Error('Spatial source session changed');
 spatialBases=JSON.parse(raw.toString());
}
if(plan.organization&&sha(await readFile(plan.organization.path))!==plan.organization.sha256)throw Error('Organization index changed');
const inputRaw=await readFile(plan.publicInputPath);if(sha(inputRaw)!==plan.publicInputSHA256)throw Error('Input changed');
const input=JSON.parse(inputRaw.toString()),byId=new Map<string,any>(input.observations.map((r:any)=>[r.id,r]));
const byTask=new Map<string,any>(tasks.map(t=>[t.id,t]));
const branches=[...plan.normal.map((id:string)=>({id,mode:'normal'})),...plan.memoryDisabled.map((id:string)=>({id,mode:'memory-disabled'})),...plan.suppliedEvidenceDiagnosticOnly.map((id:string)=>({id,mode:'supplied-evidence-diagnostic'}))];
if(tasks.length!==(plan.questions??15)||branches.length!==(plan.expectedBranches??37))throw Error('Pilot branch count changed');
for(const task of tasks){
 const raw=await readFile(snapshots[task.id].path);if(sha(raw)!==snapshots[task.id].sha256)throw Error('Snapshot changed');
 const snap=JSON.parse(raw.toString());if(snap.asOfMs!==task.queryAtMs||snap.results.some((r:any)=>r.source_at_ms>task.queryAtMs||(r.evidence_until_ms??r.source_at_ms)>task.queryAtMs))throw Error('Noncausal snapshot');
}
const free=await statfs(dirname(out));if(free.bavail*free.bsize<20_000_000_000)throw Error('20GB reserve');
await mkdir(out,{recursive:false});await mkdir(join(out,'cases'));
await writeFile(join(out,'frozen-plan.json'),JSON.stringify(plan,null,2),{flag:'wx'});
const files=['src/assistant/causal-context-question.ts','src/assistant/causal-context-question-v2.ts','src/assistant/memory-investigation-question.ts','src/assistant/organized-experience-memory.ts','src/assistant/causal-memory-index.ts','src/sim/evaluation/run-unioncity-repair-pilot.ts',...plan.runtime==='pi-harness-v1'?['src/assistant/harness/first-sight-harness.ts','src/assistant/harness/memory-access.ts','src/assistant/harness/provider-boundary.ts','src/assistant/harness/context-store.ts','src/assistant/harness/skill-registry.ts','skills/first-sight/first-sight-assistant/SKILL.md','skills/first-sight/memory-investigation/SKILL.md','skills/first-sight/visual-inspection/SKILL.md','skills/first-sight/context-compaction/SKILL.md']:[]];
await writeFile(join(out,'implementation.json'),JSON.stringify(Object.fromEntries(await Promise.all(files.map(async p=>[p,sha(await readFile(p))]))),null,2),{flag:'wx'});
const rawRequest=spatialJsonVlm(join(out,'requests'),plan.maxCalls.answers,plan.maxUSD.answers,true,plan.answerMaxOutputTokens??1000);
const request=plan.runtime==='pi-harness-v1'?rawRequest:aliasedSpatialRequest(rawRequest);
const observation=(id:string):SpatialObservation=>{const r=byId.get(id);if(!r)throw Error('Unknown observation');return {id:r.id,atMs:r.atMs,sourceAtMs:r.sourceAtMs,frames:r.views.map((v:any)=>v.path)};};
const images=async(rows:SpatialObservation[])=>{
 const all=rows.flatMap(r=>{const source=byId.get(r.id);return source.views.map((v:any)=>({id:r.id,...v}));});
 if(all.length>12)throw Error('Image budget');return all;
};
let privateRefs:any[]|null=null;const results:any[]=[];const started=Date.now();
try{
 for(const branch of branches){
  if(Date.now()-started>1800000)throw Error('30 minute wall-clock limit');
  try{await stat(join(out,'STOP'));throw Error('Stop file');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const space=await statfs(out);if(space.bavail*space.bsize<20_000_000_000)throw Error('20GB reserve');
  const task=byTask.get(branch.id),snapshot=await load(snapshots[branch.id].path) as ReturnType<ThreeAgentStore['snapshot']>;
  const current=observation(task.currentObservationId);let diagnostic:SpatialObservation[]=[];
  if(branch.mode==='supplied-evidence-diagnostic'){
   // This private lookup is strictly confined to the separately labelled diagnostic branch.
   if(!privateRefs){const raw=await readFile(join(freeze,'evaluation-only/references.json'));if(sha(raw)!==plan.referencesSHA256)throw Error('Private reference changed');privateRefs=JSON.parse(raw.toString());}
   const ref=privateRefs!.find(r=>r.id===task.id);if(!ref)throw Error('Missing diagnostic source');
   diagnostic=[...new Set<string>(ref.referenceObservations.filter((r:any)=>r.atMs<task.queryAtMs).map((r:any)=>r.id))].slice(0,3).map(observation);
  }
  const dir=join(out,'cases',`${branch.id}-${branch.mode}`);await mkdir(dir,{recursive:false});
  const start=Date.now();let result:any;
  try{
    const organization=plan.organization&&branch.mode==='normal'?new OrganizedExperienceMemory(plan.organization.path,true):undefined;
    let answer;
     try{answer=plan.runtime==='pi-harness-v1'?await answerWithPiHarness({question:task.question,row:current,snapshot,request,images,observation,sessionRoot:join(dir,'pi-session'),persistentMemory:branch.mode==='normal',diagnosticEvidence:diagnostic,...spatialBases&&branch.mode==='normal'?{spatialBase:spatialBases[task.id]}:{}}):await answerCausalContextQuestionV2(task.question,current,snapshot,request,images,observation,{persistentMemory:branch.mode==='normal',diagnosticEvidence:diagnostic,...organization?{organization,verifyTarget:plan.verifyTarget===true}:{}});}finally{organization?.close();}
   const {contextSHAInput,...audit}=answer.audit;
   result={id:task.id,mode:branch.mode,question:task.question,queryAtMs:task.queryAtMs,sourceQueryAtMs:task.sourceQueryAtMs,status:'completed',elapsedMs:Date.now()-start,
    snapshotSHA256:snapshots[task.id].sha256,answer:{...answer,audit:{...audit,initialContextSHA256:sha(contextSHAInput)}}};
  }catch(error){result={id:task.id,mode:branch.mode,question:task.question,queryAtMs:task.queryAtMs,status:'failed',elapsedMs:Date.now()-start,error:String(error),snapshotSHA256:snapshots[task.id].sha256};}
  await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2),{flag:'wx'});await appendFile(join(out,'results.jsonl'),JSON.stringify(result)+'\n');results.push(result);
  console.log(JSON.stringify({id:task.id,mode:branch.mode,status:result.status,elapsedMs:result.elapsedMs,settled:results.length}));
 }
 const sourceChecks=await Promise.all(tasks.map(async t=>sha(await readFile(snapshots[t.id].path))===snapshots[t.id].sha256));
 const report={completedScript:true,branches:results.length,completed:results.filter(r=>r.status==='completed').length,failed:results.filter(r=>r.status==='failed').length,
  oldSnapshotsUnchanged:sourceChecks.every(Boolean),oldPublicInputUnchanged:sha(await readFile(plan.publicInputPath))===plan.publicInputSHA256,
  oldResultsUnchanged:sha(await readFile(join(plan.baselineRun,'results.jsonl')))===plan.baselineResultsSHA256,wallElapsedMs:Date.now()-started,
  semantics:'Pending independent grading and targeted assistant review',diagnosticNotFormalScore:true};
 await writeFile(join(out,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
}catch(error){await writeFile(join(out,'stopped.json'),JSON.stringify({error:String(error),settled:results.length},null,2),{flag:'wx'});throw error;}
