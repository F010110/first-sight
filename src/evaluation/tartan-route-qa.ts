import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spatialJsonVlm,type SpatialJsonRequest} from '../agent/spatial-json-vlm.js';

interface Task {id:string;kind:string;queryImages:string[];candidates:string[];goalPlaceId?:string;knownPlaceId?:string;targetImageId?:string;bodyHeadingAvailable?:boolean}
interface PublicSet {
 schema:string;headingConvention:string;
 images:Record<string,{path:string;sha256:string;headingDeg:number;view:string}>;
 nodes:Array<{id:string;images:string[]}>;
 edges:Array<{id:string;from:string;to:string;departureHeadingDeg:number;evidenceImages:string[];kind:string}>;
 tasks:Task[];
}
const PROMPT=`你是实验性空间记忆问答助手，不是实时安全导航器。输入是已标注地点图库和有向历史机器人通行图，不需恢复坐标。
每张图片有唯一ID及独立相机朝向headingDeg。NED角度顺时针为正，0是任意世界参考；正差右转、负差左转，取[-180,180)。朝向已量化到15度：差绝对值<=25为straight，>=155为reverse，其余left/right。这些是相机/历史运动方向，不是人的身体方向。
localization/cross_view_localization：比较query与候选原图，判断属于哪个地点；相似建筑不等于相同地点。图库地点是小范围位置锚点，不是整个房间。路径为空、turn为unknown。提供的相机朝向可辅助跨视角匹配，不可仅凭朝向相近确定地点。
localized_route：先从图像定位，再按有向edges寻找去goalPlaceId的记录路径，path包括起点终点；turn是当前query相机朝向到第一条边departureHeadingDeg的差。
unrecorded_reverse：同样先定位再查图，没有记录路径则abstain=true，path=[]、turn=unknown；不声称物理上无法到达。
heading_alignment：knownPlaceId已知，判断query相机朝向如何对齐targetImageId的相机朝向，不输出路径。
missing_body_heading：已知地点但缺人身体朝向，不能根据相机朝向给人转向，abstain=true、turn=unknown、path=[]。
不得把有向边自动反向，不得把机器人走过等同视障用户可安全通行。说明必须提示是历史路线、当前通行及人体朝向未确认。
只输出JSON，字段恰为placeId（候选ID或null）、path（地点ID数组）、turn（unknown/straight/left/right/reverse）、abstain（布尔）、description（中文说明）、sourceIds（实际引用的图片ID数组，包含query和所判断地点的参考证据）。不输出坐标。不能确定时明确拒答。`;

export function benchmarkRequest(data:PublicSet,task:Task):SpatialJsonRequest{
 const route=task.kind==='localized_route'||task.kind==='unrecorded_reverse';
 const nodes=data.nodes.filter(n=>task.candidates.includes(n.id)).map(n=>({...n,images:route?n.images.slice(0,1):n.images}));
 const edges=route?data.edges.map(e=>({id:e.id,from:e.from,to:e.to,departureHeadingDeg:e.departureHeadingDeg,kind:e.kind,evidenceImages:e.evidenceImages})):[];
 const imageIds=[...new Set([...task.queryImages,...nodes.flatMap(n=>n.images),...edges.flatMap(e=>e.evidenceImages),...(task.targetImageId?[task.targetImageId]:[])])];
 if(imageIds.length>12||imageIds.some(id=>!data.images[id]))throw Error('Image budget or missing evidence');
 return {phase:'identity',prompt:PROMPT,data:{current:{id:task.queryImages[0]},task,headingConvention:data.headingConvention,nodes,edges,images:imageIds.map(id=>({id,view:data.images[id]!.view,headingDeg:data.images[id]!.headingDeg}))},images:imageIds.map(id=>({id,direction:data.images[id]!.view,path:data.images[id]!.path,sha256:data.images[id]!.sha256}))};
}

