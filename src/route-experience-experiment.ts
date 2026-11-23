import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {RouteExperienceExperiment,type RouteObservation} from './agent/route-experience-experiment.js';
import {spatialJsonVlm,type SpatialJsonRequest} from './agent/spatial-json-vlm.js';

// Default is zero-network scripted replay; never silently fabricate VLM replies.
const [inputPath,output,...flags]=process.argv.slice(2);
if(!inputPath||!output||flags.some(f=>f!=='--confirm-paid'))throw Error('Usage: node dist/current/route-experience-experiment.js INPUT NEW-OUTPUT [--confirm-paid]');
const raw=await readFile(inputPath,'utf8');
const input=JSON.parse(raw) as {schema:string;observations:RouteObservation[];responses?:unknown[];route?:{from:string;to:string}};
if(input.schema!=='ideal-pose-route-experiment-v1'||!Array.isArray(input.observations)||input.observations.length<1||input.observations.length>20)throw Error('Expected explicit ideal-pose experiment, 1..20 observations');
const paid=flags.includes('--confirm-paid');
if(!paid&&!Array.isArray(input.responses))throw Error('Offline replay requires explicit scripted responses; no automatic paid fallback');
await mkdir(output,{recursive:false});
await writeFile(join(output,'manifest.json'),JSON.stringify({schema:input.schema,inputSha256:createHash('sha256').update(raw).digest('hex'),mode:paid?'paid-vlm':'scripted-not-vlm',privilegedPose:true,productionEligible:false,maxCalls:24,maxEstimatedUSD:.5},null,2));
let index=0;
const provider=paid?spatialJsonVlm(join(output,'requests'),24,.5):async()=>input.responses![index];
const model=async(request:SpatialJsonRequest)=>{
 const n=index;
 await writeFile(join(output,`request-${n}.json`),JSON.stringify(request,null,2));
 const response=await provider(request);index++;
 await writeFile(join(output,`response-${n}.json`),JSON.stringify(response??null,null,2));return response;
};
const agent=new RouteExperienceExperiment(model);
try{
 for(const observation of input.observations){
  for(const image of observation.images){const bytes=await readFile(image.path);if(createHash('sha256').update(bytes).digest('hex')!==image.sha256)throw Error('Original image hash mismatch');}
  await agent.observe(observation);
  // Unique checkpoint: previous durable sequence is never overwritten.
  await writeFile(join(output,`memory-${agent.snapshot().sequence.length}.json`),JSON.stringify(agent.snapshot(),null,2));
 }
 const restored=new RouteExperienceExperiment(model,JSON.parse(await readFile(join(output,`memory-${input.observations.length}.json`),'utf8')));
 if(input.route)await writeFile(join(output,'route.json'),JSON.stringify(await restored.describeRoute(input.route.from,input.route.to),null,2));
 await writeFile(join(output,'complete.json'),JSON.stringify({observations:input.observations.length,mode:paid?'paid-vlm':'scripted-not-vlm',restart:'snapshot-reloaded-not-process-restart',semanticAccuracy:null}));
}catch(error){await writeFile(join(output,'stopped.json'),JSON.stringify({error:String(error),completed:agent.snapshot().sequence.length}));throw error;}
