import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spatialJsonVlm} from '../../agent/spatial-json-vlm.js';
import {sha} from './holistic-memory-bundle.js';
import {selectRevisitImagePairs} from '../../assistant/spatial-memory/revisit-candidates.js';
const [dest,confirm,resumeFlag]=process.argv.slice(2),resume=resumeFlag==='--resume',timeline=resumeFlag==='--timeline',identitycheck=resumeFlag==='--identitycheck',corroborate=resumeFlag==='--corroborate',paircheck=resumeFlag==='--paircheck'||corroborate||identitycheck,supply=resumeFlag==='--supply'||paircheck;
const backendComparison=process.argv.includes('--backend-comparison');
const arms=backendComparison?['legacy','ulvn']:identitycheck?['surface-versus-place-identity']:corroborate?['pair-plus-place-anchor']:paircheck?['explicit-pair-checks']:supply?['paired-continuity-supply']:timeline?['timeline-evidence-3pairs']:['baseline-3pairs','evidence-bound-3pairs'];
if(!dest||confirm!=='--confirm-paid')throw Error('Usage: repeat-revisit-probe NEW-OUTPUT --confirm-paid');
const out=resolve(dest),base='run/unioncity-batch40-paired-budget-sweep-v2';
const bundle=JSON.parse(await readFile('run/unioncity-batch40-realtime813-v1-grounded-review-v1/bundle.json','utf8'));
const owner=new Map<string,string|null>();for(const s of bundle.states)for(const id of s.memberIds)owner.set(id,s.assessment.location.placeId);
const cases=[{slot:'0022',request:'0001',target:'10536570-e9df-4e37-9148-6160cc8269b3',ids:[322,323,324]},{slot:'0025',request:'0004',target:'f9607749-034c-4749-9276-44c2724cbcd5',ids:[376,377,378,379,380]},{slot:'0051',request:'0007',target:'10536570-e9df-4e37-9148-6160cc8269b3',ids:[675,676,677,678,679,680]}];
if(!resume){await mkdir(out,{recursive:false});
await writeFile(join(out,'plan.json'),JSON.stringify({arms,repetitions:3,cases,turnCap:3,requestCap:60,costCapUSD:2,outputTokens:timeline?3000:2000,scope:'Frozen-context bounded protocol/inspect simulator. No durable commits or production Pi Session restoration. Targets are evaluation-only and never sent to model. All attempts retained; finite experiment, not test-until-lucky.',bundleSHA256:sha(await readFile('run/unioncity-batch40-realtime813-v1-grounded-review-v1/bundle.json'))},null,2),{flag:'wx'});}
else {const plan=JSON.parse(await readFile(join(out,'plan.json'),'utf8'));if(plan.bundleSHA256!==sha(await readFile('run/unioncity-batch40-realtime813-v1-grounded-review-v1/bundle.json')))throw Error('Changed frozen bundle');}
let interruptedFailure:string|null=null;
if(resume){const slots=(await readdir(join(out,'requests'))).filter(n=>/^\d+$/.test(n)).sort();const last=slots.at(-1);if(last)try{interruptedFailure=await readFile(join(out,'requests',last,'failure.json'),'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
const request=spatialJsonVlm(join(out,'requests'),60,2,true,timeline||supply?3000:2000,{thinkingBudget:128,extendedOutput:timeline||supply});
const results:any[]=[];
if(backendComparison)await writeFile(join(out,'backend-comparison-policy.json'),JSON.stringify({backends:arms,matcherResults:'run/ulvn-visual-prefix-probe-v1/*-1.json',pairBudget:3,initialImageBudget:8,selection:'Shared production selectRevisitImagePairs; same batch-head/tail front views',prompt:'Same identitycheck instructions for both backends',limitations:'Frozen-context tool simulator, not persistent Pi/SQLite system test; target recovery is not semantic correctness',semanticAuditRequired:true},null,2),{flag:'wx'});
for(let repetition=0;repetition<3;repetition++)for(const c of cases)for(const arm of repetition%2?[...arms].reverse():arms){
 const outcomePath=join(out,`${c.slot}-${arm}-${repetition}.json`);
 if(resume){try{results.push(JSON.parse(await readFile(outcomePath,'utf8')));continue;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 if(interruptedFailure){const failure={slot:c.slot,arm,repetition,valid:false,recoveredMembers:0,targetMembers:c.ids.length,fullTargetRecovery:false,turns:1,elapsedMs:null,segments:[],trace:[{error:interruptedFailure}],note:'Interrupted trial preserved as failure; not rerun'};await writeFile(outcomePath,JSON.stringify(failure,null,2),{flag:'wx'});results.push(failure);interruptedFailure=null;continue;}
 const input=JSON.parse(await readFile(join(base,'requests',c.request,'input.json'),'utf8')),rt=input.data.runtimeContext;
 const batchIds:string[]=rt.batch.observations.map((o:any)=>o.id),allCurrent=new Set(batchIds),first=bundle.observations.findIndex((o:any)=>o.id===batchIds[0]),past=new Set<string>(bundle.observations.slice(0,first).map((o:any)=>o.id));
  const binding=()=>{const map:Record<string,string[]>={};for(const image of input.images){if(!past.has(image.id))continue;const place=owner.get(image.id);if(place){const a=map[place]??=[];if(!a.includes(image.id))a.push(image.id);map[place]=a;}}return map;};
 if(supply&&!paircheck){
  const previous=bundle.observations.find((o:any)=>o.id===rt.previousRegion?.observationId),image=previous?.views.find((v:any)=>v.direction==='front');
  if(image&&!input.images.some((v:any)=>v.path===image.path))input.images.push(image);
  rt.inspectedIds=[...new Set(input.images.map((v:any)=>v.id))];
  input.prompt+='\nEvidence delivery clarification: inspectedHistoryByPlace maps actually visible historical image IDs to their stored place ID. One immediately preceding front image is included for checking continuity, not for inheriting position across changes. Reassess each evidence-supported segment. Historical sources cited but not yet visible may be supplied in a subsequent turn; supply does not commit or auto-cite. Do not merge all batch observations merely because the last image matches an old place.';
 }
  if(paircheck){
   let selected=JSON.parse(await readFile(join(base,`${c.slot}-pairs3-comparison.json`),'utf8')).pairs;
   if(backendComparison){
    const start=Number(batchIds[0]!.slice(-6)),probePath=join('run/ulvn-visual-prefix-probe-v1',`${arm}-${start}-1.json`),probe=JSON.parse(await readFile(probePath,'utf8'));
    if(!probe.result.ok)throw Error('Unavailable frozen matcher result: '+probePath);
    selected=selectRevisitImagePairs(probe.recall,batchIds,3);
    if(!selected.length)throw Error('No matched image pairs: '+probePath);
    rt.revisit=probe.recall;
    const tails=[batchIds[0],batchIds.at(-1)].map(id=>bundle.observations.find((o:any)=>o.id===id)?.views.find((v:any)=>v.direction==='front')).filter(Boolean);
    input.images=[...selected.flatMap((p:any)=>[p.current,p.historical]),...tails].filter((v:any,i:number,a:any[])=>a.findIndex(x=>x.path===v.path)===i);
    rt.inspectedIds=[...new Set(input.images.map((v:any)=>v.id))];rt.deliveredIds=[...new Set([...batchIds,...input.images.map((v:any)=>v.id)])];
    await writeFile(join(out,`${c.slot}-${arm}-${repetition}-matcher-binding.json`),JSON.stringify({probePath,probeSHA256:sha(await readFile(probePath)),selected,images:input.images},null,2),{flag:'wx'});
   }
  rt.pairReviewTasks=selected.map((p:any,i:number)=>({pairId:'pair-'+i,current:{id:p.current.id,direction:p.current.direction},historical:{id:p.historical.id,direction:p.historical.direction,storedPlaceId:owner.get(p.historical.id)},candidatePlaceId:p.placeId}));
  if(identitycheck){
   for(const task of rt.pairReviewTasks){const s=bundle.states.find((s:any)=>s.memberIds.includes(task.historical.id));task.historical.storedLocationClaim=s?.assessment.location;task.historical.facts=bundle.observations.find((o:any)=>o.id===task.historical.id)?.facts??null;}
   input.prompt+='\n重要：图像表面匹配与地点身份可复用是两个不同命题。pairReviewTasks.historical.storedLocationClaim是该历史来源当时归属的地点声明，不是真值；历史图片也可能包含窗外、门外或误归属。evidenceChecks.verdict必须审核“当前占据区域是否支持复用candidatePlaceId”，而不是只审核两图是否看见同一店面。可以额外写surfaceMatch:true/false、placeClaimCompatible:true/false/null。若旧图看到外墙而ID声明店内，当前又在室外，即使surfaceMatch=true也不能判身份same；应different或insufficient，保留未决，不强行复用该ID。反过来名称太宽不自动拒绝真正的布局匹配。这个核对不授权程序自动更改身份，你仍需按实际证据判断所有片段。';
  }
  if(corroborate){
   rt.placeCorroboration=[];
   for(const placeId of [...new Set<string>(selected.map((p:any)=>p.placeId))]){
    const oldStates=bundle.states.filter((s:any)=>s.assessment.location.placeId===placeId&&s.memberIds.every((id:string)=>past.has(id)));
    const firstVisit=oldStates[0]?.visitId;if(!firstVisit)continue;
    const oldIds=oldStates.filter((s:any)=>s.visitId===firstVisit).flatMap((s:any)=>s.memberIds);
    const id=oldIds[Math.floor(oldIds.length/2)],o=bundle.observations.find((o:any)=>o.id===id),image=o?.views.find((v:any)=>v.direction==='front');
    if(!image)continue;if(!input.images.some((v:any)=>v.path===image.path))input.images.push(image);
    rt.placeCorroboration.push({placeId,anchorObservationId:id,direction:image.direction,selection:'middle observation of earliest completed visit in this frozen prefix; not ground truth',priorClaim:oldStates.find((s:any)=>s.memberIds.includes(id))?.assessment.location});
   }
   rt.inspectedIds=[...new Set(input.images.map((v:any)=>v.id))];rt.deliveredIds=[...new Set([...(rt.deliveredIds??[]),...input.images.map((v:any)=>v.id)])];
   input.prompt+='\nplaceCorroboration提供每个候选旧地点早期访问中部的额外原图与当时声明，仍可能含旧错误。局部匹配图可能拍到窗外、门外或边界，不能因此把当前区域归入旧图所属地点。复用ID前同时核对额外图代表的占据区域与当前是否兼容；若只匹配到该地点外部可见表面，不要把当前室外归成其室内。两份旧来源冲突时写未决并按需取证，不把历史声明当真值。不得因这张补充图本身强制拆段或新建。';
  }
  input.prompt+='\n本次诊断必须先对实际交付图对作可审查的简短证据核对，不输出隐式思维链。在最终JSON与tool/arguments同级增加evidenceChecks数组，恰好覆盖runtimeContext.pairReviewTasks：{pairId,verdict:"same"或"different"或"insufficient",currentOccupiedRegion:"当前占据区域",historicalOccupiedRegion:"旧时占据区域",evidence:"一句具体布局/边界依据"}。same只能表示双方具体占据区域支持同一地点，不能仅凭远处共同招牌。分数和历史名字均不认证身份。然后仍由你决定segments，不要求每对产生一段；same只支持该匹配观察附近，不证明整个40秒。比较不同时间的事实/原图，真实变化须处理，连续性不能吞掉已回到另一旧地的证据。最终known必须引用所属placeId的实际旧来源；未展示合法旧来源会先补图再要求你重评，不自动确认。evidenceChecks是临时可审查结论，不成为长期事实。';
 }
 if(arm==='timeline-evidence-3pairs'){
  const selected=JSON.parse(await readFile(join(base,`${c.slot}-pairs3-comparison.json`),'utf8')).pairs;
  rt.evidenceTimeline=selected.map((p:any)=>({current:{id:p.current.id,direction:p.current.direction,facts:rt.batch.observations.find((o:any)=>o.id===p.current.id)?.facts??null},historical:{id:p.historical.id,direction:p.historical.direction,storedPlaceId:owner.get(p.historical.id),facts:bundle.observations.find((o:any)=>o.id===p.historical.id)?.facts??null},candidatePlaceId:p.placeId,selectionChannel:p.channel,status:'images delivered; candidate identity NOT confirmed'})).sort((a:any,b:any)=>batchIds.indexOf(a.current.id)-batchIds.indexOf(b.current.id));
  input.images.sort((a:any,b:any)=>{const sequence=rt.evidenceTimeline.flatMap((e:any)=>[e.current.id+'\0'+e.current.direction,e.historical.id+'\0'+e.historical.direction]);const rank=(x:any)=>{const i=sequence.indexOf(x.id+'\0'+x.direction);return i<0?999:i;};return rank(a)-rank(b);});
  input.prompt+='\n本次证据以runtimeContext.evidenceTimeline为索引：当前事实是独立观察；历史事实仍是模型旧观察，不是当前可见。逐对先核对当前实际占据区域与旧图布局，再检查前后事实是否发生真实变化；候选图对只用于发现需要检查的位置，不能强迫每对创建地点或拆段。一个匹配只支持对应证据附近，不自动证明整40秒属于同地。相接的局部连续性也不能无限扩张地点覆盖变化后的区域。每个known段须在sourceIds引用该placeId所属、实际交付且支持身份的旧图；紧邻同地可用合法contextRefs。不要把其他候选地点的旧图引用给所选ID。当前首尾与中段原图及事实共同决定范围；允许真实boundary或继续inspect。提交前核对所有段尾、旧图归属和恰好覆盖；rename在所属segment内。输出可简洁但不得省略必要判断或牺牲质量。';
 }
 if(arm==='evidence-bound-3pairs')input.prompt+='\nEvidence binding contract: runtimeContext.inspectedHistoryByPlace lists historical images actually supplied for each place ID. A known claim must cite a supporting source of THAT place in sourceIds (unless valid immediate continuity); another place image is not support. These are candidate evidence, not accepted identities. A matched local surface can be visible from indoors/outdoors: decide occupied region separately. Check batch facts for real changes; do not split merely because another candidate exists. Do not merge different occupied regions merely to reuse an ID. Every segments entry needs observationIds and assessment; rename belongs inside its segment, never as a separate segment. You may inspect more evidence when needed.';
  const trace:any[]=[];let segments:any[]=[],valid=false,supplies=0;const started=Date.now();
 for(let turn=0;turn<3;turn++){
  if(arm!=='baseline-3pairs')rt.inspectedHistoryByPlace=binding();
   let raw:any;try{raw=await request(input);}catch(e){trace.push({turn,error:String(e)});break;}
   const call=raw.output??raw;trace.push({turn,call});
   if(supply&&call.tool==='memory_add'&&supplies<2){
    const visible=new Set(input.images.map((v:any)=>v.id));
    const cited=[...new Set<string>((call.arguments?.segments??[]).flatMap((s:any)=>s.assessment?.location?.sourceIds??[]))];
    const pending=cited.filter(id=>past.has(id)&&!visible.has(id)).slice(0,8);
    if(pending.length){
     const extra=pending.flatMap(id=>bundle.observations.find((o:any)=>o.id===id).views).filter((v:any)=>!input.images.some((i:any)=>i.path===v.path));
     if(input.images.length+extra.length>36){trace.at(-1).error='Historical supply exceeds image budget';break;}
     input.images.push(...extra);supplies++;rt.inspectedIds=[...new Set(input.images.map((v:any)=>v.id))];
     rt.lastToolResult={kind:'historical-evidence-inspection',observationIds:pending,note:'Images now delivered. Reassess and cite only if supporting identity; no commit or auto-citation occurred.'};
     input.data.probeTrajectory=[...trace.map(t=>({assistant:t.call,error:t.error})),{toolResult:rt.lastToolResult}];continue;
    }
   }
  const inspected=new Set<string>(input.images.map((i:any)=>i.id));
  try{
   if(call.tool==='memory_inspect'){
    const ids=call.arguments?.ids;if(!Array.isArray(ids)||!ids.length||ids.length>8||ids.some((id:string)=>!allCurrent.has(id)&&!(rt.deliveredIds??[]).includes(id)))throw Error('Inspect requires 1..8 current/delivered sources');
    const images=ids.flatMap((id:string)=>bundle.observations.find((o:any)=>o.id===id)?.views??[]);
    for(const image of images)if(!input.images.some((i:any)=>i.path===image.path))input.images.push(image);
    if(input.images.length>36)throw Error('Image budget exhausted');
    rt.inspectedIds=[...new Set(input.images.map((i:any)=>i.id))];rt.lastToolResult={kind:'inspect',observationIds:ids};continue;
   }
   if(call.tool!=='memory_add')throw Error('This bounded probe implements memory_inspect and memory_add only; other tools are recorded, not simulated as success');
   if(paircheck){const checks=call.evidenceChecks??call.arguments?.evidenceChecks;if(call.evidenceChecks&&call.arguments?.evidenceChecks&&JSON.stringify(call.evidenceChecks)!==JSON.stringify(call.arguments.evidenceChecks))throw Error('Conflicting evidenceChecks copies');if(!Array.isArray(checks)||checks.length!==rt.pairReviewTasks.length||new Set(checks.map((x:any)=>x.pairId)).size!==checks.length||checks.some((x:any)=>!rt.pairReviewTasks.some((p:any)=>p.pairId===x.pairId)||!['same','different','insufficient'].includes(x.verdict)||['currentOccupiedRegion','historicalOccupiedRegion','evidence'].some(k=>typeof x[k]!=='string'||!x[k].trim())))throw Error('Include complete evidenceChecks for the supplied pairReviewTasks (top level or arguments)');}
   segments=call.arguments?.segments;if(!Array.isArray(segments)||!segments.length)throw Error('Missing segments');let cursor=0;
   for(const s of segments){
    if(!Array.isArray(s.observationIds)||!s.observationIds.length||!s.assessment?.location)throw Error('Each segment requires observationIds and assessment.location; rename cannot be a standalone segment');
    for(const id of s.observationIds)if(id!==batchIds[cursor++])throw Error('Batch coverage must be exactly once in order');
    const l=s.assessment.location;if(!Array.isArray(l.sourceIds))throw Error('Missing sourceIds');
    // Same mechanical tail completion as production; no semantic source added.
    if(!l.sourceIds.includes(s.observationIds.at(-1)))l.sourceIds.push(s.observationIds.at(-1));
    if(l.sourceIds.some((id:string)=>!allCurrent.has(id)&&!inspected.has(id)))throw Error('Historical source cited without inspection this trial');
    if(l.status==='known'){
     const continuity=l.placeId===rt.previousRegion?.placeId&&(l.contextRefs??[]).includes(rt.previousRegion?.observationId);
     if(!continuity&&!l.sourceIds.some((id:string)=>past.has(id)&&inspected.has(id)&&owner.get(id)===l.placeId))throw Error('Known requires an inspected cited historical source belonging to the claimed place ID');
    }else if(l.status==='new'){if(l.placeId!==null)throw Error('New place ID must be null');}
    else if(l.status!=='unknown'||!Array.isArray(l.boundary?.regions)||l.boundary.regions.length!==2)throw Error('Bare unknown not allowed');
   }
   if(cursor!==batchIds.length)throw Error('Incomplete batch');valid=true;break;
   }catch(e){rt.feedback={toolName:call.tool,error:String(e),instruction:'Correct the exact error or inspect supporting delivered evidence. Do not invent citations.'};trace.at(-1).error=String(e);}
   if(supply)input.data.probeTrajectory=trace.map(t=>({assistant:t.call,error:t.error}));
 }
 const recovered=c.ids.filter(n=>segments.some(s=>s.observationIds?.includes('rerender-v2-'+String(n).padStart(6,'0'))&&s.assessment?.location?.placeId===c.target)).length;
 const result={slot:c.slot,arm,repetition,valid,recoveredMembers:recovered,targetMembers:c.ids.length,fullTargetRecovery:valid&&recovered===c.ids.length,turns:trace.length,elapsedMs:Date.now()-started,images:input.images.length,segments,trace};results.push(result);
 await writeFile(join(out,`${c.slot}-${arm}-${repetition}.json`),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({slot:c.slot,arm,repetition,valid,recoveredMembers:recovered,turns:trace.length,elapsedMs:result.elapsedMs}));
}
await writeFile(join(out,'report.json'),JSON.stringify({results,summary:arms.map(arm=>{const a=results.filter(r=>r.arm===arm);return {arm,trials:a.length,protocolValid:a.filter(r=>r.valid).length,fullTargetRecovery:a.filter(r=>r.fullTargetRecovery).length,maxElapsedMs:Math.max(...a.map(r=>r.elapsedMs))};}),limitations:['Protocol simulator is not production transaction validation','Target-member agreement is not a full semantic correctness score','Only three diagnosed failure contexts; not generalization','Finite repeated trials, no stopping on a favorable sample']},null,2),{flag:'wx'});
