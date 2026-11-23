import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spatialJsonVlm,type SpatialJsonImage} from '../../agent/spatial-json-vlm.js';

const [dest,confirm]=process.argv.slice(2);
if(!dest||confirm!=='--confirm-paid')throw Error('Usage: revisit-prompt-origin-probe NEW-OUTPUT --confirm-paid');
const reuseArg=process.argv.find(f=>f.startsWith('--reuse-interrupted=')),reuseRoot=reuseArg?resolve(reuseArg.slice('--reuse-interrupted='.length)):null;
const priorUsage=reuseRoot?JSON.parse(await readFile(join(reuseRoot,'requests/usage.json'),'utf8')):{calls:0,estimatedUSD:0};
const requestCap=24-priorUsage.calls,costCapUSD=1.2-priorUsage.estimatedUSD;
if(requestCap<1||costCapUSD<=0)throw Error('Total diagnostic budget already exhausted');
const out=resolve(dest);await mkdir(out,{recursive:false});
const root='run/unioncity-batch40-realtime813-v1/pi-requests';
const origin=JSON.parse(await readFile(join(root,'0048/input.json'),'utf8'));
const successor=JSON.parse(await readFile(join(root,'0051/input.json'),'utf8'));
const bundleRaw=await readFile('run/unioncity-batch40-realtime813-v1-grounded-review-v1/bundle.json');
const bundle=JSON.parse(bundleRaw.toString());
const obs=new Map<string,any>(bundle.observations.map((o:any)=>[o.id,o]));
const oid=(n:number)=>'rerender-v2-'+String(n).padStart(6,'0');
const views=(nums:number[]):SpatialJsonImage[]=>nums.flatMap(n=>obs.get(oid(n)).views);
const arms=['baseline','correspondence','counterevidence'] as const;
const additions={
 baseline:'',
 correspondence:'身份证据要求：不要把类别相同当成实例相同。若确认同一具体区域，说明当前/历史图中能一一对应的具体锚点组合及相对布局，并分别写来源ID和方向。彩旗、红砖、树木、普通路牌属于重复共性，不能单独认证同一地点。宽区域包含关系与具体位置同一分开；看见同一建筑也不自动占据同一侧。证据不足时可保留身份关联未决，不虚构确认依据。',
 counterevidence:'先检查同地假设能否被可见证据反驳，再作判断：比较入口/拐角形状、建筑排列、路沿、道路方向与锚点相对位置。列出真正独特的对应和可见冲突；普通红砖/彩旗/商铺类别不算独特对应。视角差异不是自动不同，未匹配也不是不存在；无法建立对应且无明确反证时写insufficient，不强判same/different。不要为维护历史ID解释而忽略当前图。历史名字/提交记录可能有错，不是真值。宽区域重叠不等于同一具体街角。',
};
const common='\n本次是冻结历史的诊断，不进行真实数据库提交。只使用本次images清单实际附带的原图；历史消息曾交付图像的文字不表示本次仍可看见。可输出memory_inspect请求本批或已交付历史ID（一次最多3个观察），或memory_add提交原有segments。为审查证据，在memory_add最外层增加associationChecks，逐对覆盖diagnosticPairs：{pairId,verdict:"same"|"different"|"insufficient",currentEvidence:"实际可见依据",historicalEvidence:"实际可见依据",comparison:"两者对应/冲突或限制"}。verdict表示同一具体占据区域，不是类别相同；大范围包含关系另写scopeRelation说明，不能拿same代替。保留真实转场，不能只因候选存在就拆段。解释应简短、可检查，不输出隐式思维链。';
await writeFile(join(out,'plan.json'),JSON.stringify({arms,repetitions:2,stages:['origin-641-660','successor-661-680','positive-control-380-65'],requestCap:24,costCapUSD:1.2,thinkingBudget:128,outputTokens:3000,bundleSHA256:createHash('sha256').update(bundleRaw).digest('hex'),originInputSHA256:createHash('sha256').update(await readFile(join(root,'0048/input.json'))).digest('hex'),scope:'Frozen pre-v57 history; repaired same-turn visual delivery; diagnostic branches and aliases only, not production Pi/SQLite commits. No map/pose/reference labels sent. Same images/model/budget across prompt arms. Positive control guards trivial rejection.',acceptance:'Both repetitions must avoid false specific-place confirmation at origin/successor, accept supported true control, preserve supported occupied-region transitions, and report processing time. Existing broad ID differences alone are not failure. No post-result prompt tuning in this run.'},null,2),{flag:'wx'});
await writeFile(join(out,'interruption-binding.json'),JSON.stringify({reuseRoot,priorUsage,requestCap,costCapUSD,totalRequestCap:24,totalCostCapUSD:1.2,note:'Prior unknown reservations remain charged. Only valid origin outputs may be reused; downstream/control are not reused.'},null,2),{flag:'wx'});
const model=spatialJsonVlm(join(out,'requests'),requestCap,costCapUSD,true,3000,{thinkingBudget:128,extendedOutput:true});
const results:any[]=[];
function cleanMessages(input:any){
 const messages=structuredClone(input.data.messages);
 // Drop only the current task's copied user payload; it is reissued from runtimeContext.
 if(messages.at(-1)?.role==='user')messages.pop();
 return messages;
}
const prefix=cleanMessages(origin);
for(let repetition=0;repetition<2;repetition++)for(const arm of repetition?[...arms].reverse():arms){
 const branch:any[]=[];let previous:any=null;
 for(const stage of ['origin','successor','control'] as const){
  const seed=stage==='successor'?successor:origin;
  const rt=structuredClone(seed.data.runtimeContext);
  let images:SpatialJsonImage[],pairs:any[];
  if(stage==='origin'){
   images=[...views([641,660,580]),...origin.images.filter((i:SpatialJsonImage)=>![oid(641),oid(660),oid(580)].includes(i.id))];
   pairs=[{pairId:'origin-return',currentId:oid(660),historicalId:oid(580)}];
  }else if(stage==='successor'){
   images=views([660,661,680,100,440,580]);
   pairs=[{pairId:'continuity',currentId:oid(661),historicalId:oid(660)},{pairId:'old-intersection',currentId:oid(680),historicalId:oid(100)},{pairId:'old-street',currentId:oid(680),historicalId:oid(440)}];
   rt.previousRegion=previous;
   rt.workingContext={policy:'diagnostic-branch-state-only',current:{id:oid(661),atMs:obs.get(oid(661)).atMs},location:null,recent:[],anchors:[],unresolved:[],note:'Historical v57 was not loaded. Previous branch conclusions are provisional diagnostic output, not production facts.'};
  }else{
   images=views([380,65]);pairs=[{pairId:'control',currentId:oid(380),historicalId:oid(65)}];
   rt.batch={id:'diagnostic-control',observationCount:1,observations:[{id:oid(380),atMs:obs.get(oid(380)).atMs,facts:obs.get(oid(380)).facts}],skippedBefore:[],missingFactIds:[]};
   rt.previousRegion=null;rt.workingContext={current:{id:oid(380),atMs:obs.get(oid(380)).atMs},recent:[],anchors:[]};rt.revisit={candidates:[]};
  }
  images=images.filter((v,i,a)=>a.findIndex(x=>x.path===v.path)===i);
  rt.batch.preloadedImageIds=[...new Set(images.map(i=>i.id))];rt.batch.preloadNote='Only images listed in actualImageManifest are supplied now; no identity accepted.';
  rt.inspectedIds=[...new Set(images.map(i=>i.id))];rt.deliveredIds=[...new Set([...rt.batch.observations.map((o:any)=>o.id),...rt.inspectedIds])];rt.lastToolResult=null;rt.feedback=null;
  const current=stage==='control'?{id:oid(380),atMs:obs.get(oid(380)).atMs}:seed.data.current;
  rt.currentObservation=structuredClone(current);
  const batchIds=new Set(rt.batch.observations.map((o:any)=>o.id));
  const historySourceClaims=[...new Set(images.map(i=>i.id))].filter(id=>!batchIds.has(id)).map(id=>{
   if(stage==='successor'&&id===oid(660))return {id,diagnosticPreviousRegion:previous,productionCommitted:false};
   const state=bundle.states.find((s:any)=>s.memberIds.includes(id));
   return {id,facts:obs.get(id)?.facts??null,storedLocationClaim:state?.assessment.location??null,note:'Historical model claim, not ground truth; original image is supplied.'};
  });
  const data:any={current,role:'spatial-prompt-origin-diagnostic',runtimeContext:rt,diagnosticPairs:pairs,historySourceClaims,actualImageManifest:images.map(i=>({id:i.id,direction:i.direction})),messages:stage==='control'?[]:[...prefix,...branch]};
  const input={phase:'identity' as const,prompt:origin.prompt+common+'\n'+additions[arm],data,images};
  if(data.current.id!==rt.currentObservation.id||rt.batch.observations.at(-1)?.id!==data.current.id)throw Error('Conflicting current observation metadata');
  if(JSON.stringify([...new Set(input.images.map(i=>i.id))])!==JSON.stringify(rt.batch.preloadedImageIds))throw Error('Conflicting actual image delivery metadata');
  const trace:any[]=[];let call:any=null,error:string|null=null;const started=Date.now();
  let reusedFrom:string|null=null;
  if(reuseRoot&&stage==='origin'){
   const path=join(reuseRoot,`${arm}-${repetition}-origin.json`);
   try{const saved=JSON.parse(await readFile(path,'utf8'));if(saved.valid&&saved.arm===arm&&saved.repetition===repetition&&saved.stage===stage){call=saved.call;trace.push(...saved.trace);reusedFrom=path;}}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  }
  for(let turn=0;!reusedFrom&&turn<2;turn++){
   try{
    const raw:any=await model(input);call=raw.output??raw;trace.push({turn,call});
    if(call.tool==='memory_inspect'){
     const ids=call.arguments?.ids;if(!Array.isArray(ids)||!ids.length||ids.length>3||ids.some((id:string)=>!rt.deliveredIds.includes(id)))throw Error('Inspect outside bounded delivered evidence');
     for(const id of ids)for(const image of obs.get(id)?.views??[])if(!input.images.some(i=>i.path===image.path))input.images.push(image);
     if(input.images.length>30)throw Error('Image budget exhausted');
     data.actualImageManifest=input.images.map(i=>({id:i.id,direction:i.direction}));rt.inspectedIds=[...new Set(input.images.map(i=>i.id))];
     rt.lastToolResult={kind:'diagnostic-inspection',ids,note:'Images actually delivered together; no identity accepted.'};data.probeTrajectory=trace;continue;
    }
    if(call.tool!=='memory_add'||!Array.isArray(call.arguments?.segments))throw Error('Expected memory_add segments or bounded memory_inspect');
    const checks=call.associationChecks??call.arguments.associationChecks;
    if(!Array.isArray(checks)||checks.length!==pairs.length||pairs.some(p=>checks.filter((c:any)=>c.pairId===p.pairId).length!==1)||checks.some((c:any)=>!['same','different','insufficient'].includes(c.verdict)))throw Error('Incomplete associationChecks');
    const expected=rt.batch.observations.map((o:any)=>o.id),actual=call.arguments.segments.flatMap((s:any)=>s.observationIds??[]);
    if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error('Incomplete or unordered batch coverage');
    if(call.arguments.segments.some((s:any)=>(s.assessment?.location?.sourceIds??[]).some((id:string)=>!rt.deliveredIds.includes(id))))throw Error('Undelivered source reference');
    break;
   }catch(e){error=String(e);trace.push({turn,error});call=null;break;}
  }
  const valid=!!call&&call.tool==='memory_add'&&!error;
  const result={arm,repetition,stage,valid,error,reusedFrom,elapsedMs:reusedFrom?JSON.parse(await readFile(reusedFrom,'utf8')).elapsedMs:Date.now()-started,images:input.images.map(i=>({id:i.id,direction:i.direction})),call,trace};results.push(result);
  await writeFile(join(out,`${arm}-${repetition}-${stage}.json`),JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify({arm,repetition,stage,valid,error,elapsedMs:result.elapsedMs,checks:call?.associationChecks??call?.arguments?.associationChecks}));
  if(stage==='origin'){
   if(!valid){branch.push({role:'user',content:[{type:'text',text:'Previous diagnostic failed to produce a valid interpretation. Do not inherit a location.'}]});previous=null;}
   else{
    const segments=call.arguments.segments,tail=segments.at(-1).assessment.location;
    previous={observationId:oid(660),placeId:tail.status==='new'?`diagnostic:${arm}:${repetition}:tail`:tail.placeId,name:tail.name,uncertain:true};
    branch.push({role:'assistant',content:[{type:'text',text:JSON.stringify(call)}]},{role:'user',content:[{type:'text',text:JSON.stringify({kind:'diagnostic-branch-state',productionCommitted:false,previousRegion:previous,note:'Alias is local to this diagnostic. This is not a database commit receipt.'})}]});
   }
  }
 }
}
await writeFile(join(out,'report.json'),JSON.stringify({results,limitations:['Fixed-history diagnostic, not real production Session/transaction test','No reference ID accuracy used to decide scope','Semantic and image/map review required; valid means protocol only']},null,2),{flag:'wx'});
