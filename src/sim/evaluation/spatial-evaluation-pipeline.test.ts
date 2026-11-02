import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {digest,runSpatialPipeline,scoreSpatialPipeline,pipelineArtifacts,sequenceLayout,pipelineSources} from './spatial-evaluation-pipeline.js';
import {runPipelineQuestions} from './spatial-pipeline-questions.js';

test('continuous sampling checks original row adjacency rather than just timestamps',()=>{
 assert.equal(sequenceLayout(['a','b','c','d'],['b','c','d']).contiguous,true);
 assert.equal(sequenceLayout(['a','b','c','d'],['a','c','d']).segmentCount,2);
 assert.throws(()=>sequenceLayout(['a','b'],['b','a']));
});

test('pipeline isolates private rubric, retains failed revisits, binds artifacts and blocks questions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/spatial-pipeline-')),key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';
 try{
  const image=join(root,'original.png');await writeFile(image,'frozen-original');
  const rows=Array.from({length:6},(_,i)=>({id:`o${i}`,atMs:i,views:['front','left','right'].map(direction=>({id:`o${i}`,direction,path:image,sha256:digest('frozen-original')}))}));
  const input=JSON.stringify({observations:rows}),spec=JSON.stringify({schema:'spatial-review-spec-v1',split:'development',associations:[{id:'positive',currentId:'o5',referenceIds:['o0'],positiveTargetId:'o0',expectation:'PRIVATE_SENTINEL'},{id:'unknown',currentId:'o5',referenceIds:['o1'],positiveTargetId:null,expectation:'PRIVATE_SENTINEL'}]});
  const inputPath=join(root,'input.json'),specPath=join(root,'private.json');await writeFile(inputPath,input);await writeFile(specPath,spec);
  const tasks=JSON.stringify([{id:'q1',question:'原有问题一',currentObservationId:'o4',queryAtMs:4},{id:'q2',question:'原有问题二',currentObservationId:'o5',queryAtMs:5}]),refs=JSON.stringify([{id:'q1',expected:'PRIVATE_SENTINEL',referenceObservations:[]},{id:'q2',expected:'PRIVATE_SENTINEL',referenceObservations:[]}]);
  const tasksPath=join(root,'tasks.json'),referencesPath=join(root,'references.json');await writeFile(tasksPath,tasks);await writeFile(referencesPath,refs);
  const plan={schema:'spatial-evaluation-plan-v1',mode:'fresh-sequence',inputPath,inputSHA256:digest(input),observationIds:rows.map(r=>r.id),probeIds:['o5'],reviewSpecPath:specPath,reviewSpecSHA256:digest(spec),maxInferenceCalls:40,maxReviewCalls:12,questions:{tasksPath,tasksSHA256:digest(tasks),referencesPath,referencesSHA256:digest(refs),taskIds:['q1','q2']}};
  const planPath=join(root,'plan.json');await writeFile(planPath,JSON.stringify(plan));const out=join(root,'run');
  await assert.rejects(()=>pipelineSources({...plan,requireContiguous:true,observationIds:['o0','o2'],probeIds:[]} as any),/cannot skip/);
  await runSpatialPipeline(planPath,out,async request=>{
   assert.ok(!JSON.stringify(request).includes('PRIVATE_SENTINEL'));
   if(request.phase==='perception')return {output:{summary:'可见桌子',observations:['可见桌子']},usage:{prompt_tokens:1,completion_tokens:1}};
   const data=request.data as any,state=data.runtimeContext.evidenceState;
   if(data.current.id==='o5'&&!state.recalledSources.length)return {output:{tool:'memory_read',arguments:{afterMs:0,beforeMs:0}},usage:{prompt_tokens:1,completion_tokens:1}};
   if(data.current.id==='o5'&&!state.currentInterpretations.length)return {output:{tool:'propose_interpretation',arguments:{text:'可见桌子与旧来源相符',evidenceRefs:['memory-v1']}},usage:{prompt_tokens:1,completion_tokens:1}};
   return {output:{tool:'record_context',arguments:{}},usage:{prompt_tokens:1,completion_tokens:1}};
  });
  const score=await scoreSpatialPipeline(out,async request=>{
   const d=request.data as any;
   return d.evaluationOnly?{support:4,calibration:4,revisitFound:d.evaluationOnly.positiveTargetId?false:null,unsupportedIdentity:false,reason:'没有提出关联'}:{grounding:4,coverage:4,direction:4,temporal:4,issues:[],reason:'原图支持'};
  });
  assert.equal(score.spatial.dimensions.grounding.score,100);assert.equal(score.spatial.dimensions.positiveRevisitRecall.score,0);assert.equal(score.questions.status,'blocked-by-spatial-gate');
  await assert.rejects(()=>runPipelineQuestions(out),/blocked/);
  const passing=await scoreSpatialPipeline(out,async request=>{
   const d=request.data as any;
   return d.evaluationOnly?{support:4,calibration:4,revisitFound:d.evaluationOnly.positiveTargetId?true:null,unsupportedIdentity:false,reason:'有对应来源'}:{grounding:4,coverage:4,direction:4,temporal:4,issues:[],reason:'原图支持'};
  },'v2');
  assert.equal(passing.spatial.gate.passed,true);
  let answers=0;
  const questions=await runPipelineQuestions(out,'v2',{answer:async input=>{
   answers++;assert.equal(input.question,answers===1?'原有问题一':'原有问题二');assert.equal(input.questionSession,undefined);
   assert.ok(input.snapshot.results.every(r=>r.source_at_ms<=input.row.atMs));assert.ok(!JSON.stringify(input.snapshot).includes('PRIVATE_SENTINEL'));
   return {text:'可见桌子',sourceIds:[input.row.id],memoryRefs:[],contextRefs:[],abstained:false,audit:{deliveredMemory:[],initialContext:{inheritedReferenceIndex:[]}}} as any;
  },review:async input=>{assert.ok(JSON.stringify(input.data).includes('PRIVATE_SENTINEL'));return {semantic:4,harm:'none',expression:2,recentContextCoversCore:false,initialContextLeaksCore:false,retrievedEvidenceSupportsCore:false,reason:'独立评审'};}});
  assert.equal(questions.questions.dimensions.utility.score,100);assert.equal(answers,2);
  let unexpectedReviews=0;
  const reused=await scoreSpatialPipeline(out,async()=>{unexpectedReviews++;throw Error('Valid bound reviews must not be regenerated');},'v3','v2');
  assert.equal(unexpectedReviews,0);assert.equal(reused.spatial.gate.passed,true);
  await writeFile(join(out,'observations.jsonl'),(await readFile(join(out,'observations.jsonl'),'utf8')).replace('可见桌子','tampered'));
  await assert.rejects(()=>pipelineArtifacts(out),/changed/);
 }finally{if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(root,{recursive:true,force:true});}
});
