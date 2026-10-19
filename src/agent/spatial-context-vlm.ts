import {mkdir,readFile,writeFile} from 'node:fs/promises';import {join,extname} from 'node:path';
import type {SpatialLoopModel,SpatialLoopDecision} from './spatial-context-loop.js';
import {boundedNetworkRetry} from './bounded-network-retry.js';

/** Dedicated experimental unified protocol; the old scored prompt stays frozen. */
export function spatialContextVlm(root:string,maxCalls=12,maxEstimatedUSD=.25,onRaw?:(atMs:number,value:unknown)=>Promise<void>):SpatialLoopModel{
  let calls=0,cost=0,unknownCallsReserved=0;
 return async input=>{
  if(calls>=maxCalls)throw Error('Unified VLM total request budget exhausted');
  const reservation=(128000*.1356+1200*.4584)/1e6;if(cost+reservation>maxEstimatedUSD)throw Error('Unified VLM cost budget exhausted');
  const current=input.context.current;if(!current)throw Error('No current view');
  if(!input.observations.length||input.observations.length>4||input.observations.some(o=>!o.frames.length||o.frames.length>3)||input.evidenceImages.length>12)throw Error('Unified model image budget exceeded');
  const key=process.env.QWEN_API_KEY,base=process.env.QWEN_BASE_URL;if(!key||!base)throw Error('Missing Qwen configuration');
  const directory=join(root,String(calls).padStart(4,'0'));await mkdir(directory,{recursive:true});
  const {evidenceImages,...metadata}=input;
  const content:Array<Record<string,unknown>>=[{type:'text',text:`你是持续空间记忆代理。每次调用必须为空间观察窗口observations中的每个观察给一个判断，然后选择下一步操作；不是只回答用户，也不是只判断最后一帧。同一时刻三图是一个位置。通过具体布局、开口和实例判断身份，不能只用房间功能名匹配；旋转或新物体不必新建。新地点用new-1、new-2等本窗口别名，同地用同一别名；已知地点使用context或已查看图像中的准确placeId，不足null。context是短期背景，outputs是未核实的模型交互，不是事实或已查看原图。不要复制旧reason冒充当前证据。
输出纯JSON：{"assessments":[{"observationId":"窗口准确ID","atMs":0,"placeId":null,"reason":"当前具体证据","sourceIds":["该观察ID"]}],"next":{"kind":"finish"}}。
assessments必须按窗口顺序恰好覆盖所有观察，每项sourceIds必须含该观察ID且只能引用已交付图像。无问题时可finish；有问题时先依据context和当前图，证据不足则search（额外query：短字面关键词）或inspect（额外ids：搜索候选或context中已知历史来源），实际取图再引用。answer必须包含四个字段：{"kind":"answer","answer":"正文","sourceIds":["原图来源ID"],"abstained":false}，不能省略sourceIds，即使assessments已有引用。无证据或最后一轮仍不足则明确拒答abstained=true。不能把历史状态当当前、不凭装饰推断同层。每个reason简短，回答简洁。当前输入：${JSON.stringify(metadata)}`}];
  if(input.historicalEvidenceRequired){
   const windowIds=new Set(input.observations.map(o=>o.id));
   const older=[...new Set([...input.context.recent,...input.context.anchors].flatMap(e=>e.sourceIds))].filter(id=>!windowIds.has(id));
   const viewed=[...new Set(input.evidenceImages.map(i=>i.id))].filter(id=>!windowIds.has(id));
   content.push({type:'text',text:`历史证据门禁：本窗口全部ID=${JSON.stringify([...windowIds])}，它们绝不是前一窗口。此前窗口已知、可直接inspect但本轮未必已看图的来源=${JSON.stringify(older)}。本轮已实际取回的历史原图=${JSON.stringify(viewed)}。${viewed.length?'回答必须引用这些历史原图之一。':'尚无任何历史原图！不得直接肯定回答或声称已经看过前一窗口。下一步必须inspect一个此前窗口ID，或search找来源；找不到时只能明确拒答。'}不要复制context中此前被拒绝的回答。${input.feedback??''}`});
  }
  content.push({type:'text',text:'地点建立规则：不知道建筑用途/房间名称，或context没有旧地点，不等于无法判断具体空间。首次观察若可见连贯的墙体、路径、开口、围栏等正面布局证据，可以建立new-1候选；同一窗口里连续的同一具体区域共用该候选。已有context地点有对应具体布局时可沿用。只有当前图不足以辨认区域或证据冲突时才用null；不要仅因历史为空而全部null。反过来，不能仅因旧地点匹配失败就新建不同地点，仍需正面空间证据。'});
  if(input.feedback)content.push({type:'text',text:`RUNTIME VALIDATION FEEDBACK: ${input.feedback} This rejection is authoritative; old context.outputs are only a record of statements, not permission to reuse a rejected identity.`});
  for(const observation of input.observations)for(const path of observation.frames){const mimeType=extname(path).toLowerCase()==='.png'?'image/png':'image/jpeg';content.push({type:'text',text:`WINDOW_TARGET sourceId=${observation.id}; atMs=${observation.atMs}`},{type:'image_url',image_url:{url:`data:${mimeType};base64,${(await readFile(path)).toString('base64')}`}});}
  for(const image of evidenceImages)content.push({type:'text',text:`HISTORICAL sourceId=${image.id}`},{type:'image_url',image_url:{url:`data:${image.mimeType};base64,${image.data}`}});
  await writeFile(join(directory,'input.json'),JSON.stringify(metadata,null,2));
  // Reserve before sending; even an interrupted request remains in the audit.
   const ledger=()=>writeFile(join(root,'usage.json'),JSON.stringify({calls,estimatedUSD:cost,unknownCallsReserved,maxEstimatedUSD,estimate:'Public list price plus unknown-call reservations, not invoice'}));
  try{
    const payload=JSON.stringify({model:'qwen3.8-flash',enable_thinking:false,temperature:0,max_tokens:1200,response_format:{type:'json_object'},messages:[{role:'user',content}]});
    const {response,text}=await boundedNetworkRetry(async attempt=>{
     if(calls>=maxCalls||cost+reservation>maxEstimatedUSD)throw Error('Unified VLM transport retry budget exhausted');
     calls++;cost+=reservation;unknownCallsReserved++;
     await writeFile(join(directory,`reservation-${attempt}.json`),JSON.stringify({attempt,reservedInputTokens:128000,maxOutputTokens:1200,model:'qwen3.8-flash',enableThinking:false,estimatedUSD:cost,maxEstimatedUSD}));await ledger();
     const response=await fetch(base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:payload,signal:AbortSignal.timeout(120000)});
     return {response,text:await response.text()};
    },async(error,attempt,retrying)=>{await writeFile(join(directory,`transport-failure-${attempt}.json`),JSON.stringify({error:String(error),cause:String((error as Error).cause),retrying}));await ledger();});
    await writeFile(join(directory,'response.txt'),text);await onRaw?.(current.atMs,{question:input.question,rawResponse:text,status:'unverified-raw-model-response'});if(!response.ok)throw Error(`Unified VLM HTTP ${response.status}`);
   const body=JSON.parse(text);if(!body.usage)throw Error('Missing VLM usage');await writeFile(join(directory,'usage.json'),JSON.stringify(body.usage));
   if(!Number.isFinite(body.usage.prompt_tokens)||!Number.isFinite(body.usage.completion_tokens))throw Error('Invalid VLM usage');
    cost+=((body.usage.prompt_tokens*.1356+body.usage.completion_tokens*.4584)/1e6)-reservation;
    unknownCallsReserved--;await ledger();
   return JSON.parse(body.choices[0].message.content) as SpatialLoopDecision;
  }catch(error){await writeFile(join(directory,'failure.json'),JSON.stringify({error:String(error)}));throw error;}
 };
}
