import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pipelineArtifacts,loadJSON,digest} from './spatial-evaluation-pipeline.js';
import {evaluationJsonVlm} from './evaluation-json-vlm.js';
import {observationClaims,validateEnsembleReview,resolveEnsemble,ensembleDisputes,ensemblePrompt,claimVerdict,type Claim,type EnsembleReview} from './spatial-ensemble-review.js';
import type {SpatialJsonImage} from '../../agent/spatial-json-vlm.js';

const [runArg,outArg,confirm,route]=process.argv.slice(2);
if(!runArg||!outArg||confirm!=='--confirm-paid')throw Error('Usage: review-spatial-ensemble FROZEN-RUN NEW-OUTPUT --confirm-paid');
if(route!==undefined&&!['--configured-providers','--qwen-max'].includes(route))throw Error('Unknown evaluation provider selection');
const transport=route==='--qwen-max'||route===undefined?'qwen':route?'configured':'openrouter';
const run=resolve(runArg),out=resolve(outArg),{plan,rows,observations}=await pipelineArtifacts(run);
await mkdir(out,{recursive:false});
const models=transport==='qwen'?{primary:'qwen3.8-max-0902',secondary:'qwen3.8-max-0902',arbiter:'qwen3.8-max-0902'}:{primary:'openai/gpt-6.1-terra',secondary:'google/gemini-3.1-pro-preview',arbiter:transport==='configured'?'openai/gpt-6.1-sol':'openai/gpt-6.1-sol-pro'};
let selected:any[]=[];
if(transport==='qwen'){
 const base=process.env.QWEN_BASE_URL,key=process.env.QWEN_API_KEY;if(!base||!key)throw Error('Missing Qwen evaluation configuration');
 const response=await fetch(base.replace(/\/$/,'')+'/models',{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Qwen model registry HTTP '+response.status);
 const registry=await response.json() as any;
 selected=[...new Set(Object.values(models))].map(id=>{const model=registry.data?.find((m:any)=>m.id===id);if(!model)throw Error('Same-version Qwen Max unavailable: '+id);return model;});
}else if(transport==='openrouter'){
 const registryResponse=await fetch('https://openrouter.ai/api/v1/models',{signal:AbortSignal.timeout(30000)});if(!registryResponse.ok)throw Error('Model registry unavailable');
 const registry=await registryResponse.json() as any;
 selected=Object.values(models).map(id=>{const model=registry.data?.find((m:any)=>m.id===id);if(!model?.architecture?.input_modalities?.includes('image'))throw Error('Verified image model unavailable: '+id);return model;});
}else{
 for(const family of ['openai','google']){
  const base=family==='openai'?'https://api.openai.com/v1':process.env.GEMINI_BASE_URL,key=family==='openai'?process.env.OPENAI_API_KEY:process.env.GEMINI_API_KEY;
  if(!base||!key)throw Error('Missing configured provider');
  const response=await fetch(base.replace(/\/$/,'')+'/models',{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Configured model registry HTTP '+response.status);
  const registry=await response.json() as any;
  for(const id of Object.values(models).filter(id=>id.startsWith(family+'/'))){const model=registry.data?.find((m:any)=>m.id===id.slice(family.length+1));if(!model)throw Error('Configured model unavailable: '+id);selected.push({family,endpointOrigin:new URL(base).origin,...model});}
 }
}
await writeFile(join(out,'models.json'),JSON.stringify(selected,null,2));
await writeFile(join(out,'policy.json'),JSON.stringify({schema:'spatial-ensemble-policy-v1',run,models,transport,predictionsSHA256:digest(await readFile(join(run,'observations.jsonl'))),planSHA256:digest(await readFile(join(run,'plan.json'))),prompt:ensemblePrompt,promptSHA256:digest(ensemblePrompt),codeSHA256:digest(await readFile('src/sim/evaluation/review-spatial-ensemble.ts')),protocolRetries:1,blindFirstRounds:true,
 confirmation:'Two initial reviewers agree on contradiction, or a stronger adjudicator confirms a disputed contradiction with original images; provenance remains explicit',
 unknownPolicy:'Unreviewed/disputed/unverifiable are not confirmed errors or zero scores; report coverage and intervals; no production pass with incomplete review',
 limitations:['Same image may induce correlated errors even across model families','Six obvious positive/negative controls are a sanity check, not a statistically representative validation','No spatial inference regeneration; no question grading or full replay','Two local continuity positives cannot establish long-term recall']},null,2));
await writeFile(join(out,'reviewer-scope.json'),JSON.stringify({transport,producer:'qwen3.8-flash',judges:models,independence:transport==='qwen'?'Same-version Max independent requests with reversed evidence/claim order; not independent model families':'Different-family blind first rounds',productionCertification:false},null,2));
const request=evaluationJsonVlm(join(out,'requests'),450,{transport});
const imagesFor=(ids:string[])=>[...new Set(ids)].flatMap(id=>{const row=rows.find(r=>r.id===id);if(!row)throw Error('Unknown review source');return row.views.map(v=>({...v,id}));});
async function judge(model:string,claims:Claim[],images:SpatialJsonImage[],context:unknown,extra=''){
 const attempts:any[]=[];
 for(let attempt=0;attempt<2;attempt++){
  try{
   const raw=await request(model,ensemblePrompt+'\n'+extra+(attempt?'\n前次响应未通过格式校验。重查schema和完整ID覆盖；不要改写ID或输出schema外的类别。':''),{claims,context},images);
   const review=validateEnsembleReview(raw,claims);attempts.push({raw,valid:true});return {model,review,error:null,attempts};
  }catch(error){attempts.push({error:String(error),valid:false});if(/HTTP|fetch failed|Missing OPENROUTER|Timeout/.test(String(error)))break;}
 }
 return {model,review:null,error:attempts.at(-1)?.error??'Invalid review',attempts};
}
async function evaluate(id:string,claims:Claim[],images:SpatialJsonImage[],context:unknown,extra='',adjudicate=true){
 const [a,b]=await Promise.all([
  judge(models.primary,claims,images,context,extra+'\n第一轮：按给定顺序检查每条主张的图像依据。'),
  judge(models.secondary,[...claims].reverse(),[...images].reverse(),context,extra+'\n第二轮独立核查：先寻找支持主张的证据及合理替代解释，再决定是否有明确反证；不要将看不清或方向坐标歧义判作确定错误。')
 ]);
 let arbiter:Awaited<ReturnType<typeof judge>>|null=null;
 const disputes=a.review&&b.review?ensembleDisputes(a.review,b.review):claims.map(c=>c.id);
 const ratingGap=a.review&&b.review?Object.keys(a.review.ratings).some(key=>Math.abs((a.review!.ratings as any)[key]-(b.review!.ratings as any)[key])>=2):true;
 if(adjudicate&&(disputes.length||ratingGap))arbiter=await judge(models.arbiter,claims,images,{originalContext:context,reviewerA:a.review,reviewerB:b.review,disputedClaimIds:disputes},extra+'\n你在仲裁阶段：此前意见只是待核查主张，不是事实；优先核对原图，逐条决定，不能机械多数投票。');
 return {id,claims,images:images.map(i=>({id:i.id,camera:i.direction,sha256:i.sha256})),reviews:[a,b],arbiter,disputes,...resolveEnsemble(claims,a.review,b.review,arbiter?.review??null)};
}
const controls=[
 {id:'room-table-positive',source:'rerender-v2-000071',text:'房间中央可见绿色桌面的桌子。',expected:'supported'},
 {id:'room-no-shelves-negative',source:'rerender-v2-000071',text:'该房间内没有任何货架。',expected:'contradicted'},
 {id:'open-door-positive',source:'rerender-v2-000089',text:'通向街道的门开着，可以看到门外街道。',expected:'supported'},
 {id:'closed-door-negative',source:'rerender-v2-000089',text:'通向街道的门完全关上，无法看到门外街道。',expected:'contradicted'},
 {id:'street-positive',source:'rerender-v2-000101',text:'当前正前方是室外街道。',expected:'supported'},
 {id:'street-as-room-negative',source:'rerender-v2-000101',text:'当前正前方是摆着绿色桌子和木柜台的室内房间。',expected:'contradicted'}
];
// Expected control outcomes never enter the reviewers' requests.
const controlResults:any[]=[];
for(const c of controls){
 const result=await evaluate(c.id,[{id:'c0',camera:'front',text:c.text}],imagesFor([c.source]),{source:c.source},'',false);
 const matches=result.reviews.map(r=>r.review?claimVerdict(r.review,'c0')===c.expected:false);
 controlResults.push({...result,expected:c.expected,matches});await appendFile(join(out,'controls.jsonl'),JSON.stringify(controlResults.at(-1))+'\n');
 console.log(JSON.stringify({stage:'calibration',id:c.id,matches,errors:result.reviews.map(r=>r.error)}));
 if(result.reviews.every(r=>r.error&&/HTTP|fetch failed|Missing OPENROUTER/.test(r.error))){await writeFile(join(out,'blocked.json'),JSON.stringify({reason:'Independent review providers unavailable; no silent weak-model fallback'}));throw Error('Independent review providers unavailable');}
}
const controlByModel=[0,1].map(i=>({model:i?models.secondary:models.primary,correct:controlResults.filter(c=>c.matches[i]).length,total:controls.length,falsePositive:controlResults.filter(c=>c.expected==='supported'&&c.reviews[i].review&&claimVerdict(c.reviews[i].review,'c0')==='contradicted').length}));
const calibrationPassed=controlByModel.every(m=>m.correct===m.total&&m.falsePositive===0);
await writeFile(join(out,'calibration.json'),JSON.stringify({passed:calibrationPassed,models:controlByModel,authority:'Six simple hand-checked visual controls only, not a guarantee'},null,2));
if(!calibrationPassed){await writeFile(join(out,'blocked.json'),JSON.stringify({reason:'Calibration controls failed; full review not started',controlByModel}));throw Error('Judge calibration failed; inspect frozen controls before trusting scores');}
const results:any[]=[];
await writeFile(join(out,'observations.jsonl'),'');
for(const outcome of observations){
 if(!outcome.checkpoint){results.push({id:outcome.id,status:'generation-failed',reviewComplete:false,ratings:null,findings:[]});continue;}
 const result=await evaluate(outcome.id,observationClaims(outcome.checkpoint.update),imagesFor([outcome.id]),{current:{id:outcome.id,atMs:outcome.checkpoint.atMs}});
 results.push(result);await appendFile(join(out,'observations.jsonl'),JSON.stringify(result)+'\n');console.log(JSON.stringify({stage:'ensemble',id:result.id,reviewComplete:result.reviewComplete,disputes:result.disputes.length,confirmed:result.findings.filter(f=>f.status.startsWith('confirmed')).length}));
}
const spec=await loadJSON(plan.reviewSpecPath),sources=observations.filter(o=>o.checkpoint).map(o=>({id:o.id,memoryRef:o.checkpoint.memoryRef,atMs:o.checkpoint.atMs})),associations:any[]=[];
for(const a of spec.associations){
 const outcome=observations.find(o=>o.id===a.currentId);if(!outcome?.checkpoint)continue;
 const context=await loadJSON(outcome.checkpoint.contextPath),interpretations=context.interpretations??[];
 const claims:Claim[]=interpretations.map((p:any,i:number)=>({id:`p${i}`,camera:'unspecified',text:p.text}));
 if(!claims.length){associations.push({id:a.id,status:'no-interpretation',findings:[],reviewComplete:false});continue;}
 const ids=[...new Set<string>([a.currentId,...a.referenceIds,...interpretations.flatMap((p:any)=>p.evidenceRefs.map((ref:string)=>{const source=sources.find(s=>s.memoryRef===ref);if(!source||source.atMs>outcome.checkpoint.atMs)throw Error('Noncausal association source');return source.id;}))])];
 const result=await evaluate(a.id,claims,imagesFor(ids),{interpretations,sourceIndex:sources.filter(s=>ids.includes(s.id))},'这是空间关联模式。依据带sourceId的当前/历史原图核查候选关系。共享普通装修不认证同楼或连通，连续近邻独特布局可支持局部同场景。ratings.grounding表示关系证据支持，temporal表示置信度校准；coverage和direction设4但不计入关联报告。无法通过这些图片核实的路径/身份属于unverifiable，不必判定为相反关系。');
 associations.push(result);await appendFile(join(out,'associations.jsonl'),JSON.stringify(result)+'\n');
}
const confirmed=results.flatMap(r=>r.findings.filter((f:any)=>f.status.startsWith('confirmed')).map((f:any)=>({observationId:r.id,...f})));
const disputed=results.flatMap(r=>r.findings.filter((f:any)=>f.status==='disputed'||f.status==='unverifiable').map((f:any)=>({observationId:r.id,...f})));
const scores=Object.fromEntries(['grounding','coverage','direction','temporal'].map(key=>{const values=results.map(r=>r.ratings?.[key]?.score).filter((n:any)=>typeof n==='number') as number[];return [key,{score:values.length?25*values.reduce((s,n)=>s+n,0)/values.length:null,reviewed:values.length,planned:observations.length,unreviewed:observations.length-values.length,unit:'ordinal-ensemble-review-not-accuracy'}];}));
const report={schema:'spatial-ensemble-report-v1',models,reviewerIndependence:transport==='qwen'?'Same-version Qwen Max multi-pass review; correlated errors remain possible, not a cross-family consensus':'Different model family first rounds',calibration:{passed:calibrationPassed,models:controlByModel},scope:{observations:observations.length,originalInferenceUnchanged:true,longTermRecallTested:false},scores,
 reliability:{completeDualReviews:results.filter(r=>r.reviewComplete).length,adjudicatedCases:results.filter(r=>r.arbiter).length,confirmedClaims:confirmed.length,disputedOrUnverifiableClaims:disputed.length},
 confirmedLosses:confirmed,disputedOrUnverifiable:disputed,associationReviews:associations,
 untested:['Long-distance revisit after a long intervening experience','Full813-observation continuity and compression/recovery stability','Global map, geometric localization, path connectivity and navigation safety','Real question-agent quality against this spatial state; original15/37 gates unchanged','Representative held-out human-labeled evaluator sensitivity/specificity'],
 gate:{productionCertified:false,reason:'Multi-model review and six controls improve confidence but do not establish human-ground-truth reliability'},usage:await loadJSON(join(out,'requests/usage.json'))};
await writeFile(join(out,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
await writeFile(join(out,'report.md'),[transport==='qwen'?'# Same-version Qwen Max multi-pass review':'# Cross-model spatial review',`Blind first passes: ${models.primary}, ${models.secondary}; disputes: ${models.arbiter}.`,report.reviewerIndependence,`Controls: ${calibrationPassed?'passed':'failed'} (six simple controls only).`,'','| Dimension | Score | Reviewed / planned |','|---|---:|---:|',...Object.entries(scores).map(([k,v])=>`| ${k} | ${v.score?.toFixed(1)??'unknown'} | ${v.reviewed}/${v.planned} |`),'',`Confirmed claim findings: ${confirmed.length}; disputed/unverifiable: ${disputed.length}.`,`No production pass. No long-term recall conclusion. See report.json for original claim IDs and located evidence.`].join('\n'));
console.log(JSON.stringify({stage:'complete',out,scores,reliability:report.reliability}));
