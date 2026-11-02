import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createSpatialSession} from './spatial-session.js';
import {answerWithPiHarness} from './first-sight-harness.js';
import type {ThreeAgentStore} from '../three-agent-store.js';
import {SpatialContextModule,composeSessionContext} from './layered-context.js';
const visualEvidence=()=>({output:{summary:'当前独立原图观察',observations:['独立当前观察']},usage:{prompt_tokens:100,completion_tokens:50}});

test('evidence-ledger session publishes sources separately and does not require generated state fields',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/pi-ledger-')),key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';let calls=0;
 const space=await createSpatialSession(root,async input=>{
  if(input.phase==='perception')return visualEvidence();
  calls++;const data=input.data as any;assert.ok(data.messages.length>=1);
  if(calls===2)assert.ok(data.messages.some((m:any)=>m.role==='toolResult'));
  if(calls===3)assert.ok(!JSON.stringify(data.messages).includes('有待核实的用途'));
  assert.ok(data.runtimeContext.evidenceState.currentObservation);
  return {output:calls===1?{tool:'propose_interpretation',arguments:{text:'有待核实的用途',evidenceRefs:['memory-v1']}}:{tool:'record_context',arguments:{}},usage:{prompt_tokens:100,completion_tokens:50}};
 },{diagnosticEvidenceLedger:true});
 try{
  const one=await space.observe({id:'o1',atMs:1,views:[{id:'o1',path:'mock',sha256:'mock',direction:'front'}]});
  assert.equal(one.update.summary,'当前独立原图观察');assert.deepEqual(one.update.hypotheses,[]);
  const published=JSON.parse(await readFile(one.contextPath,'utf8'));
  assert.equal(published.interpretations[0].kind,'model-interpretation-not-observation');
  assert.ok(!JSON.stringify(published.sourceObservations).includes('有待核实'));
  const two=await space.observe({id:'o2',atMs:2,views:[{id:'o2',path:'mock',sha256:'mock',direction:'front'}]});
  const next=JSON.parse(await readFile(two.contextPath,'utf8'));assert.deepEqual(next.interpretations,[]);
 }finally{await space.close();if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(root,{recursive:true,force:true});}
});

test('composed context refreshes its spatial module without copying it into private user history',()=>{
 const space=new SpatialContextModule(),privateMessages=[{role:'user' as const,content:'用户目标',timestamp:1}];
 space.publish({index:1,atMs:1} as any);const first=space.snapshot();space.publish({index:2,atMs:2} as any);
 assert.equal(first.index,1);assert.equal(space.snapshot().index,2);
 const combined=composeSessionContext([{role:'user',content:'新空间上下文',timestamp:2}],privateMessages);
 assert.equal(combined.length,2);assert.equal(privateMessages.length,1);assert.throws(()=>space.publish({index:1,atMs:1} as any));
});

test('failed spatial request resumes from last committed checkpoint without rewriting the old session',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/pi-resume-')),key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';
 const usage={prompt_tokens:100,completion_tokens:50},views=(id:string)=>[{id,path:'mock',sha256:'mock',direction:'front'}];
 const response=(id:string)=>({output:{tool:'record_context',arguments:{summary:'已记录'+id,observations:[],hypotheses:[],unresolved:[],sourceIds:[id]}},usage});
 let first:any,resumed:any;
 try{
  first=await createSpatialSession(root,async input=>{if(input.phase==='perception')return visualEvidence();const id=(input.data as any).current.id;if(id==='o2')throw Error('mock network failure');return response(id);});
  const one=await first.observe({id:'o1',atMs:1,views:views('o1')});
  await assert.rejects(first.observe({id:'o2',atMs:2,views:views('o2')}),/failed/);await first.close();
  const before=await readFile(one.session.path);
  resumed=await createSpatialSession(root,async input=>{if(input.phase==='perception')return visualEvidence();assert.ok(JSON.stringify(input.data).includes('已记录o1'));return response('o2');},{resume:true});
  const two=await resumed.observe({id:'o2',atMs:2,views:views('o2')});
  assert.equal(two.index,2);assert.notEqual(two.session.path,one.session.path);assert.deepEqual(await readFile(one.session.path),before);
 }finally{await resumed?.close();await first?.close();if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(root,{recursive:true,force:true});}
});

