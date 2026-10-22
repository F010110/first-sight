/** Real-camera input only; core VLM, Context, SQLite and retrieval remain unchanged. */
import {readFile,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {SpatialContextMemory} from '../agent/spatial-context-memory.js';
import {SpatialContextLoop} from '../agent/spatial-context-loop.js';
import {spatialContextVlm} from '../agent/spatial-context-vlm.js';
import {cameraObservation,CameraWindows} from './camera-input.js';
import {LiveFramePolicy} from './live-frame-policy.js';

const [captureArg,outArg,...flags]=process.argv.slice(2);
const paid=flags.includes('--confirm-paid'),validate=flags.includes('--validate-only'),follow=flags.includes('--follow');
const livePolicy=flags.includes('--live-policy');
if(livePolicy&&(!validate||!follow))throw Error('Live policy currently requires --validate-only --follow; model current-state publishing is not connected');
if(!captureArg||!outArg||paid===validate)throw Error('Usage: CAPTURE NEW-output (--validate-only | --confirm-paid) [--follow] [--question=TEXT]');
if(flags.some(f=>!['--validate-only','--confirm-paid','--follow','--allow-unverified-sync','--live-policy'].includes(f)&&!f.startsWith('--question=')))throw Error('Unknown option');
if(paid&&(!process.env.QWEN_API_KEY||!process.env.QWEN_BASE_URL))throw Error('Missing Qwen configuration');
const capture=resolve(captureArg),out=resolve(outArg);
const plan=JSON.parse(await readFile(join(capture,'plan.json'),'utf8'));
if(plan.schemaVersion!==1||plan.timestampSource!=='host-request'||plan.exposureTimeKnown!==false||!Number.isInteger(plan.requestedFrames)||plan.requestedFrames<1||plan.requestedFrames>1800)throw Error('Invalid capture plan');
if(paid&&plan.transport==='wifi-http'&&!flags.includes('--allow-unverified-sync'))throw Error('Wi-Fi exposure synchronization is unverified. Validate first; experimental model use requires --allow-unverified-sync.');
await mkdir(out,{recursive:false});
await writeFile(join(out,'plan.json'),JSON.stringify({capture,mode:validate?'validate-only-no-model':'paid-hardware',follow,livePolicy,livePolicySettings:livePolicy?{maxAgeMs:2500,maxGapMs:2500,pendingCapacity:1}:null,source:plan,maxCalls:512,maxEstimatedUSD:1,rounds:16,missingViews:plan.transport==='wifi-http'?[]:['left','right'],exposureSynchronizationVerified:false,unverifiedSyncAccepted:flags.includes('--allow-unverified-sync'),unchangedCore:true},null,2));
const memory=paid?new SpatialContextMemory(join(out,'memory.sqlite')):null;
let loop:SpatialContextLoop|undefined;
if(memory){const model=spatialContextVlm(join(out,'requests'),512,1,async(atMs,value)=>{await memory.writeOutput(atMs,value);try{const response=JSON.parse((value as {rawResponse:string}).rawResponse);JSON.parse(response.choices[0].message.content);}catch{loop?.context.recordOutput(atMs,value);}});loop=new SpatialContextLoop(memory,model,16);}
const scheduler=new CameraWindows(),seen=new Set<string>();
const gate=new LiveFramePolicy<{id:string;atMs:number;requestWallTimeMs:number;observation:Awaited<ReturnType<typeof cameraObservation>>}>();
let processed=0,windows=0,lastProgress=Date.now();
let lastObservation:Awaited<ReturnType<typeof cameraObservation>>|undefined;
const question=flags.find(f=>f.startsWith('--question='))?.slice(11)??null;
async function processWindow(window:Parameters<SpatialContextLoop['runWindow']>[0],q:string|null=null){
 const result=loop?await loop.runWindow(window,q):{status:'validated-no-model'};
 await appendFile(join(out,'results.jsonl'),JSON.stringify({window:windows++,ids:window.map(o=>o.id),question:q,result})+'\n');
 if(result.status==='budget-exhausted')throw Error('Hardware inference budget exhausted');
 processed+=window.length;
}
async function marker(name:string){try{return JSON.parse(await readFile(join(capture,name),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
try{
 for(;;){
  // Only newline-committed receipts are consumed; producer can append concurrently.
  const text=await readFile(join(capture,'observations.jsonl'),'utf8');
  const lines=text.slice(0,text.lastIndexOf('\n')+1).split('\n').filter(Boolean);
  if(lines.length<seen.size||lines.length>plan.requestedFrames)throw Error('Capture log truncated or exceeds bound');
  for(let index=seen.size;index<lines.length;index++){
   const receipt=JSON.parse(lines[index]!);
   if(receipt.sequence!==index||receipt.recordingId!==plan.recordingId||seen.has(receipt.id))throw Error('Invalid sequence/session or duplicate frame');
   const row=await cameraObservation(receipt,capture);seen.add(row.id);lastObservation=row;lastProgress=Date.now();
   await appendFile(join(out,'accepted.jsonl'),JSON.stringify({receipt,observation:row})+'\n');
   if(livePolicy){
    const dropped=gate.offer({id:row.id,atMs:row.atMs,requestWallTimeMs:receipt.requestWallTimeMs,observation:row});
    for(const id of dropped)await appendFile(join(out,'live-decisions.jsonl'),JSON.stringify({id,reason:'superseded-in-bounded-queue',originalRetained:true})+'\n');
   }else for(const window of scheduler.push(row))await processWindow(window);
  }
  if(livePolicy){
   const decision=gate.take(Date.now());
   if(decision.reason!=='no-pending-frame')await appendFile(join(out,'live-decisions.jsonl'),JSON.stringify({...decision,frame:decision.frame?.id??null,originalRetained:true})+'\n');
   if(decision.frame)await processWindow([decision.frame.observation]);
   await writeFile(join(out,'current-input-status.json'),JSON.stringify({...gate.status(Date.now()),atWallTimeMs:Date.now(),note:'Input health only; no current place inferred. Expire after 2500ms; readers must recheck age.'}));
  }
  const complete=await marker('complete.json'),stopped=await marker('stopped.json');
  if(complete||stopped){
   // Producer may append its last receipt between our log read and marker read.
   if(Number((complete??stopped).frames)>seen.size){if(Date.now()-lastProgress>60000)throw Error('Completion marker exceeds committed capture log');await new Promise(resolve=>setTimeout(resolve,250));continue;}
  const remaining=livePolicy?[]:scheduler.finish();
   for(const window of remaining)await processWindow(window);
   if(stopped)throw Error('Capture stopped: '+JSON.stringify(stopped));
   if(complete.status!=='captured'||complete.frames!==seen.size||!seen.size||
      (plan.transport==='wifi-http'?complete.requestedRounds!==plan.requestedFrames||complete.missingRounds+seen.size!==plan.requestedFrames:seen.size!==plan.requestedFrames))throw Error('Incomplete capture');
   if(question&&lastObservation&&loop){const result=await loop.runWindow([lastObservation],question);await appendFile(join(out,'questions.jsonl'),JSON.stringify({question,result})+'\n');if(result.status!=='answered')throw Error('Hardware question did not complete');}
   break;
  }
  if(!follow)throw Error('Capture not complete; use --follow for a live producer');
  if(Date.now()-lastProgress>60000)throw Error('Capture idle for 60 seconds; original artifacts retained');
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 const captureResult=await marker('complete.json');
 await writeFile(join(out,'complete.json'),JSON.stringify({status:validate?'validated-no-model':'hardware-run-completed',observations:livePolicy?seen.size:processed,livePolicy,deliveredObservations:processed,windows,missingCaptureRounds:captureResult?.missingRounds??0,exposureSynchronizationVerified:false,counts:memory?.counts()??null}));
}catch(error){await writeFile(join(out,'stopped.json'),JSON.stringify({error:String(error),accepted:seen.size,processed,windows}));throw error;}
finally{if(livePolicy)await writeFile(join(out,'current-input-status.json'),JSON.stringify({state:'current-state-unconfirmed',reason:'input-session-ended',atWallTimeMs:Date.now()}));memory?.close();}