export function validateBenchmarkAnswer(raw:unknown,request:SpatialJsonRequest){
 const v=raw as any,d=request.data as any,task=d.task as Task;
 const keys=['placeId','path','turn','abstain','description','sourceIds'];
 if(!v||typeof v!=='object'||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||!(v.placeId===null||task.candidates.includes(v.placeId))||!Array.isArray(v.path)||v.path.some((id:unknown)=>!task.candidates.includes(id as string))||!['unknown','straight','left','right','reverse'].includes(v.turn)||typeof v.abstain!=='boolean'||typeof v.description!=='string'||!v.description.trim()||v.description.length>2000)throw Error('Invalid answer schema/IDs');
 const delivered=new Set(request.images.map(i=>i.id));
 if(!Array.isArray(v.sourceIds)||!v.sourceIds.includes(task.queryImages[0])||new Set(v.sourceIds).size!==v.sourceIds.length||v.sourceIds.some((id:unknown)=>!delivered.has(id as string)))throw Error('Invalid evidence citations');
 if(v.placeId!==null&&!d.nodes.find((n:any)=>n.id===v.placeId)?.images.some((id:string)=>v.sourceIds.includes(id)))throw Error('Selected place needs cited reference image');
 return v as {placeId:string|null;path:string[];turn:string;abstain:boolean;description:string;sourceIds:string[]};
}

async function main(){
 const [root,output,...flags]=process.argv.slice(2);
 const paid=flags.length===1&&flags[0]==='--confirm-paid',scripted=flags.length===2&&flags[0]==='--scripted';
 if(!root||!output||(!paid&&!scripted))throw Error('Usage: tartan-route-qa DATASET NEW-OUTPUT --confirm-paid | --scripted FILE');
 const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
 const raw=await readFile(join(root,'public.json'),'utf8'),freezeRaw=await readFile(join(root,'frozen.json'),'utf8'),frozen=JSON.parse(freezeRaw);
 if(hash(raw)!==frozen.publicSha256||frozen.answerPolicy!=='answers-before-inference')throw Error('Dataset must be answer-first and frozen');
 const data=JSON.parse(raw) as PublicSet;
 if(data.schema!=='tartan-route-qa-public-v1'||data.tasks.length>24||data.tasks.length!==frozen.tasks)throw Error('Invalid benchmark/task limit');
 // Model adapter receives allowlisted data only. No gold file is opened in this process.
 const replies=scripted?JSON.parse(await readFile(flags[1]!,'utf8')) as Record<string,unknown>:null;
 await mkdir(output,{recursive:false});
 const sourceHashes:Record<string,string>={};
 for(const p of ['src/evaluation/tartan-route-qa.ts','src/agent/spatial-json-vlm.ts','src/agent/bounded-network-retry.ts',fileURLToPath(import.meta.url),fileURLToPath(new URL('../agent/spatial-json-vlm.js',import.meta.url)),fileURLToPath(new URL('../agent/bounded-network-retry.js',import.meta.url))])sourceHashes[p]=hash(await readFile(p));
 await writeFile(join(output,'manifest.json'),JSON.stringify({schema:'tartan-route-qa-run-v1',mode:paid?'real-vlm':'scripted-pipeline-test-not-vlm',publicSha256:hash(raw),freezeSha256:hash(freezeRaw),sourceHashes,model:paid?'qwen3.8-flash':null,maxCalls:24,maxEstimatedUSD:.5,topology:'provided-annotated-not-autonomously-built'},null,2));
 const predictions:Array<{id:string;status:string;answer?:unknown;error?:string}>=data.tasks.map(t=>({id:t.id,status:'not_run'}));
 const save=()=>writeFile(join(output,'predictions.json'),JSON.stringify({predictions},null,2));
 await save();
 const provider=spatialJsonVlm(join(output,'requests'),24,.5);
 try{
  for(const task of data.tasks){
   const request=benchmarkRequest(data,task),row=predictions.find(p=>p.id===task.id)!;
   await writeFile(join(output,`${task.id}-input.json`),JSON.stringify(request,null,2));
   try{
    for(const image of request.images){if(hash(await readFile(image.path))!==image.sha256)throw Error('Original image changed');}
    const reply=paid?await provider(request):replies![task.id];
    await writeFile(join(output,`${task.id}-response.json`),JSON.stringify(reply??null,null,2));
    try{row.answer=validateBenchmarkAnswer(reply,request);row.status='completed';}
    catch(error){row.status='protocol_failed';row.error=String(error);}
   }catch(error){
    row.error=String(error);
    if(error instanceof Error&&error.name==='SpatialOutputProtocolError')row.status='protocol_failed';
    else{row.status='provider_failed';await save();throw error;}
   }
   await save();
  }
  await writeFile(join(output,'complete.json'),JSON.stringify({tasks:data.tasks.length,completed:predictions.filter(p=>p.status==='completed').length}));
 }catch(error){await writeFile(join(output,'stopped.json'),JSON.stringify({error:String(error)}));process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