test('spatial summary failure preserves checkpoints and cannot fall back to an unaccounted/default prompt',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/pi-compact-fail-')),key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';let summaries=0;
 const space=await createSpatialSession(root,async input=>{
  if(input.phase==='perception')return visualEvidence();
  const data=input.data as any;
  if(data.role==='spatial-compaction'){summaries++;throw Error('mock truncated summary');}
  assert.ok(data.tools?.length,'No default summary provider request is allowed');
  return {output:{tool:'record_context',arguments:{summary:'原始观察',observations:[],hypotheses:[],unresolved:[],sourceIds:[data.current.id]}},usage:{prompt_tokens:100,completion_tokens:50}};
 });
 try{
  const checkpoint=await space.observe({id:'o1',atMs:1,views:[{id:'o1',path:'mock',sha256:'mock',direction:'front'}]});
  const before=await readFile(checkpoint.contextPath);
  await assert.rejects(space.compact(),/mock truncated summary/);
  assert.equal(summaries,1);assert.deepEqual(await readFile(checkpoint.contextPath),before);
  assert.ok((await readFile(join(root,'compaction-failures.jsonl'),'utf8')).includes('"fallbackSent":false'));
 }finally{await space.close();if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(root,{recursive:true,force:true});}
});

test('complete summaries slightly above the preferred size are accepted unchanged',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/pi-summary-size-')),key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';
 const summary='记'.repeat(1050),usage={prompt_tokens:100,completion_tokens:50};
 const space=await createSpatialSession(root,async input=>input.phase==='perception'?visualEvidence():(input.data as any).role==='spatial-compaction'?{output:{summary,memoryRefs:['memory-v1']},usage}:{output:{summary:'观察',observations:[],hypotheses:[],unresolved:[],sourceIds:['o1']},usage});
 try{
  const checkpoint=await space.observe({id:'o1',atMs:1,views:[{id:'o1',path:'mock',sha256:'mock',direction:'front'}]});
  assert.deepEqual(checkpoint.update.observations,['独立当前观察']);
  const result=await space.compact();assert.equal(result.compaction.status,'completed');
  const bytes=await readFile(checkpoint.session.path,'utf8');assert.ok(bytes.includes(summary));
 }finally{await space.close();if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(root,{recursive:true,force:true});}
});

