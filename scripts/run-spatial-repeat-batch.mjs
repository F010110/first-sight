/** Nine NEW serial trials. Never resume, splice successes, or auto-retry a trial. */
import {spawn} from 'node:child_process';import {createWriteStream} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';import {resolve,dirname,join} from 'node:path';import {createHash} from 'node:crypto';
const [destination,inputPath,featuresPath,confirm]=process.argv.slice(2);
if(!destination||!inputPath||!featuresPath||confirm!=='--confirm-paid')throw Error('Usage: run-spatial-repeat-batch NEW-batch-directory PUBLIC-input.json FEATURES.json --confirm-paid');
if(!process.env.QWEN_API_KEY||!process.env.QWEN_BASE_URL)throw Error('Missing Qwen configuration; no batch started');
const root=resolve(destination),input=resolve(inputPath),features=resolve(featuresPath),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inputRaw=await readFile(input),featuresRaw=await readFile(features);
if(JSON.parse(featuresRaw).inputSha256!==sha(inputRaw))throw Error('Features not bound to public source');
const source=await readFile('src/desktop/run-spatial-fixed-evaluation.ts','utf8');
const files=[...source.match(/const sourceFiles=\[(.*?)\];/s)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
const paths=[...files,...files.map(p=>p.replace(/^src\//,'dist/current/').replace(/\.ts$/,'.js')),'scripts/run-spatial-repeat-batch.mjs',input,features];
const hashes=Object.fromEntries(await Promise.all(paths.map(async path=>[path,sha(await readFile(path))])));
await mkdir(dirname(root),{recursive:true});await mkdir(root);
const trials=[['recall','sequence','graph'],['sequence','graph','recall'],['graph','recall','sequence']].flatMap((order,index)=>order.map(method=>({id:`round-${index+1}-${method}`,round:index+1,method,status:'pending',runRoot:null,estimatedUSD:null})));
const plan={schema:'spatial-repeat-batch-v1',createdAt:new Date().toISOString(),input,features,inputSha256:sha(inputRaw),observations:JSON.parse(inputRaw).observations.length,plannedTrials:9,repeatsPerMethod:3,maxCallsPerTrial:256,maxEstimatedUSDPerTrial:.5,maxBatchEstimatedUSD:4.5,methodOrder:'Rotated across rounds; serial, no overlapping paid trials',hashes,policy:'New empty memory every trial. Preserve all failures. No automatic resume, no success splicing, no frontend replacement. Current 64-second segment only, NOT all-campus evaluation.'};
await writeFile(join(root,'plan.json'),JSON.stringify(plan,null,2),{flag:'wx'});
let billed=0,stopped=null;
const save=()=>writeFile(join(root,'status.json'),JSON.stringify({updatedAt:new Date().toISOString(),estimatedUSD:billed,stopped,trials},null,2));
await save();console.log(JSON.stringify({batchRoot:root,plan:'9 new trials / 3 methods / 3 repetitions',maxEstimatedUSD:4.5}));
try{
 for(const trial of trials){
  for(const [path,hash] of Object.entries(hashes))if(sha(await readFile(path))!==hash)throw Error('Frozen input/code changed: '+path);
  if(billed+.5>plan.maxBatchEstimatedUSD+1e-9)throw Error('Batch reservation would exceed cost cap');
  trial.status='running';await save();
  const args=['--use-env-proxy','dist/current/desktop/run-spatial-fixed-evaluation.js',input,'--ground-first','--comparative-resolution','--continuous-region-scope','--short-references',`--candidate-features=${features}`,...trial.method==='recall'?[]:[`--visit-context=${trial.method}`],'--max-calls=256','--confirm-paid'];
  await writeFile(join(root,trial.id+'-command.json'),JSON.stringify({executable:process.execPath,args},null,2),{flag:'wx'});
  console.log(JSON.stringify({trial:trial.id,event:'started'}));
  const log=createWriteStream(join(root,trial.id+'.log'),{flags:'wx'});let stdout='';
  const exitCode=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe']});child.stdout.on('data',chunk=>{stdout+=chunk;log.write(chunk);});child.stderr.on('data',chunk=>log.write(chunk));child.on('error',reject);child.on('close',resolve);});
  await new Promise(resolve=>log.end(resolve));
  const receipts=stdout.split(/\r?\n/).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  const result=receipts.findLast(r=>typeof r.root==='string'&&Number.isInteger(r.total));
  if(!result)throw Error('Missing trial result; inspect '+trial.id+'.log before any manual recovery');
  trial.runRoot=result.root;
  const usage=JSON.parse(await readFile(join(result.root,'requests/usage.json'),'utf8'));
  if(!Number.isFinite(usage.estimatedUSD)||usage.estimatedUSD<0)throw Error('Unaccounted trial usage');
  trial.estimatedUSD=usage.estimatedUSD;billed+=usage.estimatedUSD;
  trial.status=exitCode===0&&!result.error&&result.completed===result.total?'completed':'failed';
  trial.error=result.error??(exitCode?'Child exit '+exitCode:null);
  await save();console.log(JSON.stringify({trial:trial.id,event:trial.status,runRoot:trial.runRoot,estimatedUSD:billed}));
  if(usage.unknownCallsReserved>0)throw Error('Unknown billing reservation: stop batch for review');
  if(billed>plan.maxBatchEstimatedUSD)throw Error('Batch estimated cost exceeded cap');
 }
 await writeFile(join(root,'complete.json'),JSON.stringify({finishedAt:new Date().toISOString(),estimatedUSD:billed,completed:trials.filter(t=>t.status==='completed').length,failed:trials.filter(t=>t.status==='failed').length,total:trials.length,trials},null,2),{flag:'wx'});
}catch(error){stopped=String(error);await save();await writeFile(join(root,'stopped.json'),JSON.stringify({error:stopped,estimatedUSD:billed},null,2),{flag:'wx'});process.exitCode=1;}
console.log(JSON.stringify({batchRoot:root,stopped,estimatedUSD:billed,completed:trials.filter(t=>t.status==='completed').length,total:trials.length}));
