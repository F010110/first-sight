/** Separate experimental runner: frozen v1 recognizer/service sources are untouched. */
import { mkdir,readFile,writeFile,readdir } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { SpatialSqliteService } from '../agent/spatial-sqlite-service.js';
import { topologyVlm } from '../agent/spatial-topology-vlm.js';
import { SpatialV2Service } from '../agent/spatial-v2-service.js';
import { SpatialVisualRecall,pythonFeatureExtractor,type DescriptorSpec } from '../agent/spatial-visual-recall.js';
import { appendFileSync } from 'node:fs';
import { spatialV2Vlm } from '../agent/spatial-v2-vlm.js';
import { reviewedIdentityRecognizer } from '../agent/spatial-identity-review.js';
import { createHash } from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const [datasetArg,outputArg,configArg,paid]=process.argv.slice(2);
const resume=process.argv[6]==='--resume';
if(!datasetArg||!outputArg||!configArg||paid!=='--confirm-paid')throw Error('Usage: spatial-calibration dataset NEW-output config.json --confirm-paid');
const config=JSON.parse(await readFile(configArg,'utf8')) as {inputPerMillion:number;outputPerMillion:number;maxCost:number;maxWindows:number;maxObservations:number;maxInputTokens?:number;maxOutputTokens?:number;maxProviderCalls?:number;currency:string;tokenCalibrationOnly?:boolean;boundedSampleRun?:boolean;plannedScheduling?:boolean;identityReview?:boolean;reviewReuse?:boolean;temporalOverlap?:boolean;visualRecall?:{command:string;args:string[];descriptor?:DescriptorSpec;maxOutputBytes?:number}};
const tokenOnly=config.tokenCalibrationOnly===true||config.boundedSampleRun===true;
for(const key of (tokenOnly?['maxWindows','maxObservations']:['inputPerMillion','outputPerMillion','maxCost','maxWindows','maxObservations']) as Array<'inputPerMillion'|'outputPerMillion'|'maxCost'|'maxWindows'|'maxObservations'>)if(!Number.isFinite(config[key])||config[key]<=0)throw Error(`Missing/invalid ${key}; actual endpoint prices required`);
if(!Number.isInteger(config.maxWindows)||!Number.isInteger(config.maxObservations)||(!tokenOnly&&!config.currency))throw Error('Integer limits and currency required');
if(config.boundedSampleRun){if(config.maxWindows>30||config.maxObservations>90)throw Error('Explicit bounded sample limit: 30 windows/90 observations');}
else if(tokenOnly&&(config.maxWindows>2||config.maxObservations>8))throw Error('Token-only calibration is limited to two windows/eight observations; monetary long runs need real prices');
const root=resolve(outputArg),data=resolve(datasetArg);await mkdir(root,{recursive:resume});
if(resume){if(JSON.stringify(JSON.parse(await readFile(join(root,'config.json'),'utf8')))!==JSON.stringify(config))throw Error('Resume config mismatch');}
else await writeFile(join(root,'config.json'),JSON.stringify(config,null,2));
const digest=async(path:string|URL)=>createHash('sha256').update(await readFile(path)).digest('hex');
const provenance={observationsSha256:await digest(join(data,'observations.jsonl')),runnerSha256:await digest(new URL(import.meta.url)),v2RecognizerSha256:await digest(new URL('../agent/spatial-v2-vlm.js',import.meta.url)),reviewWrapperSha256:await digest(new URL('../agent/spatial-identity-review.js',import.meta.url)),model:'qwen3.8-flash',enableThinking:false,note:'Compiled artifact hashes captured before calls; no evaluation-only labels are model inputs.'};
if(resume){const old=JSON.parse(await readFile(join(root,'provenance.json'),'utf8'));for(const key of ['observationsSha256','v2RecognizerSha256','reviewWrapperSha256'] as const)if(old[key]!==provenance[key])throw Error('Resume input/recognizer mismatch');}
else await writeFile(join(root,'provenance.json'),JSON.stringify(provenance,null,2));
let cost=0,windows=0,input=0,output=0,calls=0;const logRoot=join(root,'requests');
const committed=new Set<string>();let priorUnresolvedCallsReserved=0;
if(resume){
 const db=new DatabaseSync(join(root,'topology.sqlite'),{readOnly:true});for(const r of db.prepare('SELECT observation_id FROM assignments').all() as Array<{observation_id:string}>)committed.add(r.observation_id);db.close();
 const source=(await readFile(join(data,'observations.jsonl'),'utf8')).trim().split(/\r?\n/).map(s=>JSON.parse(s));windows=source.filter(r=>committed.has(r.id)&&r.flushAfter===true).length;
 for(const dir of await readdir(logRoot)){
  const responses=(await readdir(join(logRoot,dir))).filter(n=>/^response-\d+\.json$/.test(n));
  if(!responses.length){calls++;priorUnresolvedCallsReserved++;}
  for(const file of responses){calls++;const r=JSON.parse(await readFile(join(logRoot,dir,file),'utf8'));const u=r.response?.usage;if(!Number.isFinite(u?.prompt_tokens)||!Number.isFinite(u?.completion_tokens))priorUnresolvedCallsReserved++;else{input+=u.prompt_tokens;output+=u.completion_tokens;}}
 }
 cost=((input+priorUnresolvedCallsReserved*128000)*config.inputPerMillion+(output+priorUnresolvedCallsReserved*1800)*config.outputPerMillion)/1e6;
 await writeFile(join(root,`resume-${Date.now()}.json`),JSON.stringify({provenance,committed:committed.size,completedWindows:windows,knownInputTokens:input,knownOutputTokens:output,calls,priorUnresolvedCallsReserved,reservation:'Each missing response retains one full 128k input/1800 output reservation; not assumed free. Interrupted uncommitted window is retried and original logs retained.'},null,2));
}
// Each window permits one repair. Reserve full advertised context + output for both.
// Conservative monetary stop, conditional on supplied rates and endpoint token limits.
if(config.identityReview&&!config.visualRecall)throw Error('Identity review requires v2 visual recall');
if(config.reviewReuse&&!config.identityReview)throw Error('Reuse review requires identity review');
if(config.temporalOverlap&&!config.visualRecall)throw Error('Temporal overlap requires v2 visual recall');
const maximumCallsPerWindow=config.identityReview?4:2;
const reservation=tokenOnly?0:maximumCallsPerWindow*(128000*config.inputPerMillion+1800*config.outputPerMillion)/1e6;
const initial=config.visualRecall?spatialV2Vlm(logRoot):topologyVlm(logRoot);
const base=config.identityReview?reviewedIdentityRecognizer(initial,(batch,history,proposal)=>spatialV2Vlm(logRoot,proposal)(batch,history),async value=>{appendFileSync(join(root,'identity-review.jsonl'),JSON.stringify(value)+'\n');},config.reviewReuse===true):initial;
const recognize:ReturnType<typeof topologyVlm>=async(batch,history)=>{
 if(windows>=config.maxWindows||(!tokenOnly&&cost+reservation>config.maxCost))throw Error('Budget/maximum windows reached before model call');
 if((config.maxInputTokens!==undefined&&input+(priorUnresolvedCallsReserved+maximumCallsPerWindow)*128000>config.maxInputTokens)||(config.maxOutputTokens!==undefined&&output+(priorUnresolvedCallsReserved+maximumCallsPerWindow)*1800>config.maxOutputTokens)||(config.maxProviderCalls!==undefined&&calls+maximumCallsPerWindow>config.maxProviderCalls))throw Error('Token/provider request ceiling reached before window');
 const before=new Set(await readdir(logRoot).catch(()=>[]));windows++;
 try{return await base(batch,history);}finally{
  let unknownUsage=false;
  for(const dir of await readdir(logRoot))if(!before.has(dir)){
   const responses=(await readdir(join(logRoot,dir))).filter(n=>/^response-\d+\.json$/.test(n));
   if(!responses.length)unknownUsage=true;
   for(const file of responses){calls++;const record=JSON.parse(await readFile(join(logRoot,dir,file),'utf8'));const usage=record.response?.usage;
    if(!Number.isFinite(usage?.prompt_tokens)||!Number.isFinite(usage?.completion_tokens)){unknownUsage=true;continue;}
    input+=usage.prompt_tokens;output+=usage.completion_tokens;
   }
  }
  cost=tokenOnly?0:((input+priorUnresolvedCallsReserved*128000)*config.inputPerMillion+(output+priorUnresolvedCallsReserved*1800)*config.outputPerMillion)/1e6;
    await writeFile(join(root,'usage.json'),JSON.stringify({windows,calls,inputTokens:input,outputTokens:output,estimatedCost:tokenOnly||priorUnresolvedCallsReserved?null:cost,estimatedCostUpperBound:tokenOnly?null:cost,priorUnresolvedCallsReserved,currency:tokenOnly?null:config.currency,unknownUsage:unknownUsage||priorUnresolvedCallsReserved>0,reservationPerWindow:tokenOnly?null:reservation,tokenCalibrationOnly:tokenOnly,maximumProviderCalls:config.maxWindows*maximumCallsPerWindow,priceSource:tokenOnly?'No monetary estimate; limited token calibration only':'user config, not verified provider invoice'},null,2));
  if(unknownUsage)throw Error('Usage unavailable: halt rather than assume zero cost');
 }
};
const service=config.visualRecall ? new SpatialV2Service(join(root,'topology.sqlite'),recognize,new SpatialVisualRecall(join(root,'visual-recall.sqlite'),join(root,'topology.sqlite'),pythonFeatureExtractor(config.visualRecall.command,config.visualRecall.args,config.visualRecall.maxOutputBytes),config.visualRecall.descriptor),value=>appendFileSync(join(root,'recall-trace.jsonl'),JSON.stringify(value)+'\n'),config.temporalOverlap===true) : new SpatialSqliteService(join(root,'topology.sqlite'),recognize);
await service.load();
try{
 const lines=(await readFile(join(data,'observations.jsonl'),'utf8')).trim().split(/\r?\n/).slice(0,config.maxObservations);
  for(let i=0;i<lines.length;i++){
   if(committed.has(JSON.parse(lines[i]!).id))continue;
   const row=JSON.parse(lines[i]!);if(!resume||!service.hasObservation(row.id))await service.ingest({id:row.id,recordingId:row.sessionId,atMs:row.atMs,...typeof row.sourceAtMs==='number'?{sourceAtMs:row.sourceAtMs}:{},frames:['front','left','right'].map(k=>resolve(data,row.cameras[k]))});
  // Replay fixed sampling, no novelty/motion gate; at most four observations/window.
  if(config.plannedScheduling ? row.flushAfter===true||i===lines.length-1 : (i+1)%4===0||i===lines.length-1)await service.tick(row.closedAtMs??row.atMs+30000,true);
 }
 await writeFile(join(root,'summary.json'),JSON.stringify({status:service.summary(),note:'Calibration only; no semantic accuracy or eight-hour success claim.'},null,2));
}catch(error){await writeFile(join(root,'stopped.json'),JSON.stringify({message:String(error),status:service.summary()},null,2));throw error;}
finally{service.close();}