test('spatial replay builds per-time contexts; layered question session cannot pollute space',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/pi-space-')),key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';
 const usage={prompt_tokens:100,completion_tokens:50};let calls=0;
 const space=await createSpatialSession(join(root,'space'),async input=>{
  if(input.phase==='perception'){assert.deepEqual(Object.keys(input.data as object),['current']);return visualEvidence();}
  calls++;const data=input.data as any;assert.ok(!JSON.stringify(data).includes('用户问题哨兵'));
  assert.ok(!JSON.stringify(data).includes('FUTURE_SENTINEL'));
  return {output:{tool:'record_context',arguments:{summary:calls===1?'角落里有蓝色小盒子':'FUTURE_SENTINEL',observations:['本轮观察'],hypotheses:[],unresolved:[],sourceIds:[data.current.id]}},usage};
 });
 try{
  const first=await space.observe({id:'o1',atMs:1000,views:[{id:'o1',path:'mock',sha256:'mock',direction:'front'}]});
  const second=await space.observe({id:'o2',atMs:2000,views:[{id:'o2',path:'mock',sha256:'mock',direction:'front'}]});
  const before=createHash('sha256').update(await readFile(first.session.path)).digest('hex');
  let asked=0;
  const answer=await answerWithPiHarness({question:'用户问题哨兵：刚才角落有什么?',row:{id:'o1',atMs:1000,frames:[]},snapshot:{asOfMs:1000,results:[{lane:'memory',observation_id:'o1',source_at_ms:1000,evidence_until_ms:1000,available_at_ms:1,memoryRef:'memory-v1',result:{summary:first.update.summary}}]} as unknown as ReturnType<ThreeAgentStore['snapshot']>,spatialBase:first,sessionRoot:join(root,'question'),images:async()=>[],observation:id=>({id,atMs:1000,frames:[]}),request:async input=>{
   asked++;const data=input.data as any;
   assert.ok(JSON.stringify(data.messages).includes('蓝色小盒子'));assert.ok(!JSON.stringify(data).includes('FUTURE_SENTINEL'));
   assert.equal(data.runtimeContext.data.contextMode,'layered-spatial-session');assert.deepEqual(data.runtimeContext.data.recentContext,[]);
   return {output:{tool:'finish',arguments:{text:'角落里有蓝色小盒子。',target:'刚才角落',memoryRefs:['memory-v1'],sourceIds:[],contextRefs:[],abstained:false}},usage};
  }});
  assert.equal(asked,1);assert.equal(answer.text,'角落里有蓝色小盒子。');
  assert.equal(createHash('sha256').update(await readFile(first.session.path)).digest('hex'),before);
  const question=await readFile(join(root,'question','transcript.json'),'utf8');assert.ok(question.includes('用户问题哨兵'));assert.ok(question.includes('角落里有蓝色小盒子。'));
  assert.ok(!question.includes('record_context')); // Spatial messages are composed, not copied into question storage.
  const live=new SpatialContextModule();live.publish(first);let turns=0;
  const snapshotAt=(checkpoint:any)=>({asOfMs:checkpoint.atMs,results:[first,second].filter(c=>c.index<=checkpoint.index).map(c=>({lane:'memory',observation_id:c.observationId,source_at_ms:c.atMs,evidence_until_ms:c.atMs,available_at_ms:c.atMs,memoryRef:c.memoryRef,result:{summary:c.update.summary}}))}) as unknown as ReturnType<ThreeAgentStore['snapshot']>;
  const liveAnswer=await answerWithPiHarness({question:'观察是否更新?',row:{id:'o1',atMs:1000,frames:[]},snapshot:snapshotAt(first),spatialBase:first,liveSpatialContext:{module:live,snapshotAt},sessionRoot:join(root,'live-question'),images:async()=>[],observation:id=>({id,atMs:id==='o1'?1000:2000,frames:[]}),request:async input=>{
   turns++;const data=input.data as any;
   if(turns===1){assert.ok(!JSON.stringify(data).includes('FUTURE_SENTINEL'));live.publish(second);return {output:{tool:'load_skill',arguments:{name:'memory-investigation'}},usage};}
   assert.ok(JSON.stringify(data.messages).includes('FUTURE_SENTINEL'));assert.equal(data.runtimeContext.data.current.id,'o2');assert.equal(data.runtimeContext.data.questionAtMs,1000);
   return {output:{tool:'finish',arguments:{text:'已更新。',target:'新观察',memoryRefs:['memory-v2'],sourceIds:[],contextRefs:[],abstained:false}},usage};
  }});
  assert.equal(liveAnswer.text,'已更新。');assert.equal(turns,2);
  await answerWithPiHarness({question:'第二个用户问题',row:{id:'o2',atMs:2000,frames:[]},snapshot:snapshotAt(second),spatialBase:second,questionSession:answer.audit.questionSession,sessionRoot:join(root,'continued-question'),images:async()=>[],observation:id=>({id,atMs:id==='o1'?1000:2000,frames:[]}),request:async input=>{
   const data=input.data as any;
   assert.ok(JSON.stringify(data.messages).includes('用户问题哨兵'));assert.ok(JSON.stringify(data.messages).includes('FUTURE_SENTINEL'));
   return {output:{tool:'finish',arguments:{text:'这是同一用户会话的下一次回答。',target:'新问题',memoryRefs:['memory-v2'],sourceIds:[],contextRefs:[],abstained:false}},usage};
  }});
  assert.equal(createHash('sha256').update(await readFile(first.session.path)).digest('hex'),before);
 }finally{await space.close();if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(root,{recursive:true,force:true});}
});
