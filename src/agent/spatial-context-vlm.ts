import {mkdir,readFile,writeFile} from 'node:fs/promises';import {join,extname} from 'node:path';
import type {SpatialLoopModel,SpatialLoopDecision} from './spatial-context-loop.js';

/** Dedicated experimental unified protocol; the old scored prompt stays frozen. */
export function spatialContextVlm(root:string,maxCalls=12):SpatialLoopModel{
 let calls=0;
 return async input=>{
  if(calls>=maxCalls)throw Error('Unified VLM total request budget exhausted');
  const current=input.context.current;if(!current)throw Error('No current view');
  const key=process.env.QWEN_API_KEY,base=process.env.QWEN_BASE_URL;if(!key||!base)throw Error('Missing Qwen configuration');
  const directory=join(root,String(calls++).padStart(4,'0'));await mkdir(directory,{recursive:true});
  const {evidenceImages,...metadata}=input;
  const content:Array<Record<string,unknown>>=[{type:'text',text:`你是持续空间记忆代理。每次调用都判断当前观察的具体地点身份，然后选择下一步。工作context是背景而非已查看图像，不能用相同功能名确认同一地点。新区域用placeId="new"，已知区域只能用context或已查看证据中的准确placeId；不足用null。assessment必须包含当前observationId、atMs、placeId、reason、sourceIds，只引用本次实际交付图像来源。问题为null时完成观察可finish；有问题先依据当前图和context，证据不足则search(单个短字面query)再inspect(ids)，看过原图后才能引用。无证据或最后一轮仍不足则answer并abstained=true。不要把历史状态说成当前事实，不凭装饰推断同层。输出纯JSON {"assessment":{"observationId":"...","atMs":0,"placeId":null,"reason":"...","sourceIds":["..."]},"next":{"kind":"finish|search|inspect|answer",...}}。search额外query，inspect额外ids，answer额外answer、sourceIds、abstained。当前材料：${JSON.stringify(metadata)}`}];
  for(const path of current.frames){const mimeType=extname(path).toLowerCase()==='.png'?'image/png':'image/jpeg';content.push({type:'text',text:`CURRENT sourceId=${current.id}`},{type:'image_url',image_url:{url:`data:${mimeType};base64,${(await readFile(path)).toString('base64')}`}});}
  for(const image of evidenceImages)content.push({type:'text',text:`HISTORICAL sourceId=${image.id}`},{type:'image_url',image_url:{url:`data:${image.mimeType};base64,${image.data}`}});
  await writeFile(join(directory,'input.json'),JSON.stringify(metadata,null,2));
  // Reserve before sending; even an interrupted request remains in the audit.
  await writeFile(join(directory,'reservation.json'),JSON.stringify({maxInputTokens:32000,maxOutputTokens:1200,model:'qwen3.8-flash',enableThinking:false}));
  try{
   const response=await fetch(base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'qwen3.8-flash',enable_thinking:false,temperature:0,max_tokens:1200,response_format:{type:'json_object'},messages:[{role:'user',content}]}),signal:AbortSignal.timeout(120000)});
   const text=await response.text();await writeFile(join(directory,'response.txt'),text);if(!response.ok)throw Error(`Unified VLM HTTP ${response.status}`);
   const body=JSON.parse(text);if(!body.usage)throw Error('Missing VLM usage');await writeFile(join(directory,'usage.json'),JSON.stringify(body.usage));
   return JSON.parse(body.choices[0].message.content) as SpatialLoopDecision;
  }catch(error){await writeFile(join(directory,'failure.json'),JSON.stringify({error:String(error)}));throw error;}
 };
}
