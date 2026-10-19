import {mkdir,readFile,writeFile} from 'node:fs/promises';import {join,extname} from 'node:path';
import type {SpatialLoopModel,SpatialLoopDecision} from './spatial-context-loop.js';

/** Dedicated experimental unified protocol; the old scored prompt stays frozen. */
export function spatialContextVlm(root:string,maxCalls=12,maxEstimatedUSD=.25):SpatialLoopModel{
 let calls=0,cost=0;
 return async input=>{
  if(calls>=maxCalls)throw Error('Unified VLM total request budget exhausted');
  const reservation=(128000*.1356+1200*.4584)/1e6;if(cost+reservation>maxEstimatedUSD)throw Error('Unified VLM cost budget exhausted');
  const current=input.context.current;if(!current)throw Error('No current view');
  const key=process.env.QWEN_API_KEY,base=process.env.QWEN_BASE_URL;if(!key||!base)throw Error('Missing Qwen configuration');
  const directory=join(root,String(calls++).padStart(4,'0'));await mkdir(directory,{recursive:true});
  const {evidenceImages,...metadata}=input;
  const content:Array<Record<string,unknown>>=[{type:'text',text:`你是持续空间记忆代理。每次调用都判断当前观察的具体地点身份，然后选择下一步。工作context是背景而非已查看图像，不能用相同功能名确认同一地点。新区域用placeId="new"，已知区域只能用context或已查看证据中的准确placeId；不足用null。assessment必须包含当前observationId、atMs、placeId、reason、sourceIds，只引用本次实际交付图像来源。问题为null时完成观察可finish；有问题先依据当前图和context，证据不足则search(单个短字面query)再inspect(ids)，看过原图后才能引用。无证据或最后一轮仍不足则answer并abstained=true。不要把历史状态说成当前事实，不凭装饰推断同层。输出纯JSON {"assessment":{"observationId":"...","atMs":0,"placeId":null,"reason":"...","sourceIds":["..."]},"next":{"kind":"finish|search|inspect|answer",...}}。search额外query，inspect额外ids，answer额外answer、sourceIds、abstained。当前材料：${JSON.stringify(metadata)}`}];
  content.push({type:'text',text:'协议补充：assessment.sourceIds和next.sourceIds是两个独立字段。next.kind="answer"时必须同时给answer、sourceIds、abstained，即使assessment已经有sourceIds也不能省略next.sourceIds。正确示例：{"assessment":{"observationId":"CURRENT_ID","atMs":0,"placeId":null,"reason":"当前图支持的判断","sourceIds":["CURRENT_ID"]},"next":{"kind":"answer","answer":"当前图可确认的特征","sourceIds":["CURRENT_ID"],"abstained":false}}。不要复制旧reason当当前判断；context有recent记录时不能说无历史记录。地点身份是具体布局，不需要先确定学校/工厂等建筑用途。'});
  for(const path of current.frames){const mimeType=extname(path).toLowerCase()==='.png'?'image/png':'image/jpeg';content.push({type:'text',text:`CURRENT sourceId=${current.id}`},{type:'image_url',image_url:{url:`data:${mimeType};base64,${(await readFile(path)).toString('base64')}`}});}
  for(const image of evidenceImages)content.push({type:'text',text:`HISTORICAL sourceId=${image.id}`},{type:'image_url',image_url:{url:`data:${image.mimeType};base64,${image.data}`}});
  await writeFile(join(directory,'input.json'),JSON.stringify(metadata,null,2));
  // Reserve before sending; even an interrupted request remains in the audit.
  cost+=reservation;await writeFile(join(directory,'reservation.json'),JSON.stringify({reservedInputTokens:128000,maxOutputTokens:1200,model:'qwen3.8-flash',enableThinking:false,estimatedUSD:cost,maxEstimatedUSD}));
  try{
   const response=await fetch(base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'qwen3.8-flash',enable_thinking:false,temperature:0,max_tokens:1200,response_format:{type:'json_object'},messages:[{role:'user',content}]}),signal:AbortSignal.timeout(120000)});
   const text=await response.text();await writeFile(join(directory,'response.txt'),text);if(!response.ok)throw Error(`Unified VLM HTTP ${response.status}`);
   const body=JSON.parse(text);if(!body.usage)throw Error('Missing VLM usage');await writeFile(join(directory,'usage.json'),JSON.stringify(body.usage));
   if(!Number.isFinite(body.usage.prompt_tokens)||!Number.isFinite(body.usage.completion_tokens))throw Error('Invalid VLM usage');
   cost+=((body.usage.prompt_tokens*.1356+body.usage.completion_tokens*.4584)/1e6)-reservation;
   await writeFile(join(root,'usage.json'),JSON.stringify({calls,estimatedUSD:cost,maxEstimatedUSD,estimate:'Public list price, not invoice'}));
   return JSON.parse(body.choices[0].message.content) as SpatialLoopDecision;
  }catch(error){await writeFile(join(directory,'failure.json'),JSON.stringify({error:String(error)}));throw error;}
 };
}
