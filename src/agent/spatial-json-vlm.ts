import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {boundedNetworkRetry} from './bounded-network-retry.js';
import {SpatialOutputProtocolError} from './spatial-protocol-retry.js';
export interface SpatialJsonImage {id:string;direction:string;path:string;sha256:string}
export interface SpatialJsonRequest {phase:'perception'|'identity';prompt:string;data:unknown;images:SpatialJsonImage[];windowSources?:Array<{id:string;atMs:number}>;responseMode?:'text';textOnlyIdentity?:boolean;includeUsage?:boolean;metadata?:{referenceBindings:Array<{alias:string;originalId:string;kind:'source'|'group'}>}}
/** Separate stateless request adapter. Metadata receipts never embed Base64. */
export function spatialJsonVlm(root:string,maxCalls=96,maxEstimatedUSD=.4,resumeLedger=false,maxOutputTokens=1000,options:{extendedEvaluationImages?:boolean}={}){
  if(!Number.isInteger(maxOutputTokens)||maxOutputTokens<100||maxOutputTokens>2000)throw Error('Invalid output budget');
  let calls=0,cost=0,unknownCallsReserved=0,loadPromise:Promise<void>|null=null,ledgerWrite=Promise.resolve();
  const load=()=>loadPromise??=(async()=>{
   try{
    const previous=JSON.parse(await readFile(join(root,'usage.json'),'utf8'));
    if(!Number.isInteger(previous.calls)||previous.calls<0||!Number.isFinite(previous.estimatedUSD)||previous.estimatedUSD<0||!Number.isInteger(previous.unknownCallsReserved)||previous.unknownCallsReserved<0)throw Error('Invalid persistent usage ledger');
    calls=previous.calls;cost=previous.estimatedUSD;unknownCallsReserved=previous.unknownCallsReserved;
   }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  })();
  return async(input:SpatialJsonRequest):Promise<unknown>=>{
   if(resumeLedger)await load();
   const reservation=(128000*.1356+maxOutputTokens*.4584)/1e6;
   // A denied request must not consume/create the next paid request directory.
   // Otherwise repeated denial (or restart) masks the real cause with EEXIST.
   if(calls>=maxCalls||cost+reservation>maxEstimatedUSD){
    await mkdir(root,{recursive:true});
    await appendFile(join(root,'budget-denials.jsonl'),JSON.stringify({calls,estimatedUSD:cost,reservation,maxCalls,maxEstimatedUSD,reason:'Separated request budget exhausted',networkCalled:false})+'\n');
    const error=new Error('Separated request budget exhausted');error.name='SpatialProviderError';throw error;
   }
   const slot=calls++;cost+=reservation;unknownCallsReserved++;
   const started=performance.now();
   const timing:{schema:string;phase:string;imageCount:number;preparationMs?:number;attempts:Array<{attempt:number;headersMs:number;bodyMs:number}>;totalMs?:number;success:boolean}={schema:'spatial-request-timing-v1',phase:input.phase,imageCount:input.images.length,attempts:[],success:false};
   const directory=join(root,String(slot).padStart(4,'0'));
   if(resumeLedger){await mkdir(root,{recursive:true});await mkdir(directory,{recursive:false});}
   else await mkdir(directory,{recursive:true});
  const ledger=()=>{const text=JSON.stringify({calls,estimatedUSD:cost,unknownCallsReserved,maxCalls,maxEstimatedUSD,estimate:'Public list-price estimate plus unknown request reservations, not invoice'});ledgerWrite=ledgerWrite.then(()=>writeFile(join(root,'usage.json'),text));return ledgerWrite;};
  try{
   const textOnly=input.textOnlyIdentity===true&&input.phase==='identity';
   if(input.textOnlyIdentity===true&&input.phase!=='identity')throw Error('Text-only identity opt-in cannot disable perception images');
     if(!input.images.length&&!textOnly)throw Error('Separated request needs images or explicit text-only identity opt-in');
   const data=input.data as any;
   if(!data?.current||typeof data.current.id!=='string')throw Error('Separated request needs exact current ID');
    if(input.phase==='perception'&&(Object.keys(data).some(key=>!['current','feedback',...(input.windowSources?['observations']:[])].includes(key))||input.images.some(image=>input.windowSources?!input.windowSources.some(s=>s.id===image.id):image.id!==data.current.id)))throw Error('Independent perception cannot receive history, identities or reference images');
    if(input.windowSources&&(!input.windowSources.length||input.windowSources.length>4||new Set(input.windowSources.map(s=>s.id)).size!==input.windowSources.length||!input.windowSources.some(s=>s.id===data.current.id)||input.windowSources.some(s=>!s.id||!Number.isFinite(s.atMs)||s.atMs>data.current.atMs||!input.images.some(image=>image.id===s.id))))throw Error('Invalid current window source bindings');
    if(input.phase==='perception'&&input.windowSources&&(!Array.isArray(data.observations)||JSON.stringify(data.observations)!==JSON.stringify(input.windowSources)))throw Error('Batch perception accepts only source/time metadata, never prior facts');
   const key=process.env.QWEN_API_KEY,base=process.env.QWEN_BASE_URL;if(!key||!base)throw Error('Missing Qwen configuration');
   // JSON-object transports require the literal word JSON in messages, regardless
   // of whether a caller describes its schema only in Chinese or with examples.
   const outputInstruction=input.responseMode==='text'?'':'\nReturn only one JSON object.';
   const content:Array<Record<string,unknown>>=[{type:'text',text:input.prompt+outputInstruction+'\nINPUT='+JSON.stringify(input.data)}];
   for(const image of input.images){
    const bytes=await readFile(image.path);
    if(createHash('sha256').update(bytes).digest('hex')!==image.sha256||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Separated original image hash/PNG mismatch');
     const member=input.windowSources?.find(s=>s.id===image.id);
     content.push({type:'text',text:`${member?'CURRENT_WINDOW':image.id===(input.data as any).current?.id?'CURRENT':'REFERENCE'} sourceId=${image.id} direction=${image.direction}${member?' atMs='+member.atMs:''}`},{type:'image_url',image_url:{url:'data:image/png;base64,'+bytes.toString('base64')}});
   }
   await writeFile(join(directory,'input.json'),JSON.stringify(input,null,2));
     const payload=JSON.stringify({model:'qwen3.8-flash',enable_thinking:false,temperature:0,max_tokens:maxOutputTokens,...input.responseMode==='text'?{}:{response_format:{type:'json_object'}},messages:[{role:'user',content}]});
    timing.preparationMs=performance.now()-started;
    const {response,text}=await boundedNetworkRetry(async attempt=>{
     if(attempt>0){if(calls>=maxCalls||cost+reservation>maxEstimatedUSD)throw Error('Separated request budget exhausted');calls++;cost+=reservation;unknownCallsReserved++;}
    await writeFile(join(directory,`reservation-${attempt}.json`),JSON.stringify({attempt,model:'qwen3.8-flash',enableThinking:false,reservedInputTokens:128000,maxOutputTokens,reservation}));await ledger();
     const sent=performance.now();
     const response=await fetch(base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:payload,signal:AbortSignal.timeout(120000)});
     const headers=performance.now();const text=await response.text();
     timing.attempts.push({attempt,headersMs:headers-sent,bodyMs:performance.now()-headers});
     return {response,text};
   },async(error,attempt,retrying)=>{const causes=[];let current=error;for(let depth=0;depth<6&&current&&typeof current==='object';depth++){const e=current as {name?:string;code?:string;cause?:unknown};causes.push({name:e.name,code:e.code});current=e.cause;}await writeFile(join(directory,`transport-failure-${attempt}.json`),JSON.stringify({error:String(error),causes,retrying}));});
   await writeFile(join(directory,'response.txt'),text);
   if(!response.ok)throw Error(`Separated VLM HTTP ${response.status}`);
   const body=JSON.parse(text),usage=body.usage;
   if(!usage||!Number.isFinite(usage.prompt_tokens)||usage.prompt_tokens<0||!Number.isFinite(usage.completion_tokens)||usage.completion_tokens<0)throw Error('Missing separated usage');
   cost+=(usage.prompt_tokens*.1356+usage.completion_tokens*.4584)/1e6-reservation;unknownCallsReserved--;await ledger();await writeFile(join(directory,'usage.json'),JSON.stringify(usage));
   // Bad JSON is a provider/protocol failure, retained without a hidden repair.
      if(body.choices?.[0]?.finish_reason!=='stop')throw new SpatialOutputProtocolError('Model output did not finish normally');
      if(input.responseMode==='text'){const result=body.choices[0].message.content;if(typeof result!=='string'||!result.trim())throw new SpatialOutputProtocolError('Empty source-bound text');timing.success=true;return result;}
       try{const result=JSON.parse(body.choices[0].message.content);timing.success=true;return input.includeUsage?{output:result,usage}:result;}catch(error){if(error instanceof SyntaxError)throw new SpatialOutputProtocolError('Model content is not valid JSON: '+error.message);throw error;}
   }catch(error){await writeFile(join(directory,'failure.json'),JSON.stringify({error:String(error)}));if(error instanceof SpatialOutputProtocolError)throw error;const failure=new Error(String(error));failure.name='SpatialProviderError';throw failure;}
   finally{timing.totalMs=performance.now()-started;await writeFile(join(directory,'timing.json'),JSON.stringify({...timing,note:'Non-streaming headers/body timing is not token TTFT or server prefill/decode profiling.'}));}
 };
}
