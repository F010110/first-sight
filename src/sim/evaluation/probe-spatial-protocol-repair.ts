/** Replay one captured bad model decision, then bounded real-endpoint correction.
 * Public original images only; no answer key or full replay. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {SpatialContextLoop} from '../../agent/spatial-context-loop.js';import {SpatialContextMemory} from '../../agent/spatial-context-memory.js';import {spatialContextVlm} from '../../agent/spatial-context-vlm.js';
const [trace,output,paid]=process.argv.slice(2);if(!trace||!output||paid!=='--confirm-paid')throw Error('Usage: captured-request-directory NEW-output --confirm-paid');
await mkdir(output,{recursive:false});const inputBytes=await readFile(join(trace,'input.json')),responseBytes=await readFile(join(trace,'response.txt'));const captured=JSON.parse(inputBytes.toString()),bad=JSON.parse(JSON.parse(responseBytes.toString()).choices[0].message.content);
const sources:Record<string,string>={};for(const o of captured.observations)for(const path of o.frames)sources[path]=createHash('sha256').update(await readFile(path)).digest('hex');
await writeFile(join(output,'plan.json'),JSON.stringify({developmentOnly:true,capturedTrace:trace,capturedInputSha256:createHash('sha256').update(inputBytes).digest('hex'),capturedResponseSha256:createHash('sha256').update(responseBytes).digest('hex'),images:sources,policy:'First turn is exact recorded invalid model output, NOT a paid prediction; later turns are real Qwen calls. Context starts empty, no automatic restore.',maxPaidCalls:3,maxEstimatedUSD:.1},null,2));
const memory=new SpatialContextMemory(join(output,'memory.sqlite'));let loop:SpatialContextLoop;
const real=spatialContextVlm(join(output,'requests'),3,.1,async(atMs,value)=>memory.writeOutput(atMs,value));let calls=0;
loop=new SpatialContextLoop(memory,async input=>++calls===1?bad:real(input),4);
try{const result=await loop.runWindow(captured.observations,null);await writeFile(join(output,'result.json'),JSON.stringify({result,context:loop.context.view(),counts:memory.counts()},null,2));if(result.status!=='observed')throw Error('Captured protocol correction failed');await writeFile(join(output,'complete.json'),JSON.stringify({status:'captured-protocol-correction-passed-not-score',turns:calls}));}finally{memory.close();}
