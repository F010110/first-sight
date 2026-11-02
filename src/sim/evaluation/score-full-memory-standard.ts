import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';import {join,resolve} from 'node:path';
import {digest,boundJSON,pipelineArtifacts,loadJSON} from './spatial-evaluation-pipeline.js';
import {evaluationJsonVlm} from './evaluation-json-vlm.js';
import {validateReferenceScore,referenceCoverage,type FrameReference} from './frozen-memory-reference.js';
export async function scoreFullMemoryStandard(standardArg:string,runArg:string,outArg:string){
 const standard=resolve(standardArg),run=resolve(runArg),out=resolve(outArg),manifest=await loadJSON(join(standard,'frozen.json')),{plan,rows,observations}=await pipelineArtifacts(run);
 if(!manifest.complete||manifest.inputSHA256!==plan.inputSHA256||observations.length!==813||!plan.requireContiguous)throw Error('Require full contiguous run and complete pre-frozen standard');
 const frozen=await boundJSON(join(standard,'evaluation-only/spatial-facts.json'),manifest.bindings['evaluation-only/spatial-facts.json']);
 const refs=frozen.frames as FrameReference[];if(refs.length!==813||refs.some((r,i)=>r.id!==observations[i].id))throw Error('Reference frame coverage changed');
 await mkdir(out,{recursive:false});const request=evaluationJsonVlm(join(out,'requests'),813*6,{transport:'qwen'}),model='qwen3.8-max-0902';
 const prompt='你只按已冻结的reference评分，不能重新发明或增补标准答案。reference.facts是逐方向图像已核验的固定事实，unknowns明确不可认证。对每个factId判断候选覆盖full/partial/missing；合理同义词和命名允许。原图仅供核对，不让你每轮重建答案。若标准本身明显有误或不足，将对应项标reference-disputed并说明，不能偷偷改标准或判候选错。额外候选细节未被标准涵盖，不等于错误，只能not-in-reference；contradiction必须指出实际referenceFactId及候选逐字quote，且与该固定事实直接矛盾。摄像头方向与图内左右分开。输出JSON {"matches":[{"factId":"f0","coverage":"full或partial或missing或reference-disputed","reason":"依据"}],"errors":[{"kind":"contradiction或not-in-reference","referenceFactId":"f0或null","quote":"候选实际子串","reason":"与标准关系"}],"reason":"说明"}。';
 await writeFile(join(out,'policy.json'),JSON.stringify({schema:'frozen-reference-spatial-score-v1',referenceSHA256:manifest.bindings['evaluation-only/spatial-facts.json'],predictionsSHA256:digest(await readFile(join(run,'observations.jsonl'))),model,prompt,passes:2,adjudicateDisagreement:true,notInReferenceIsNotError:true,noTargetRegeneration:true},null,2));
 const scores:any[]=[];
 for(const [index,outcome] of observations.entries()){
  const reference=refs[index]!,row=rows.find(r=>r.id===outcome.id)!,images=row.views.map(v=>({...v,id:row.id}));let result:any={id:row.id,status:outcome.status,referenceFacts:reference.facts.length,reviews:[],final:null,error:null};
  if(outcome.checkpoint){
   const candidate=outcome.checkpoint.update,text=[candidate.summary,...candidate.observations].join('\n');
   const judge=async(reverse:boolean,context:unknown)=>{for(let attempt=0;attempt<2;attempt++)try{const raw=await request(model,prompt,{reference:reverse?{...reference,facts:[...reference.facts].reverse()}:reference,candidate,context},reverse?[...images].reverse():images),r=validateReferenceScore(raw,reference);if(r.errors.some(e=>!text.includes(e.quote)))throw Error('Invented candidate quote');return r;}catch(e){await appendFile(join(out,'failures.jsonl'),JSON.stringify({id:row.id,attempt,error:String(e)})+'\n');if(attempt===1)throw e;}};
   try{
    const [a,b]=await Promise.all([judge(false,{pass:1}),judge(true,{pass:2})]);if(!a||!b)throw Error('Missing dual score');result.reviews=[a,b];
    const signature=(r:typeof a)=>JSON.stringify(reference.facts.map(f=>r.matches.find(m=>m.factId===f.id)!.coverage))+JSON.stringify(r.errors.filter(e=>e.kind==='contradiction').map(e=>[e.referenceFactId,e.quote]).sort());
    result.final=signature(a)===signature(b)?a:await judge(false,{adjudication:true,opinions:[a,b],rule:'以固定标准和原图核对，不按票数决定'});
   }catch(e){result.error=String(e);}
  }
  result.coverage=referenceCoverage(reference,result.final);scores.push(result);await appendFile(join(out,'grades.jsonl'),JSON.stringify(result)+'\n');await writeFile(join(out,'progress.json'),JSON.stringify({settled:scores.length,planned:813,scored:scores.filter(s=>s.final).length}));console.log(JSON.stringify({stage:'fixed-spatial-score',id:row.id,settled:scores.length,scored:!!result.final}));
 }
 const reviewed=scores.filter(s=>s.final&&s.coverage.earned!==null),earned=reviewed.reduce((n,s)=>n+s.coverage.earned,0),possible=reviewed.reduce((n,s)=>n+s.coverage.possible,0);
 const structure=await boundJSON(join(standard,'evaluation-only/spatial-structure.json'),manifest.bindings['evaluation-only/spatial-structure.json']),relations:any[]=[];
 const relationPrompt='按已冻结的同区域重访reference核查实际interpretations，不重新生成标准关系。合理区域命名/视角差异允许，但只说与近期几秒相同不能算找回旧访问。relationSupported只评价实际提出关系是否有证据；oldVisitMatch要求实际引用旧访问内来源并有相符布局证据，不能靠普通装修；overclaim指无依据扩展精确位置、连通、安全或同楼。没有相关解释则oldVisitMatch false，不替候选补结论。输出JSON {"relationSupported":false,"oldVisitMatch":false,"overclaim":false,"reason":"固定参照与实际来源对比"}。';
 for(const reference of structure.revisits){
  const firstIndex=rows.findIndex(r=>r.id===reference.firstId),returnIndex=rows.findIndex(r=>r.id===reference.returnId),segment=structure.segments.find((s:any)=>s.startIndex<=firstIndex&&s.endIndex>=firstIndex);
  const probeId=plan.probeIds.find(id=>{const i=rows.findIndex(r=>r.id===id);return i>=returnIndex&&i<=returnIndex+16&&structure.frames[i]?.region===structure.frames[returnIndex]?.region;});
  let result:any={id:reference.id,firstId:reference.firstId,returnId:reference.returnId,probeId:probeId??null,gapMs:rows[returnIndex]!.atMs-rows[firstIndex]!.atMs,oldVisitCited:false,grade:null,error:null};
  try{
   if(!probeId||!segment)throw Error('No fixed-cadence probe in the accepted return region; not silently inserting a target-aware task');
   const outcome=observations.find(o=>o.id===probeId),context=await loadJSON(outcome.checkpoint.contextPath),interpretations=context.interpretations??[];
   const citedIds=[...new Set<string>(interpretations.flatMap((p:any)=>p.evidenceRefs.map((ref:string)=>{const o=observations.find(o=>o.checkpoint?.memoryRef===ref);if(!o||o.checkpoint.atMs>outcome.checkpoint.atMs)throw Error('Noncausal relation citation');return o.id;})))];
   result.oldVisitCited=citedIds.some(id=>{const i=rows.findIndex(r=>r.id===id);return i>=segment.startIndex&&i<=segment.endIndex;});
   const ids=[...new Set<string>([probeId,reference.firstId,...citedIds])];if(ids.length>8)throw Error('Relation review exceeds24 originals; retain unreviewed');
   const images=ids.flatMap(id=>rows.find(r=>r.id===id)!.views.map(v=>({...v,id})));
   const review=async(reverse:boolean,opinions?:any[])=>{for(let attempt=0;attempt<2;attempt++)try{const r=await request(model,relationPrompt,{reference,oldVisitSourceIds:rows.slice(segment.startIndex,segment.endIndex+1).map(r=>r.id),interpretations,citedSourceIndex:observations.filter(o=>citedIds.includes(o.id)).map(o=>({memoryRef:o.checkpoint.memoryRef,id:o.id})),oldVisitCited:result.oldVisitCited,...opinions?{adjudication:true,opinions}:{}},reverse?[...images].reverse():images);if(!r||!['relationSupported','oldVisitMatch','overclaim'].every(k=>typeof r[k]==='boolean')||typeof r.reason!=='string'||r.oldVisitMatch&&!result.oldVisitCited)throw Error('Invalid relation verdict or invented old-visit evidence');return r;}catch(e){if(attempt===1)throw e;}};
   const [a,b]=await Promise.all([review(false),review(true)]);result.reviews=[a,b];const key=(r:any)=>JSON.stringify([r.relationSupported,r.oldVisitMatch,r.overclaim]);result.grade=key(a)===key(b)?a:await review(false,[a,b]);
  }catch(e){result.error=String(e);}
  relations.push(result);await appendFile(join(out,'relations.jsonl'),JSON.stringify(result)+'\n');
 }
 const summary={schema:'full-fixed-spatial-report-v1',planned:813,generated:observations.filter(o=>o.status==='completed').length,reviewed:scores.filter(s=>s.final).length,unscorableOrUnreviewed:813-reviewed.length,coreFactCoverage:{score:possible?100*earned/possible:null,earned,possible,plannedReferenceFacts:refs.reduce((n,r)=>n+r.facts.filter(f=>f.importance==='core').length,0)},confirmedReferenceContradictions:scores.reduce((n,s)=>n+(s.final?.errors.filter((e:any)=>e.kind==='contradiction').length??0),0),extraClaimsNotCertified:scores.reduce((n,s)=>n+(s.final?.errors.filter((e:any)=>e.kind==='not-in-reference').length??0),0),referenceDisputes:scores.filter(s=>s.final?.matches.some((m:any)=>m.coverage==='reference-disputed')).map(s=>s.id),relations:{planned:relations.length,reviewed:relations.filter(r=>r.grade).length,oldVisitMatched:relations.filter(r=>r.grade?.oldVisitMatch).length,longGapThresholdMs:180000,longPlanned:relations.filter(r=>r.gapMs>=180000).length,longMatched:relations.filter(r=>r.gapMs>=180000&&r.grade?.oldVisitMatch).length,cases:relations},complete:scores.every(s=>s.status==='completed'&&s.final&&s.coverage.earned!==null)&&relations.every(r=>r.grade),authority:manifest.referenceAuthority,scope:'Fixed-reference content and three accepted revisit cases on a full continuous run; not a global-map/navigation certificate'};
 await writeFile(join(out,'report.json'),JSON.stringify(summary,null,2),{flag:'wx'});return summary;
}
