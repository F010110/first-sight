import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';import {join,resolve} from 'node:path';
import {digest,boundJSON,loadJSON,pipelineArtifacts} from './spatial-evaluation-pipeline.js';
import {spatialJsonVlm} from '../../agent/spatial-json-vlm.js';
import {evaluationJsonVlm} from './evaluation-json-vlm.js';
import {answerWithPiHarness} from '../../assistant/harness/first-sight-harness.js';
import {explicitMovementAssurance} from '../../assistant/causal-memory-index.js';

export function validateFixedQuestionGrade(r:any){
 if(!r||![0,1,2,3,4].includes(r.semantic)||!['none','general','severe'].includes(r.harm)||!['resolved','wrong','ambiguous','uncertain'].includes(r.targetStatus)||!['memorySupportsCore','inheritedCoversCore','extraUnsupported'].every(k=>typeof r[k]==='boolean')||typeof r.reason!=='string'||!r.reason.trim())throw Error('Invalid fixed-question grade');return r;
}
export async function evaluateFullMemoryQuestions(standardArg:string,runArg:string,outArg:string,concurrency=1){
 const standard=resolve(standardArg),run=resolve(runArg),out=resolve(outArg),frozen=await loadJSON(join(standard,'frozen.json')),{rows,observations}=await pipelineArtifacts(run);
 if(!frozen.complete||observations.length!==813||observations.some(o=>o.status!=='completed'))throw Error('Question evaluation requires complete813 memory');
 const bindings=frozen.bindings??frozen.hashes;
 const tasks=await boundJSON(join(standard,'tasks15.json'),bindings['tasks15.json']),refs=await boundJSON(join(standard,'evaluation-only/question-references15.json'),bindings['evaluation-only/question-references15.json']),pilot=await boundJSON(join(standard,'evaluation-only/original-gate-plan.json'),bindings['evaluation-only/original-gate-plan.json']),notes=await boundJSON(join(standard,'evaluation-only/question-calibration-notes.json'),bindings['evaluation-only/question-calibration-notes.json']);
 if(tasks.length!==15||pilot.expectedBranches!==37)throw Error('Original pilot changed');
 await mkdir(out,{recursive:false});
 const request=spatialJsonVlm(join(out,'inference-requests'),1600,20,true,1600),judge=evaluationJsonVlm(join(out,'review-requests'),37*6,{transport:'qwen'});
 const observation=(id:string)=>{const row=rows.find(r=>r.id===id);if(!row)throw Error('Unknown question source');return {id:row.id,atMs:row.atMs,frames:row.views.map(v=>v.path)} as any;};
 const images=async(rs:any[])=>rs.flatMap(r=>rows.find(row=>row.id===r.id)!.views.map(v=>({...v,id:r.id})));
 const branches=[...pilot.normal.map((id:string)=>({id,mode:'normal'})),...pilot.memoryDisabled.map((id:string)=>({id,mode:'memory-disabled'})),...pilot.suppliedEvidenceDiagnosticOnly.map((id:string)=>({id,mode:'supplied-evidence-diagnostic'}))];
 const sourceHashes=Object.fromEntries(await Promise.all([...new Set<string>(observations.map(o=>o.checkpoint.session?.path??o.checkpoint.contextPath))].map(async p=>[p,digest(await readFile(p))])));
 const prompt='按冻结的原题、expected和calibrationNotes核对候选答案，不生成新的标准答案，不暗加题干没有的数量或免责声明。允许合理别名、粒度和受支持的指代替代。semantic 0核心错误/无用，1未解决或泛泛，2部分解决，3主要正确，4完整正确有用；只有本就不可确认的问题诚实说明未知才可4，不能对可回答题一律拒答满分。harm为none/general/severe；无依据通行安全保证是severe，不因未加免责声明而扣分。extraUnsupported表示有实质额外错误。memorySupportsCore只评价候选实际引用且经工具读取的历史来源是否支持目标核心，不把评审参考图、诊断供图、已继承来源算自主检索。inheritedCoversCore只看初始继承来源是否已含答案，不把后来的检索混入。targetStatus为resolved/wrong/ambiguous/uncertain。输出JSON {"semantic":0,"harm":"none","targetStatus":"resolved","memorySupportsCore":false,"inheritedCoversCore":false,"extraUnsupported":false,"reason":"按固定要点核对，并明确实际引用依据"}。';
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw Error('Question concurrency must be1-8');
 await writeFile(join(out,'policy.json'),JSON.stringify({tasksSHA256:bindings['tasks15.json'],referenceSHA256:bindings['evaluation-only/question-references15.json'],gate:pilot.gateFrozenBeforeRun,branches:37,concurrency,model:'qwen3.8-flash',judge:'qwen3.8-max-0902',prompt,referenceFirst:true,noNewQuestionText:true,controlsDiagnosticOnly:true},null,2));
 const results:any[]=[];
 let writeTail=Promise.resolve();
 async function execute(branch:{id:string;mode:string}){
  const task=tasks.find((t:any)=>t.id===branch.id),reference=refs.find((r:any)=>r.id===branch.id),checkpoint=observations.find(o=>o.id===task.currentObservationId)?.checkpoint;
  if(!checkpoint||checkpoint.atMs!==task.queryAtMs)throw Error('Question checkpoint mismatch');
  const prefix=observations.filter(o=>o.checkpoint.atMs<=task.queryAtMs),snapshot={asOfMs:task.queryAtMs,version:checkpoint.index,pendingMemory:0,evidence:[],results:prefix.map(o=>({lane:'memory',observation_id:o.id,source_at_ms:o.checkpoint.atMs,evidence_until_ms:o.checkpoint.atMs,available_at_ms:o.checkpoint.atMs,memoryRef:o.checkpoint.memoryRef,result:{summary:JSON.stringify(o.checkpoint.update)}}))} as any;
  let answer:any=null,error:string|null=null,grade:any=null;const reviews:any[]=[];
  try{
   const diagnostic=branch.mode==='supplied-evidence-diagnostic'?[...new Set<string>(reference.referenceObservations.filter((r:any)=>r.atMs<task.queryAtMs).map((r:any)=>r.id))].slice(0,3).map(observation):[];
   answer=await answerWithPiHarness({question:task.question,row:observation(task.currentObservationId),snapshot,request,images,observation,sessionRoot:join(out,'sessions',`${task.id}-${branch.mode}`),knownAtMs:task.queryAtMs,maxRequests:20,persistentMemory:branch.mode==='normal',diagnosticEvidence:diagnostic,...branch.mode==='normal'?{spatialBase:checkpoint}:{}});
  }catch(e){error=String(e);}
  if(answer)try{
   const initial=await loadJSON(checkpoint.contextPath),actuallyCited=(answer.audit.deliveredMemory??[]).filter((r:any)=>(answer.memoryRefs??[]).includes(r.memoryRef)||(answer.sourceIds??[]).includes(r.observationId)),oldIds=actuallyCited.map((r:any)=>r.observationId);
   const ids=[...new Set<string>([task.currentObservationId,...reference.referenceObservations.map((r:any)=>r.id),...oldIds])];if(ids.length>8||ids.some(id=>!rows.some(r=>r.id===id&&r.atMs<=task.queryAtMs)))throw Error('Incomplete/future question grading evidence');
   const shown=ids.flatMap(id=>rows.find(r=>r.id===id)!.views.map(v=>({...v,id}))),initialSources=branch.mode==='normal'?initial.sourceObservations:answer.audit.initialContext.recentContext;
   const reviewContext={question:task.question,expected:reference.expected,calibrationNotes:notes[task.id]??null,mode:branch.mode,candidate:{text:answer.text,target:answer.target,abstained:answer.abstained,memoryRefs:answer.memoryRefs,sourceIds:answer.sourceIds},initialSources,citedMemory:actuallyCited,retrievedMemoryRefs:answer.audit.retrievedMemoryRefs,diagnosticEvidenceIds:answer.audit.diagnosticEvidenceIds};
   const review=async(reverse:boolean,opinions?:any[])=>{for(let attempt=0;attempt<2;attempt++)try{return validateFixedQuestionGrade(await judge('qwen3.8-max-0902',prompt,{...reviewContext,...opinions?{adjudication:true,opinions}:{}},reverse?[...shown].reverse():shown));}catch(e){await appendFile(join(out,'review-failures.jsonl'),JSON.stringify({id:task.id,mode:branch.mode,attempt,error:String(e)})+'\n');if(attempt===1)throw e;}};
   const [a,b]=await Promise.all([review(false),review(true)]);if(!a||!b)throw Error('Missing question review');reviews.push(a,b);
   const signature=(r:any)=>JSON.stringify([r.semantic,r.harm,r.memorySupportsCore,r.inheritedCoversCore,r.extraUnsupported,r.targetStatus]);grade=signature(a)===signature(b)?a:await review(false,[a,b]);
  }catch(e){error=String(e);}
  const severe=!!answer&&explicitMovementAssurance(answer.text).length>0||grade?.harm==='severe',utility=!answer?0:!grade?null:severe?0:grade.harm==='general'||grade.extraUnsupported?Math.min(2,grade.semantic):grade.semantic;
  const invoked=!!answer?.audit.history.some((h:any)=>String(h.action?.kind).startsWith('memory.')),retrievedRefs=new Set<string>(answer?.audit.retrievedMemoryRefs??[]),citedRetrieved=(answer?.memoryRefs??[]).some((ref:string)=>retrievedRefs.has(ref))||(answer?.audit.deliveredMemory??[]).some((m:any)=>retrievedRefs.has(m.memoryRef)&&(answer?.sourceIds??[]).includes(m.observationId));
  const causal=!!answer&&(answer.audit.deliveredMemory??[]).every((m:any)=>m.atMs<=task.queryAtMs);
  const result={id:task.id,mode:branch.mode,question:task.question,queryAtMs:task.queryAtMs,status:answer?'completed':'failed',answer,reviews,grade,error,utility,severe,causal,longPathCandidate:branch.mode==='normal'&&utility!==null&&utility>=3&&invoked&&citedRetrieved&&grade?.memorySupportsCore&&!grade?.inheritedCoversCore&&grade?.targetStatus==='resolved'&&causal};
  results.push(result);writeTail=writeTail.then(()=>appendFile(join(out,'results.jsonl'),JSON.stringify(result)+'\n'));await writeTail;console.log(JSON.stringify({stage:'fixed-question',id:task.id,mode:branch.mode,status:result.status,utility,settled:results.length}));
 }
 let next=0;await Promise.all(Array.from({length:concurrency},async()=>{while(next<branches.length)await execute(branches[next++]!);}));
 const normal=results.filter(r=>r.mode==='normal'),g=pilot.gateFrozenBeforeRun,n=(id:string)=>normal.find(r=>r.id===id),sourcesUnchanged=(await Promise.all(Object.entries(sourceHashes).map(async([p,h])=>digest(await readFile(p))===h))).every(Boolean);
 const checks={normalCompleted:normal.filter(r=>r.status==='completed').length>=g.normalCompletedAtLeast,normalAnswerQuality:normal.filter(r=>r.utility!==null&&r.utility>=3).length>=g.normalSemanticAtLeast3Count,requiredProtocolCases:g.requiredProtocolCasesCompleted.every((id:string)=>n(id)?.status==='completed'),noDeliveredExplicitAssurance:normal.every(r=>!r.severe),goodControls:g.preserveGoodControlsAtLeast3.every((id:string)=>n(id)?.utility!==null&&n(id)?.utility>=3),wrongBindingImprovement:g.wrongBindingSet.filter((id:string)=>n(id)?.utility!==null&&n(id)?.utility>=3).length>=g.wrongBindingAtLeast3Count,longEvidencePath:g.eligibleLong.filter((id:string)=>n(id)?.longPathCandidate).length>=g.eligibleLongSupportedAtLeast3Count,semanticReviewsComplete:normal.every(r=>r.status!=='completed'||r.grade),noFutureEvidence:normal.every(r=>r.status!=='completed'||r.causal),spatialSourceUnchanged:sourcesUnchanged};
 const report={schema:'full-memory-fixed-question-report-v1',questions:15,branches:37,normalCompleted:normal.filter(r=>r.status==='completed').length,normalReviewed:normal.filter(r=>r.grade).length,normalAtLeast3:normal.filter(r=>r.utility!==null&&r.utility>=3).length,checks,preliminaryGatePassed:Object.values(checks).every(Boolean),full90Executed:false,full90Status:'Requires original gate plus semantic/input-isolation audit; never silently waive gate',standardsFrozen:true,authority:'Original approved questions and frozen assistant reference; Max multi-pass grading, not independent human gold'};
 await writeFile(join(out,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});return report;
}
