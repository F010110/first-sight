import test from 'node:test';
import assert from 'node:assert/strict';
import {causalQuestionPartition,answerCausalContextQuestion,searchCausalMemory} from './causal-context-question.js';
import type {ThreeAgentStore} from './three-agent-store.js';
import type {SpatialObservation} from '../agent/incremental-spatial-memory.js';

const row=(id:string,atMs:number):SpatialObservation=>({id,atMs,frames:['front.png','left.png','right.png']});
function snapshot(){return {asOfMs:300000,version:4,pendingMemory:0,completeness:'processed-not-verified',memoryLayer:'facts',relationshipReviews:{},evidence:[],results:[
 {lane:'memory',observation_id:'old',source_at_ms:10000,evidence_until_ms:10000,memoryRef:'memory-v1',result:{summary:'blue bench along the wall'}},
 {lane:'memory',observation_id:'recent',source_at_ms:260000,evidence_until_ms:260000,memoryRef:'memory-v2',result:{summary:'washing machines'}},
 {lane:'memory',observation_id:'future',source_at_ms:310000,evidence_until_ms:310000,memoryRef:'memory-v3',result:{summary:'future secret'}},
 {lane:'memory',observation_id:'batch-future',source_at_ms:290000,evidence_until_ms:310000,memoryRef:'memory-v4',result:{summary:'not yet available'}}
 ]} as unknown as ReturnType<ThreeAgentStore['snapshot']>;}
const images=async(rows:SpatialObservation[])=>rows.map(r=>({id:r.id,path:'unused.png',direction:'front',sha256:'mock'}));

test('causal context excludes old, future and future-ended windows, search is private until called',()=>{
 const p=causalQuestionPartition(snapshot(),300000);
 assert.deepEqual(p.context.map(r=>r.observationId),['recent']);assert.deepEqual(p.memory.map(r=>r.observationId),['old']);
 assert.equal(searchCausalMemory(p.memory,'bench')[0]!.memoryRef,'memory-v1');
 assert.throws(()=>causalQuestionPartition(snapshot(),300001));
});

test('recent context can answer without persistent access, no tier or private reference is delivered',async()=>{
 const answer=await answerCausalContextQuestion('What was nearby?',row('now',300000),snapshot(),async input=>{
  const data=JSON.stringify(input.data);assert.ok(!data.includes('blue bench'));assert.ok(!data.includes('future secret'));assert.ok(!data.includes('tier'));
  assert.ok(data.includes('washing machines'));return {kind:'answer',text:'Washing machines',sourceIds:[],contextRefs:['context:recent'],memoryRefs:[],abstained:false};
 },images,()=>{throw Error('No raw history should be accessed');});
 assert.equal(answer.audit.route,'context-or-current-only');assert.equal(answer.audit.deliveredMemory.length,0);
});

test('old memory is delivered only after a model-requested search; inspection requires returned refs',async()=>{
 let n=0;
 const answer=await answerCausalContextQuestion('Where was seating?',row('now',300000),snapshot(),async input=>{
  if(n++===0){assert.ok(!JSON.stringify(input.data).includes('blue bench'));return {kind:'memory.search',query:'bench'};}
  assert.ok(JSON.stringify(input.data).includes('blue bench'));
  return {kind:'answer',text:'Along the wall',sourceIds:[],contextRefs:[],memoryRefs:['memory-v1'],abstained:false};
 },images,id=>row(id,10000));
 assert.equal(answer.audit.citedMemory[0]!.observationId,'old');assert.equal(answer.audit.route,'persistent-memory-requested');
});

test('fabricated memory and raw-history citations are rejected',async()=>{
 await assert.rejects(answerCausalContextQuestion('Question',row('now',300000),snapshot(),async()=>({kind:'answer',text:'Bench',sourceIds:['old'],contextRefs:[],memoryRefs:['memory-v1'],abstained:false}),images,id=>row(id,10000)),/Undelivered/);
});

test('question branches cannot inherit earlier answers or alter the original snapshot',async()=>{
 const s=snapshot(),before=JSON.stringify(s);
 for(let i=0;i<2;i++)await answerCausalContextQuestion('Question',row('now',300000),s,async input=>{
  assert.deepEqual((input.data as any).history,[]);return {kind:'answer',text:'Unknown',sourceIds:[],contextRefs:[],memoryRefs:[],abstained:true};
 },images,id=>row(id,10000));
 assert.equal(JSON.stringify(s),before);
});

test('memory inspection cannot use guessed refs and errors remain in the trace',async()=>{
 let n=0;
 const answer=await answerCausalContextQuestion('Question',row('now',300000),snapshot(),async input=>{
  if(n++===0)return {kind:'memory.inspect',memoryRefs:['memory-v1']};
  assert.match(JSON.stringify(input.data),/previously returned/);return {kind:'answer',text:'Unknown',sourceIds:[],contextRefs:[],memoryRefs:[],abstained:true};
 },images,()=>{throw Error('Must not inspect guessed ref');});
 assert.equal(answer.audit.deliveredMemory.length,0);
});
