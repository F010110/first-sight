import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WindowAnswer,WindowRecognizer } from './spatial-topology-service.js';

/** V2 strict target/reference separation; v1 recognizer remains frozen. */
export function spatialV2Vlm(root:string,reviewProposal?:WindowAnswer):WindowRecognizer{
  return async(batch,history)=>{
   if(batch.length<1||batch.length>4||new Set(batch.map(o=>o.id)).size!==batch.length)throw Error('V2 target window budget exceeded');
  const key=process.env.QWEN_API_KEY,base=process.env.QWEN_BASE_URL;if(!key||!base)throw Error('Missing Qwen configuration');
  const directory=join(root,randomUUID());await mkdir(directory,{recursive:true});
  const ids=batch.map(o=>o.id);const content:Array<Record<string,unknown>>=[{type:'text',text:`逐观察判断观察者所在具体空间，不是隔门看见的空间。一个短窗口可包含多个地点。不要按旋转新建地点，不凭共同家具合并。旧地点须引用目录ID，新地点用new-1等，证据不足placeId=null。仅输出JSON {"places":[{"id":"历史ID或new-1","summary":"布局摘要"}],"assignments":[{"observationId":"当前目标ID","placeId":"已声明ID或null","reason":"原图证据"}]}。历史只供比较，严禁给历史参考图输出assignment。当前目标ID白名单=${JSON.stringify(ids)}；assignments必须恰好${ids.length}项，ID集合严格等于此白名单，不多不少。目录=${JSON.stringify(history.nodes.map(n=>({id:n.id,summary:n.summary})))}`}];
   const add=async(label:string,frames:string[])=>{if(frames.length<1||frames.length>3)throw Error('V2 camera group budget exceeded');content.push({type:'text',text:label});for(const path of frames){const mime=/\.png$/i.test(path)?'image/png':'image/jpeg';content.push({type:'image_url',image_url:{url:`data:${mime};base64,${(await readFile(path)).toString('base64')}`}});}};
   for(const node of history.nodes.slice(0,3)){const ref=node.representatives.at(-1);if(ref)await add(`HISTORICAL_PLACE_EVIDENCE placeId=${node.id}。当前目标若与这里相同，应复用这个placeId。仅参考图本身不需要assignment；这不是禁止复用该地点。`,ref.frames);}
   for(const row of history.observations.filter(o=>o.recordingId===batch[0]?.recordingId&&o.atMs<Math.min(...batch.map(b=>b.atMs))&&!ids.includes(o.id)).slice(-2))await add(`RECENT_TEMPORAL_CONTEXT atMs=${row.atMs}。紧邻当前窗口之前的原始观察，仅用于连续性/门槛/上下楼过程复核；不输出assignment，也不代表已确认地点。结合当前组时序判断是否越过楼层或房间边界，不能按相似墙砖合并。`,row.frames);
  for(const row of batch)await add(`CURRENT_TARGET observationId=${row.id} atMs=${row.atMs}`,row.frames);
   if(reviewProposal){const proposal=JSON.stringify(reviewProposal);if(proposal.length>16000)throw Error('Review proposal budget exceeded');content.push({type:'text',text:`独立复核以下不可信初判，不能照抄或把它当真值：${proposal}。同时防止误拆与误并：当前观察若有同一实例证据，应复用旧ID；若新建，应给出与最相似旧地点的具体实例/边界差异。瓷砖、墙色、家具类型相同不是同一地点证据，不能把不同楼层的相似走廊合并。按时间检查当前整组图：若连续图明确显示沿楼梯上/下行并进入另一层的平台或走廊，则越过了物理层界，不能因为墙砖相同继续沿用原走廊ID；不确定跨层或无法辨认实例时null，不臆造楼层编号。楼梯、门槛、室内外边界可以将一个窗口拆成多个地点；只转头不拆。保留逐观察判定，证据不足null。`});}
  content.push({type:'text',text:`再次核对：只回答当前ID ${JSON.stringify(ids)}，恰好${ids.length}项。参考图不是目标。`});
   await writeFile(join(directory,'input.json'),JSON.stringify({batch,history,reviewProposal:reviewProposal??null,model:'qwen3.8-flash',enable_thinking:false,promptVersion:'strict-targets-v2'},null,2));
  const messages:Array<Record<string,unknown>>=[{role:'user',content}];const started=Date.now();
  try{for(let attempt=0;attempt<2;attempt++){
   const response=await fetch(base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'qwen3.8-flash',messages,temperature:0,max_tokens:1800,enable_thinking:false}),signal:AbortSignal.timeout(120000)});
   if(!response.ok)throw Error(`VLM HTTP ${response.status}`);
   const raw=await response.json() as {choices:Array<{message:{content:string}}>};await writeFile(join(directory,`response-${attempt}.json`),JSON.stringify({response:raw,elapsedMs:Date.now()-started},null,2));
   const text=raw.choices[0]!.message.content;
   try{
    const answer=JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')) as WindowAnswer;
    if(!Array.isArray(answer.places)||!Array.isArray(answer.assignments))throw Error('Expected places and assignments arrays');
    const declared=answer.places.map(p=>p.id);
    if(new Set(declared).size!==declared.length||answer.places.some(p=>!p.summary?.trim()||(!history.nodes.some(n=>n.id===p.id)&&!/^new-[1-9][0-9]*$/.test(p.id))))throw Error('Invalid/duplicate place declaration');
    if(answer.assignments.length!==ids.length||new Set(answer.assignments.map(a=>a.observationId)).size!==ids.length||answer.assignments.some(a=>!ids.includes(a.observationId)||!a.reason?.trim()||(a.placeId!==null&&!declared.includes(a.placeId)&&!history.nodes.some(n=>n.id===a.placeId))))throw Error(`Targets must be EXACTLY ${JSON.stringify(ids)}; received ${JSON.stringify(answer.assignments.map(a=>a.observationId))}; no reference assignments permitted`);
    return answer;
   }catch(error){if(attempt===1)throw error;messages.push({role:'assistant',content:text},{role:'user',content:`协议错误：${String(error)}。重新完整回答，不新增图像，不输出历史参考项。`});}
  }throw Error('No valid answer');}catch(error){await writeFile(join(directory,'failure.json'),JSON.stringify({message:String(error),elapsedMs:Date.now()-started}));throw error;}
 };
}
