/** One explicitly authorized method2 run, then the existing offline scorer. No resume or synthetic truth. */
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const [inputArg,featuresArg,outputArg,...flags]=process.argv.slice(2);
if(!inputArg||!featuresArg||!outputArg||flags.length!==1||flags[0]!=='--confirm-paid')throw Error('Usage: run-tartanground-method2-and-score INPUT FEATURES NEW-OUTPUT --confirm-paid');
const input=resolve(inputArg),features=resolve(featuresArg),output=resolve(outputArg);
const raw=await readFile(input),featureRaw=await readFile(features),data=JSON.parse(raw),descriptor=JSON.parse(featureRaw);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const total=data.observations?.length;
if(!Number.isInteger(total)||total<1||total>1000||descriptor.inputSha256!==sha(raw)||descriptor.rows.length!==total)throw Error('Prepared input binding mismatch');
await mkdir(dirname(output),{recursive:true});await mkdir(output,{recursive:false});
const plan={schema:'single-method2-with-existing-scoring-v1',inputSha256:sha(raw),featuresSha256:sha(featureRaw),plannedObservations:total,estimatedUSDLimit:0.5,maxCalls:256,method:'sequence',paidAuthorized:true,automaticResume:false,accuracyLabelsAvailable:false,scorer:'scripts/evaluation/score-spatial-repeat-batch.mjs',accuracyScorer:'dist/current/sim/evaluation/score-spatial-acceptance.js',note:'No independently reviewed labels; semantic accuracy cannot be manufactured from poses or predictions.'};
await writeFile(join(output,'plan.json'),JSON.stringify(plan,null,2));
let child=null;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{child?.kill(signal);});
function run(script,args,logFile){return new Promise((resolvePromise,reject)=>{
 child=spawn(process.execPath,[script,...args],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
 child.stdout.on('data',bytes=>{stdout+=bytes;process.stdout.write(bytes);});
 child.stderr.on('data',bytes=>{stderr+=bytes;process.stderr.write(bytes);});
 child.once('error',reject);child.once('close',async code=>{try{await writeFile(logFile,stdout+'\nSTDERR\n'+stderr);resolvePromise({code,stdout,stderr});}catch(e){reject(e);}});
});}
try{
 console.log('Starting one fixed method2 run; estimated USD0.50/256 calls, no automatic continuation.');
 const result=await run('scripts/evaluation/run-spatial-method2.mjs',[input,features,'--confirm-paid'],join(output,'inference.log'));
 const summaries=result.stdout.split(/\r?\n/).flatMap(line=>{try{const v=JSON.parse(line);return typeof v.root==='string'?[v]:[];}catch{return [];}});
 const summary=summaries.at(-1);
 if(!summary)throw Error('Inference did not publish a run artifact; inspect preserved log, do not restart automatically');
 const runRoot=resolve(summary.root),predictions=JSON.parse(await readFile(join(runRoot,'predictions.json'),'utf8'));
 const frozen=JSON.parse(await readFile(join(runRoot,'frozen.json'),'utf8'));
 if(frozen.inputSha256!==plan.inputSha256)throw Error('Run input changed');
 const completed=predictions.predictions.filter(p=>p.status==='completed').length;
 const status={trials:[{id:'method2-single',round:1,method:'sequence',runRoot,status:completed===total?'completed':'stopped'}]};
 await writeFile(join(output,'status.json'),JSON.stringify(status,null,2));
 const score=await run('scripts/evaluation/score-spatial-repeat-batch.mjs',[output,join(output,'scores')],join(output,'scoring.log'));
 const accuracy={status:'blocked-missing-independent-labels',accuracy:null,falseMergeRate:null,falseSplitRate:null,revisitAccuracy:null,reason:'This input has no reviewed region/revisit labels. Existing acceptance scorer is retained but not fed fabricated truth.',runRoot,completed,total,inferenceError:summary.error??null,scoringExitCode:score.code,scope:'One run only, not three repetitions or a multi-method comparison; coverage is not accuracy.'};
 await writeFile(join(output,'accuracy-status.json'),JSON.stringify(accuracy,null,2));
 await writeFile(join(output,'complete.json'),JSON.stringify({pipelineFinished:true,inferenceComplete:completed===total,inferenceExitCode:result.code,scoringComplete:score.code===0,accuracyStatus:accuracy.status,runRoot,completed,total},null,2));
 console.log(JSON.stringify({batch:output,runRoot,completed,total,scoringComplete:score.code===0,accuracy:null}));
 if(score.code!==0||completed!==total)process.exitCode=1;
}catch(error){await writeFile(join(output,'stopped.json'),JSON.stringify({error:String(error),automaticResume:false},null,2));throw error;}
