import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {setTimeout as sleep} from 'node:timers/promises';
import {createLayeredApplication,defaultLayeredOptions} from '../../assistant/spatial-memory/layered-application.js';
import {projectReplayClock} from './spatial-window-plan.js';
import {spatialJsonVlm} from '../../agent/spatial-json-vlm.js';
import type {Observation} from '../../assistant/spatial-memory/contracts.js';
import {ulvnPlaceMatcher} from '../../assistant/spatial-memory/visual-revisit.js';

// Deliberately a new entry point/root: legacy experiments remain reproducible.
const [inputArg,outputArg,...flags]=process.argv.slice(2);
if(!inputArg||!outputArg||!flags.includes('--confirm-paid'))throw Error('Usage: run-layered-memory PUBLIC-INPUT NEW-OUTPUT --confirm-paid [--resume] [--quality] [--require-realtime] [--retry-failures] [--fast-ms=6000] [--spatial-ms=40000] [--interval-ms=2000] [--time-scale=1] [--limit=N] [--serve=PORT]');
for(const flag of flags)if(!['--confirm-paid','--resume','--quality','--require-realtime','--retry-failures','--ulvn-direct-revisit'].includes(flag)&&!/^--(fast-ms|spatial-ms|interval-ms|time-scale|limit|serve)=/.test(flag))throw Error('Unknown flag '+flag);
const directRevisit=flags.includes('--ulvn-direct-revisit');
if(directRevisit&&!process.env.ULVN_PYTHON)throw Error('ULVN_PYTHON required before paid direct-revisit run');
const number=(key:string,fallback:number)=>{const flag=flags.find(f=>f.startsWith('--'+key+'='));const n=flag?Number(flag.split('=')[1]):fallback;if(!Number.isFinite(n))throw Error('Invalid '+key);return n;};
const resume=flags.includes('--resume'),quality=flags.includes('--quality'),requireRealtime=flags.includes('--require-realtime'),fastMs=number('fast-ms',6000),spatialMs=number('spatial-ms',40000),intervalMs=number('interval-ms',2000),scale=number('time-scale',1),limit=number('limit',Number.MAX_SAFE_INTEGER),port=number('serve',0);
if(fastMs<4000||fastMs>8000||spatialMs<fastMs||!Number.isInteger(intervalMs)||intervalMs<500||intervalMs>10000||!Number.isInteger(limit)||limit<1||![1,2].includes(scale)||!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid layered schedule/limit/port');
// The selected rerender source is 500ms; a replay interval keeps 40s buckets
// comparable across datasets without inventing a different source clock.
if(requireRealtime&&(quality||scale!==1||intervalMs!==2000))throw Error('--require-realtime cannot combine with --quality, --time-scale=2 or a non-default interval');
const bytes=await readFile(inputArg),input=JSON.parse(bytes.toString());
if(input.schema!=='spatial-public-input-v1'||!Array.isArray(input.observations)||!input.observations.length)throw Error('Only source-bound public observation input is accepted');
const baseRows:Observation[]=input.observations.slice(0,limit).map((r:any)=>({id:r.id,atMs:r.atMs,...typeof r.recordingId==='string'?{recordingId:r.recordingId}:{},views:r.views.map((v:any)=>({id:r.id,direction:v.direction,path:v.path,sha256:v.sha256}))}));
if(new Set(baseRows.map(r=>r.id)).size!==baseRows.length||baseRows.some((r,i)=>!Number.isFinite(r.atMs)||r.atMs<0||i>0&&r.atMs<=baseRows[i-1]!.atMs))throw Error('Invalid ordered public observations');
const rows=projectReplayClock(baseRows,intervalMs,scale);
const out=resolve(outputArg),runtime={...defaultLayeredOptions,perceptionMs:fastMs,spatialMs,coalesce:!quality};
const manifest={schema:'layered-memory-run-v1',inputSHA256:createHash('sha256').update(bytes).digest('hex'),planned:rows.length,originalCount:input.selection?.originalCount??input.observations.length,sourceCoverage:input.selection?'selected-segments':rows.length<input.observations.length?'original-prefix':'all-original-observations',selection:input.selection??null,samplingMs:intervalMs,sourceTimeScale:scale,quality,realtimeEnforced:requireRealtime,runtime,revisit:{limit:20,maxPlaces:100,imagesPerPlace:6,...directRevisit?{authority:'ulvn-direct-two-view-60-035-v1',history:'all-committed-members-exclude-last30',geometry:'top20-observations-all9pairs'}:{}},capabilities:'facts-first-multi-segment-pi-with-independent-questions'};
if(resume){const prior=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));if(JSON.stringify(prior)!==JSON.stringify(manifest))throw Error('Resume manifest changed');}
else{await mkdir(out,{recursive:false});await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});}
const application=await createLayeredApplication(out,{
 perception:spatialJsonVlm(join(out,'perception-requests'),2000,4,true,4000,{extendedOutput:true}),
 spatial:spatialJsonVlm(join(out,'spatial-requests'),8000,12,true,8000,{extendedOutput:true}),
 question:spatialJsonVlm(join(out,'question-requests'),2000,4,true,2000)
},{resume,runtime,retryFailures:flags.includes('--retry-failures'),prefetch:true,...directRevisit?{directRevisit:true,matcher:ulvnPlaceMatcher({script:resolve('scripts/media/ulvn_revisit.py')})}:{}});
let stopped=false;const controllers=new Set<AbortController>();
const token=randomUUID(),server=port?createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
 if(req.headers.authorization!=='Bearer '+token||req.headers.origin){res.writeHead(403);res.end(JSON.stringify({error:'Local bearer token required; browser cross-origin access forbidden'}));return;}
 try{
  if(req.method==='GET'&&req.url==='/status'){res.end(JSON.stringify(application.progress()));return;}
  if(req.method!=='POST'||req.url!=='/question'){res.writeHead(404);res.end('{}');return;}
  let body='';for await(const chunk of req){body+=String(chunk);if(Buffer.byteLength(body)>32768)throw Error('Question body too large');}
  const value=JSON.parse(body);if(typeof value.question!=='string')throw Error('Expected question string');
  const controller=new AbortController();controllers.add(controller);res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  try{const answer=await application.ask(value.question,controller.signal);await appendFile(join(out,'answers.jsonl'),JSON.stringify(answer)+'\n');res.end(JSON.stringify(answer));}finally{controllers.delete(controller);}
 }catch(error){res.writeHead(/busy/.test(String(error))?409:400);res.end(JSON.stringify({error:String(error)}));}
}):null;
if(server){await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});console.log(JSON.stringify({questionEndpoint:`http://127.0.0.1:${port}/question`,bearerToken:token}));}
const stop=()=>{stopped=true;for(const controller of controllers)controller.abort();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
const started=Date.now(),attemptId=randomUUID();let delivered=0,maxDeliveryLagMs=0,deliveryViolations=0,error:string|null=null;
const toleranceMs=2000;
await appendFile(join(out,'attempts.jsonl'),JSON.stringify({attemptId,kind:'started',startedAtMs:started,resume,inputSHA256:manifest.inputSHA256,mode:quality?'quality':'source-cadence'})+'\n');
const timer=setInterval(()=>console.log(JSON.stringify({stage:'layered-memory',elapsedMs:Date.now()-started,...application.progress()})),10000);timer.unref();
try{
 // Resume does not redeliver archived observations, and reanchors only the suffix.
 const archived=application.progress().archivedThroughSequence,first=rows[archived]?.atMs??0,anchor=Date.now();
 for(let i=archived;i<rows.length&&!stopped;i++){
  const row=rows[i]!,due=anchor+row.atMs-first,wait=due-Date.now();if(!quality&&wait>0)await sleep(wait);if(stopped)break;
  if(quality){application.tick(row.atMs);const waiting=Date.now(),maxWait=(runtime.spatialTaskTimeoutMs??runtime.requestTimeoutMs!*24*3)*(runtime.perceptionBudget.maxTasks+runtime.spatialBudget.maxTasks+2);while(!application.canAcceptForQuality(row)&&!stopped){if(Date.now()-waiting>maxWait)throw Error('Quality replay stalled beyond finite lane budgets');await sleep(50);}if(stopped)break;}
  const lag=Math.max(0,Date.now()-due);maxDeliveryLagMs=Math.max(maxDeliveryLagMs,lag);if(requireRealtime&&lag>toleranceMs)deliveryViolations++;application.observe(row);delivered++;
  await appendFile(join(out,'delivery.jsonl'),JSON.stringify({attemptId,id:row.id,atMs:row.atMs,deliveredAtMs:Date.now(),lagMs:quality?null:lag})+'\n');
 }
 await application.finishInput();
}catch(e){error=String(e);}
finally{
 clearInterval(timer);
 const progress=application.progress(),realtime={enforced:requireRealtime,maxDeliveryLagMs:quality?null:maxDeliveryLagMs,deliveryViolations,toleranceMs,backpressureWaits:0,skippedWindows:progress.spatial.gaps??0,satisfied:!requireRealtime||deliveryViolations===0},receipt={schema:'layered-memory-complete-v1',attemptId,inputSHA256:manifest.inputSHA256,planned:rows.length,sourcePlanned:manifest.originalCount,sourceCoverage:manifest.sourceCoverage,mode:quality?'quality':'source-cadence',samplingMs:intervalMs,sourceTimeScale:scale,elapsedMs:Date.now()-started,elapsedScope:'current-process-attempt',delivered,maxDeliveryLagMs:quality?null:maxDeliveryLagMs,...progress,realtime,error,completed:!error&&!stopped&&!progress.fatal&&!progress.schedulingError&&progress.archivedThroughSequence===rows.length&&progress.spatialThroughSequence===rows.length&&!progress.coverageGaps.some((g:any)=>!g.resolvedAtMs)&&realtime.satisfied,realtimeCertified:requireRealtime&&realtime.satisfied};
 await appendFile(join(out,'attempts.jsonl'),JSON.stringify({kind:'finished',...receipt})+'\n');
 await writeFile(join(out,'complete-'+attemptId+'.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
 if(server&&!stopped)await new Promise<void>(done=>{process.once('SIGINT',done);process.once('SIGTERM',done);});
 for(const controller of controllers)controller.abort();if(server)await new Promise<void>(done=>server.close(()=>done()));
 await application.close();
}
