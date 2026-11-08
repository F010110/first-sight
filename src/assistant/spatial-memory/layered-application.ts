import {mkdirSync,openSync,writeFileSync,closeSync,readFileSync,unlinkSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {ObservationArchive} from './observation-archive.js';
import {BatchSpatialMemory} from './batch-memory.js';
import {createPiBatchProcessor} from './pi-batch-reasoner.js';
import {createV3QuestionAgent} from './question-agent-v3.js';
import {LayeredMemoryRuntime,type LayeredRuntimeOptions} from './layered-runtime.js';
import {fastPerceptionV3} from './fast-perception-v3.js';
import {V3RequestSlots} from './request-slots-v3.js';
import {imageIndexPlaceMatcher} from './visual-revisit.js';
import type {PlaceMatcher} from './revisit-candidates.js';
import type {V3Request} from './pi-session-v3.js';
import type {Observation} from './contracts.js';

export const defaultLayeredOptions:LayeredRuntimeOptions={perceptionMs:6000,spatialMs:40000,maxBufferedObservations:64,perceptionBudget:{maxTasks:8,maxSpanMs:120000,maxBytes:64*1024*1024},spatialBudget:{maxTasks:4,maxSpanMs:160000,maxBytes:128*1024*1024},requestTimeoutMs:120000};

function exclusiveRoot(root:string,resume:boolean){
 mkdirSync(root,{recursive:true});const path=join(root,'writer.lock'),token=crypto.randomUUID();
 const acquire=()=>{const fd=openSync(path,'wx');try{writeFileSync(fd,JSON.stringify({pid:process.pid,token}));}finally{closeSync(fd);}};
 try{acquire();}catch(error){
  if((error as NodeJS.ErrnoException).code!=='EEXIST'||!resume)throw Error('Layered writer root is locked; explicit recovery required');
  const prior=JSON.parse(readFileSync(path,'utf8'));let alive=true;try{process.kill(prior.pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')alive=false;else throw e;}
  if(alive)throw Error('A live process already owns the spatial writer');
  if(typeof prior.token!=='string'||!/^[a-f0-9-]{36}$/.test(prior.token))throw Error('Invalid stale writer lock');
  // Only one recovery process can claim a particular stale owner. A loser must
  // never unlink a fresh lock acquired by the winning recovery process.
  mkdirSync(join(root,'recovery-claim-'+prior.token));
  if(JSON.parse(readFileSync(path,'utf8')).token!==prior.token)throw Error('Writer ownership changed during recovery');
  unlinkSync(path);acquire();
 }
 return ()=>{const prior=JSON.parse(readFileSync(path,'utf8'));if(prior.token!==token)throw Error('Writer ownership changed');unlinkSync(path);};
}

/** Production integration: independent request ledgers/slots, same-session Pi,
 * durable facts/jobs, one spatial writer, and a question Session ready at version 0. */
export async function createLayeredApplication(rootArg:string,requests:{perception:V3Request;spatial:V3Request;question:V3Request},options:{resume?:boolean;archiveMaxBytes?:number;runtime?:LayeredRuntimeOptions;matcher?:PlaceMatcher;questionMatcher?:PlaceMatcher;retryFailures?:boolean}={}){
 const root=resolve(rootArg),unlock=exclusiveRoot(root,options.resume??false),config=options.runtime??defaultLayeredOptions;
 let archive:ObservationArchive|undefined,memory:BatchSpatialMemory|undefined,space:Awaited<ReturnType<typeof createPiBatchProcessor>>|undefined,question:Awaited<ReturnType<typeof createV3QuestionAgent>>|undefined;
 const matcher=options.matcher??imageIndexPlaceMatcher(undefined,{imagesPerPlace:6,shortlistPlaces:100});
 const questionMatcher=options.questionMatcher??options.matcher??imageIndexPlaceMatcher(undefined,{imagesPerPlace:6,shortlistPlaces:100});
 try{
  if(!options.resume&&['evidence/observations.sqlite','memory/spatial.sqlite','space-session/session.json','question-session/session.json'].some(path=>existsSync(join(root,path))))throw Error('Existing evidence or Session requires explicit resume');
  archive=new ObservationArchive(join(root,'evidence'),options.archiveMaxBytes??10*1024*1024*1024);memory=new BatchSpatialMemory(join(root,'memory'),archive);
  if(options.resume)memory.restore();
  const slots=new V3RequestSlots();
  space=await createPiBatchProcessor(join(root,'space-session'),memory,slots.wrap('spatial',requests.spatial),matcher,{resume:existsSync(join(root,'space-session','session.json')),fastMs:config.perceptionMs,requestTimeoutMs:config.requestTimeoutMs??120000});
  question=await createV3QuestionAgent(join(root,'question-session'),memory,slots.wrap('question',requests.question),{resume:existsSync(join(root,'question-session','session.json')),matcher:questionMatcher,fastMs:config.perceptionMs});
  const runtime=new LayeredMemoryRuntime(archive,fastPerceptionV3(slots.wrap('perception',requests.perception)),space,config,{retryFailures:options.retryFailures??false});
  let sourceClock:number|null=archive.latest()?.observation.atMs??null,wallClock=Date.now(),closed=false;
  let activeQuestion:Promise<Awaited<ReturnType<typeof question.ask>>>|null=null,questionController:AbortController|null=null;
  let schedulingError:string|null=null;
  const timer=setInterval(()=>{if(sourceClock!==null&&!closed)try{runtime.tick(sourceClock+Date.now()-wallClock);}catch(error){schedulingError=String(error);clearInterval(timer);}},250);timer.unref();
  return {
   observe(row:Observation){if(closed)throw Error('Application closed');const result=runtime.observe(row);sourceClock=row.atMs;wallClock=Date.now();return result;},
   tick:(atMs:number)=>runtime.tick(atMs),
   canAcceptForQuality:(row:Observation)=>runtime.canAcceptForQuality(row),
   ask(text:string,signal?:AbortSignal){
    if(closed)return Promise.reject(Error('Application closed'));if(activeQuestion)return Promise.reject(Error('Question Session busy; no unbounded question queue'));
    const controller=new AbortController();questionController=controller;
    const task=question!.ask(text,signal?AbortSignal.any([signal,controller.signal]):controller.signal).finally(()=>{if(activeQuestion===task){activeQuestion=null;questionController=null;}});activeQuestion=task;return task;
   },
   progress:()=>({...runtime.progress(),schedulingError,requestSlots:slots.status(),spatialVersion:memory!.store.version(),coverageGaps:archive!.gaps()}),
   async finishInput(){sourceClock=null;await runtime.drain();return this.progress();},
   async close(){if(closed)return;closed=true;clearInterval(timer);questionController?.abort();if(activeQuestion)await activeQuestion.catch(()=>{});await runtime.close();await question!.close();await space!.close();await matcher.close?.();if(questionMatcher!==matcher)await questionMatcher.close?.();memory!.close();archive!.close();unlock();}
  };
 }catch(error){await question?.close().catch(()=>{});await space?.close().catch(()=>{});await matcher.close?.();if(questionMatcher!==matcher)await questionMatcher.close?.();memory?.close();archive?.close();unlock();throw error;}
}
