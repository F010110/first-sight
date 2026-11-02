import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {FastSpatialMemory} from '../../agent/fast-spatial-memory.js';
import {spatialJsonVlm} from '../../agent/spatial-json-vlm.js';

const [inputArg,featuresArg,outArg,...flags]=process.argv.slice(2);
if(!inputArg||!featuresArg||!outArg||flags.length!==1||flags[0]!=='--confirm-paid')throw Error('Usage: run-fast-spatial-pilot INPUT FEATURES NEW-OUTPUT --confirm-paid');
const raw=await readFile(resolve(inputArg));const input=JSON.parse(raw.toString());const features=JSON.parse(await readFile(resolve(featuresArg),'utf8'));
if(input.schema!=='spatial-public-input-v1'||features.schema!=='spatial-candidate-features-v1'||features.inputSha256!==createHash('sha256').update(raw).digest('hex')||!input.observations.length||input.observations.length>8||features.rows.length!==input.observations.length)throw Error('Pilot input binding or size invalid');
const out=resolve(outArg);await mkdir(out,{recursive:false});
await writeFile(join(out,'plan.json'),JSON.stringify({schema:'fast-spatial-pilot-v1',inputSha256:features.inputSha256,maxCalls:8,maxEstimatedUSD:.15,algorithm:'joint-representative-candidate-only',completeAssistant:false,verifiedAssociations:false,automaticResume:false},null,2));
const agent=new FastSpatialMemory(spatialJsonVlm(join(out,'requests'),8,.15));
let error:string|null=null;const timings:unknown[]=[];
for(const row of input.observations){
 const start=performance.now();
 try{
  const feature=features.rows.find((f:any)=>f.id===row.id);if(!feature)throw Error('Missing features');
  await agent.observe({id:row.id,atMs:row.atMs,views:row.views.map((v:any)=>({...v,id:row.id})),features:feature.features});
  timings.push({id:row.id,totalMs:performance.now()-start});
  await writeFile(join(out,'memory.json'),JSON.stringify(agent.snapshot(),null,2));
 }catch(e){error=String(e);break;}
}
await writeFile(join(out,'result.json'),JSON.stringify({completed:agent.decisions.length,total:input.observations.length,error,timings,accuracy:null,scope:'Candidate-only speed pilot; no room truth and no deep verification worker.'},null,2));
console.log(JSON.stringify({out,completed:agent.decisions.length,error}));
if(error)process.exitCode=1;
