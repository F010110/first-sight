/** Explicit six-run batch: two independent trajectory inputs x three fresh runs, max USD3, fail-stop. */
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const [outputArg,...flags]=process.argv.slice(2);
if(!outputArg||!flags.includes('--confirm-paid')||flags.some(f=>f!=='--confirm-paid'&&!f.startsWith('--prior-cost=')))throw Error('Usage: run-tartanground-expanded-batch NEW-OUTPUT --confirm-paid [--prior-cost=USD]');
const priorCost=Number(flags.find(f=>f.startsWith('--prior-cost='))?.slice('--prior-cost='.length)??0);
if(!Number.isFinite(priorCost)||priorCost<0||priorCost>=3)throw Error('Invalid prior batch cost');
const output=resolve(outputArg),sha=b=>createHash('sha256').update(b).digest('hex');
const samples=[{id:'p0006',root:'run/spatial-evaluation-inputs/tartanground-moderncity-p0006-v1',count:77},{id:'p0001',root:'run/spatial-evaluation-inputs/tartanground-moderncity-p0001-v2',count:58}];
const code=['src/agent/spatial-fixed-group-agent.ts','src/agent/spatial-protocol-retry.ts','src/agent/spatial-reference-aliases.ts','src/agent/spatial-json-vlm.ts','src/agent/spatial-fixed-prompts.ts','src/agent/spatial-place-contract.ts','src/agent/spatial-ground-first.ts','src/agent/spatial-separated-protocol.ts','src/agent/spatial-candidate-recall.ts','src/agent/spatial-visual-recall.ts','src/agent/spatial-visit-topology.ts','src/agent/spatial-guarded-graph.ts','src/agent/bounded-network-retry.ts','src/sim/evaluation/run-spatial-fixed-evaluation.ts','scripts/evaluation/run-spatial-method2.mjs','scripts/evaluation/run-tartanground-method2-and-score.mjs','scripts/evaluation/score-spatial-repeat-batch.mjs'];
code.push(...code.filter(p=>p.endsWith('.ts')).map(p=>p.replace(/^src\//,'dist/current/').replace(/\.ts$/,'.js')));
const hashes=Object.fromEntries(await Promise.all(code.map(async p=>[p,sha(await readFile(p))])));
for(const sample of samples){sample.input=resolve(sample.root,'public.json');sample.features=resolve(sample.root,'features.rgb-v1.json');const raw=await readFile(sample.input),featureRaw=await readFile(sample.features),d=JSON.parse(raw),f=JSON.parse(featureRaw);sample.inputSha256=sha(raw);sample.featureSha256=sha(featureRaw);if(d.observations.length!==sample.count||f.rows.length!==sample.count||f.inputSha256!==sha(raw))throw Error('Prepared input mismatch');for(const row of d.observations)for(const v of row.views)if(sha(await readFile(v.path))!==v.sha256)throw Error('Original image changed');}
await mkdir(dirname(output),{recursive:true});await mkdir(output,{recursive:false});
const trials=[];for(let round=1;round<=3;round++)for(const sample of samples)trials.push({id:`${sample.id}-round-${round}`,sample:sample.id,round,method:'sequence',status:'pending',planned:sample.count});
const plan={schema:'tartanground-expanded-method2-v1',samples,trials,sourceHashes:hashes,maxEstimatedUSD:3,maxPerRunEstimatedUSD:.5,maxCallsPerRun:256,plannedObservations:405,freshMemoryPerTrial:true,automaticResume:false,stopOnFailure:true,independentGroundTruth:false,priorFailedRunExcluded:true,scope:'Two trajectories in ONE environment, not two independent scenes or generalization validation; prior USD0.0114116208 is preserved separately.'};
await writeFile(join(output,'plan.json'),JSON.stringify(plan,null,2));
let child=null,interrupted=false;for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{interrupted=true;child?.kill(signal);});
const status={trials,estimatedUSD:priorCost,priorBatchEstimatedUSD:priorCost,unknownCallsReserved:0,finished:false};
const save=()=>writeFile(join(output,'status.json'),JSON.stringify(status,null,2));
await save();
function exec(script,args,log){return new Promise((done,reject)=>{child=spawn(process.execPath,[script,...args],{stdio:['ignore','pipe','pipe']});let text='';child.stdout.on('data',b=>{text+=b;});child.stderr.on('data',b=>{text+=b;});child.once('error',reject);child.once('close',async code=>{try{await writeFile(log,text);done(code);}catch(e){reject(e);}});});}
try{
 for(const trial of trials){
  if(interrupted)throw Error('Interrupted; no subsequent trial authorized automatically');
  if(status.estimatedUSD+.5>3+1e-9)throw Error('Batch remaining worst-case budget insufficient');
  for(const [path,hash] of Object.entries(hashes))if(sha(await readFile(path))!==hash)throw Error('Frozen source changed: '+path);
  const sample=samples.find(s=>s.id===trial.sample);
  if(sha(await readFile(sample.input))!==sample.inputSha256||sha(await readFile(sample.features))!==sample.featureSha256)throw Error('Frozen sample changed');
  trial.status='running';await save();console.log(JSON.stringify({starting:trial.id,planned:trial.planned,budgetRemaining:3-status.estimatedUSD}));
  const trialRoot=join(output,trial.id);const code=await exec('scripts/evaluation/run-tartanground-method2-and-score.mjs',[sample.input,sample.features,trialRoot,'--confirm-paid'],join(output,trial.id+'.log'));
  let complete;try{complete=JSON.parse(await readFile(join(trialRoot,'complete.json'),'utf8'));}catch{trial.status='failed';await save();throw Error('Trial did not publish completion; preserve logs, no resume');}
  trial.runRoot=complete.runRoot;trial.completed=complete.completed;
  const usage=JSON.parse(await readFile(join(complete.runRoot,'requests/usage.json'),'utf8'));
  trial.estimatedUSD=usage.estimatedUSD;trial.calls=usage.calls;trial.unknownCallsReserved=usage.unknownCallsReserved;
  status.estimatedUSD+=usage.estimatedUSD;status.unknownCallsReserved+=usage.unknownCallsReserved;
  trial.status=code===0&&complete.inferenceComplete&&complete.scoringComplete?'completed':'failed';await save();
  const sampleRoot=join(output,sample.id);await mkdir(sampleRoot,{recursive:true});
  await writeFile(join(sampleRoot,'status.json'),JSON.stringify({trials:trials.filter(t=>t.sample===sample.id&&t.runRoot)},null,2));
  const scoreCode=await exec('scripts/evaluation/score-spatial-repeat-batch.mjs',[sampleRoot,join(sampleRoot,`scores-round-${trial.round}`)],join(output,trial.id+'-aggregate-score.log'));
  console.log(JSON.stringify({finished:trial.id,status:trial.status,completed:trial.completed,total:trial.planned,calls:trial.calls,estimatedUSD:trial.estimatedUSD,batchEstimatedUSD:status.estimatedUSD}));
  if(interrupted||trial.status!=='completed'||scoreCode!==0||status.unknownCallsReserved>0)throw Error('Failure, interrupted scoring, or unknown billing; batch stopped before next trial');
 }
 status.finished=true;await save();await writeFile(join(output,'complete.json'),JSON.stringify({completedTrials:6,plannedObservations:405,estimatedUSD:status.estimatedUSD,accuracy:null,perSampleReports:samples.map(s=>join(output,s.id,'scores-round-3/report.json'))},null,2));
 console.log(JSON.stringify({batchComplete:true,output,estimatedUSD:status.estimatedUSD}));
}catch(error){await save();await writeFile(join(output,'stopped.json'),JSON.stringify({error:String(error),estimatedUSD:status.estimatedUSD,automaticResume:false},null,2));console.error(String(error));process.exitCode=1;}
