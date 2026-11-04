import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {SpatialJsonImage} from '../../agent/spatial-json-vlm.js';

/** Evaluation only: separate credentials, model choice and ledger. Never used by spatial inference. */
export function evaluationJsonVlm(root:string,maxCalls=300,options:{transport?:'openrouter'|'configured'|'qwen';allowTextOnly?:boolean;maxInputChars?:number;maxTotalTokens?:number;allowFlash?:boolean}={}){
 let calls=0,issued=0,unknown=0,inputTokens=0,outputTokens=0,estimatedUSD=0,ledgerWrite=Promise.resolve();
 // Published Flash list price; Max price is not verified, so Max runs record tokens only.
 const flashPrice={input:.1356,output:.4584};
 const reservationTokens=136000;
 const ledger=()=>{const text=JSON.stringify({calls,inputTokens,outputTokens,unknownCallsReserved:unknown,estimatedUSD:Number(estimatedUSD.toFixed(8)),...options.maxTotalTokens?{maxTotalTokens:options.maxTotalTokens,reservedTokens:unknown*reservationTokens}:{},authority:'Provider-reported usage retained per request; not a verified invoice. USD is a public-list-price estimate, and only when the price basis is known.'});ledgerWrite=ledgerWrite.then(()=>writeFile(join(root,'usage.json'),text));return ledgerWrite;};
 return async(model:string,prompt:string,data:unknown,images:SpatialJsonImage[])=>{
  if(issued>=maxCalls)throw Error('Evaluation runaway guard');
  if((!images.length&&!options.allowTextOnly)||images.length>24)throw Error('Evaluation requires 1-24 bound originals or explicit text-only opt-in');
  if(options.maxInputChars&&prompt.length+JSON.stringify(data).length>options.maxInputChars)throw Error('Evaluation input character budget exhausted');
  if(options.maxTotalTokens&&inputTokens+outputTokens+(unknown+1)*reservationTokens>options.maxTotalTokens)throw Error('Evaluation token reservation budget exhausted');
  const qwen=options.transport==='qwen',configured=options.transport==='configured',gemini=model.startsWith('google/');
  const flash=model==='qwen3.8-flash',max=/^qwen3\.8-max(?:-\d+)?$/.test(model);
  // A cheaper judge is allowed only with an explicit opt-in that the caller records in its policy.
  if(qwen&&!max&&!(flash&&options.allowFlash===true))throw Error('Qwen evaluation requires same-version Max; Flash requires explicit allowFlash opt-in (a recorded, user-approved downgrade)');
  const key=qwen?process.env.QWEN_API_KEY:configured?(gemini?process.env.GEMINI_API_KEY:process.env.OPENAI_API_KEY):process.env.OPENROUTER_API_KEY;
  const base=qwen?process.env.QWEN_BASE_URL:configured?(gemini?process.env.GEMINI_BASE_URL:'https://api.openai.com/v1'):'https://openrouter.ai/api/v1';
  if(!key||!base)throw Error('Missing credentials/base for configured independent review provider');
  const wireModel=configured?model.replace(/^(openai|google)\//,''):model;
  const dir=join(root,String(issued++).padStart(4,'0'));await mkdir(dir,{recursive:true});
  const content:any[]=[{type:'text',text:prompt+'\nReturn only JSON.\nINPUT='+JSON.stringify(data)}];
  for(const image of images){const bytes=await readFile(image.path);if(createHash('sha256').update(bytes).digest('hex')!==image.sha256||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Review original hash/PNG mismatch');content.push({type:'text',text:`sourceId=${image.id} camera=${image.direction}`},{type:'image_url',image_url:{url:'data:image/png;base64,'+bytes.toString('base64')}});}
  await writeFile(join(dir,'input.json'),JSON.stringify({model,wireModel,transport:options.transport??'openrouter',endpointOrigin:new URL(base).origin,prompt,data,images},null,2));
  calls++;unknown++;await ledger();
  await writeFile(join(dir,'reservation.json'),JSON.stringify({model,maxOutputTokens:8000,networkOutcome:'unknown-until-response'}));
  const start=Date.now();
  try{
   const response=await fetch(base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:wireModel,...configured&&!gemini?{max_completion_tokens:8000,reasoning_effort:'medium'}:{temperature:0,max_tokens:8000},...qwen?{enable_thinking:false}:{},response_format:{type:'json_object'},messages:[{role:'user',content}]}),signal:AbortSignal.timeout(240000)});
   const text=await response.text();await writeFile(join(dir,'response.json'),text);
   if(!response.ok)throw Error('Evaluation provider HTTP '+response.status);
   const body=JSON.parse(text);if(!body.usage||!Number.isFinite(body.usage.prompt_tokens)||!Number.isFinite(body.usage.completion_tokens))throw Error('Missing evaluation usage');
   if(body.usage.prompt_tokens<0||body.usage.completion_tokens<0)throw Error('Invalid evaluation usage');
   inputTokens+=body.usage.prompt_tokens;outputTokens+=body.usage.completion_tokens;unknown--;
    if(flash)estimatedUSD+=(body.usage.prompt_tokens*flashPrice.input+body.usage.completion_tokens*flashPrice.output)/1e6;
    await ledger();
    await writeFile(join(dir,'usage.json'),JSON.stringify({requestedModel:model,returnedModel:body.model,provider:body.provider,usage:body.usage,priceBasis:flash?'qwen3.8-flash public list price':'unknown for this model; tokens only',elapsedMs:Date.now()-start}));
    if(qwen&&body.model&&body.model!==model)throw Error('Evaluation returned a different model: '+body.model);
   if(body.choices?.[0]?.finish_reason!=='stop')throw Error('Incomplete evaluation response');
   return JSON.parse(body.choices[0].message.content);
  }catch(error){await writeFile(join(dir,'failure.json'),JSON.stringify({error:String(error),elapsedMs:Date.now()-start}));throw error;}
 };
}
