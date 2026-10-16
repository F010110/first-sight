/** Separate experimental runner: frozen v1 recognizer/service sources are untouched. */
import { mkdir,readFile,writeFile,readdir } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { SpatialSqliteService } from '../agent/spatial-sqlite-service.js';
import { topologyVlm } from '../agent/spatial-topology-vlm.js';
import { SpatialV2Service } from '../agent/spatial-v2-service.js';
import { SpatialVisualRecall,pythonFeatureExtractor } from '../agent/spatial-visual-recall.js';
import { appendFileSync } from 'node:fs';

const [datasetArg,outputArg,configArg,paid]=process.argv.slice(2);
if(!datasetArg||!outputArg||!configArg||paid!=='--confirm-paid')throw Error('Usage: spatial-calibration dataset NEW-output config.json --confirm-paid');
const config=JSON.parse(await readFile(configArg,'utf8')) as {inputPerMillion:number;outputPerMillion:number;maxCost:number;maxWindows:number;maxObservations:number;currency:string;tokenCalibrationOnly?:boolean;visualRecall?:{command:string;args:string[]}};
const tokenOnly=config.tokenCalibrationOnly===true;
for(const key of (tokenOnly?['maxWindows','maxObservations']:['inputPerMillion','outputPerMillion','maxCost','maxWindows','maxObservations']) as Array<'inputPerMillion'|'outputPerMillion'|'maxCost'|'maxWindows'|'maxObservations'>)if(!Number.isFinite(config[key])||config[key]<=0)throw Error(`Missing/invalid ${key}; actual endpoint prices required`);
if(!Number.isInteger(config.maxWindows)||!Number.isInteger(config.maxObservations)||(!tokenOnly&&!config.currency))throw Error('Integer limits and currency required');
if(tokenOnly&&(config.maxWindows>2||config.maxObservations>8))throw Error('Token-only calibration is limited to two windows/eight observations; monetary long runs need real prices');
const root=resolve(outputArg),data=resolve(datasetArg);await mkdir(root,{recursive:false});
await writeFile(join(root,'config.json'),JSON.stringify(config,null,2));
let cost=0,windows=0,input=0,output=0,calls=0;const logRoot=join(root,'requests');
// Each window permits one repair. Reserve full advertised context + output for both.
// Conservative monetary stop, conditional on supplied rates and endpoint token limits.
const reservation=tokenOnly?0:2*(128000*config.inputPerMillion+1800*config.outputPerMillion)/1e6;
const base=topologyVlm(logRoot);
const recognize:ReturnType<typeof topologyVlm>=async(batch,history)=>{
 if(windows>=config.maxWindows||(!tokenOnly&&cost+reservation>config.maxCost))throw Error('Budget/maximum windows reached before model call');
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
  cost=tokenOnly?0:(input*config.inputPerMillion+output*config.outputPerMillion)/1e6;
  await writeFile(join(root,'usage.json'),JSON.stringify({windows,calls,inputTokens:input,outputTokens:output,estimatedCost:tokenOnly?null:cost,currency:tokenOnly?null:config.currency,unknownUsage,reservationPerWindow:tokenOnly?null:reservation,tokenCalibrationOnly:tokenOnly,maximumProviderCalls:config.maxWindows*2,priceSource:tokenOnly?'No monetary estimate; limited token calibration only':'user config, not verified provider invoice'},null,2));
  if(unknownUsage)throw Error('Usage unavailable: halt rather than assume zero cost');
 }
};
const service=config.visualRecall ? new SpatialV2Service(join(root,'topology.sqlite'),recognize,new SpatialVisualRecall(join(root,'visual-recall.sqlite'),join(root,'topology.sqlite'),pythonFeatureExtractor(config.visualRecall.command,config.visualRecall.args)),value=>appendFileSync(join(root,'recall-trace.jsonl'),JSON.stringify(value)+'\n')) : new SpatialSqliteService(join(root,'topology.sqlite'),recognize);
await service.load();
try{
 const lines=(await readFile(join(data,'observations.jsonl'),'utf8')).trim().split(/\r?\n/).slice(0,config.maxObservations);
 for(let i=0;i<lines.length;i++){
  const row=JSON.parse(lines[i]!);await service.ingest({id:row.id,recordingId:row.sessionId,atMs:row.atMs,frames:['front','left','right'].map(k=>resolve(data,row.cameras[k]))});
  // Replay fixed sampling, no novelty/motion gate; at most four observations/window.
  if((i+1)%4===0||i===lines.length-1)await service.tick(row.atMs+30000,true);
 }
 await writeFile(join(root,'summary.json'),JSON.stringify({status:service.summary(),note:'Calibration only; no semantic accuracy or eight-hour success claim.'},null,2));
}catch(error){await writeFile(join(root,'stopped.json'),JSON.stringify({message:String(error),status:service.summary()},null,2));throw error;}
finally{service.close();}
