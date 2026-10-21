import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {boundedNetworkRetry} from './bounded-network-retry.js';
export interface SpatialJsonImage {id:string;direction:string;path:string;sha256:string}
export interface SpatialJsonRequest {phase:'perception'|'identity';prompt:string;data:unknown;images:SpatialJsonImage[];metadata?:{referenceBindings:Array<{alias:string;originalId:string;kind:'source'|'group'}>}}
/** Separate stateless request adapter. Metadata receipts never embed Base64. */
export function spatialJsonVlm(root:string,maxCalls=96,maxEstimatedUSD=.4){
 let calls=0,cost=0,unknownCallsReserved=0;
 return async(input:SpatialJsonRequest):Promise<unknown>=>{
  const directory=join(root,String(calls).padStart(4,'0'));await mkdir(directory,{recursive:true});
  const ledger=()=>writeFile(join(root,'usage.json'),JSON.stringify({calls,estimatedUSD:cost,unknownCallsReserved,maxCalls,maxEstimatedUSD,estimate:'Public list-price estimate plus unknown request reservations, not invoice'}));
  try{
   if(!input.images.length||input.images.length>12)throw Error('Separated request needs 1–12 images');
   const data=input.data as any;
   if(!data?.current||typeof data.current.id!=='string')throw Error('Separated request needs exact current ID');
   if(input.phase==='perception'&&(Object.keys(data).some(key=>!['current','feedback'].includes(key))||input.images.some(image=>image.id!==data.current.id)))throw Error('Independent perception cannot receive history, identities or reference images');
   const key=process.env.QWEN_API_KEY,base=process.env.QWEN_BASE_URL;if(!key||!base)throw Error('Missing Qwen configuration');
   const content:Array<Record<string,unknown>>=[{type:'text',text:input.prompt+'\nINPUT='+JSON.stringify(input.data)}];
   for(const image of input.images){
    const bytes=await readFile(image.path);
    if(createHash('sha256').update(bytes).digest('hex')!==image.sha256||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Separated original image hash/PNG mismatch');
    content.push({type:'text',text:`${image.id===(input.data as any).current?.id?'CURRENT':'REFERENCE'} sourceId=${image.id} direction=${image.direction}`},{type:'image_url',image_url:{url:'data:image/png;base64,'+bytes.toString('base64')}});
   }
   await writeFile(join(directory,'input.json'),JSON.stringify(input,null,2));
   const maxOutputTokens=1000,reservation=(128000*.1356+maxOutputTokens*.4584)/1e6;
   const payload=JSON.stringify({model:'qwen3.8-flash',enable_thinking:false,temperature:0,max_tokens:maxOutputTokens,response_format:{type:'json_object'},messages:[{role:'user',content}]});
   const {response,text}=await boundedNetworkRetry(async attempt=>{
    if(calls>=maxCalls||cost+reservation>maxEstimatedUSD)throw Error('Separated request budget exhausted');
    calls++;cost+=reservation;unknownCallsReserved++;
    await writeFile(join(directory,`reservation-${attempt}.json`),JSON.stringify({attempt,model:'qwen3.8-flash',enableThinking:false,reservedInputTokens:128000,maxOutputTokens,reservation}));await ledger();
    const response=await fetch(base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:payload,signal:AbortSignal.timeout(120000)});
    return {response,text:await response.text()};
   },async(error,attempt,retrying)=>{await writeFile(join(directory,`transport-failure-${attempt}.json`),JSON.stringify({error:String(error),retrying}));});
   await writeFile(join(directory,'response.txt'),text);
   if(!response.ok)throw Error(`Separated VLM HTTP ${response.status}`);
   const body=JSON.parse(text),usage=body.usage;
   if(!usage||!Number.isFinite(usage.prompt_tokens)||usage.prompt_tokens<0||!Number.isFinite(usage.completion_tokens)||usage.completion_tokens<0)throw Error('Missing separated usage');
   cost+=(usage.prompt_tokens*.1356+usage.completion_tokens*.4584)/1e6-reservation;unknownCallsReserved--;await ledger();await writeFile(join(directory,'usage.json'),JSON.stringify(usage));
   // Bad JSON is a provider/protocol failure, retained without a hidden repair.
   return JSON.parse(body.choices[0].message.content);
  }catch(error){await writeFile(join(directory,'failure.json'),JSON.stringify({error:String(error)}));const failure=new Error(String(error));failure.name='SpatialProviderError';throw failure;}
 };
}
