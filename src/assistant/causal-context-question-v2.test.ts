import test from 'node:test';
import assert from 'node:assert/strict';
import {causalMemoryBlocks,diverseMemorySearch,explicitMovementAssurance} from './causal-memory-index.js';
import {answerCausalContextQuestionV2} from './causal-context-question-v2.js';
import type {SpatialObservation} from '../agent/incremental-spatial-memory.js';
import type {ThreeAgentStore} from './three-agent-store.js';
const old=Array.from({length:80},(_,i)=>({memoryRef:`memory-v${i+1}`,observationId:`old-${i}`,atMs:i*1000,text:'green table and shelves'}));
const row=(id:string,atMs:number):SpatialObservation=>({id,atMs,frames:['front','left','right']});
const snapshot=()=>({asOfMs:300000,results:[...old.map(r=>({lane:'memory',observation_id:r.observationId,source_at_ms:r.atMs,evidence_until_ms:r.atMs,memoryRef:r.memoryRef,result:{summary:r.text}})),{lane:'memory',observation_id:'recent',source_at_ms:290000,evidence_until_ms:290000,memoryRef:'memory-v100',result:{summary:'a closed wooden door'}}]} as unknown as ReturnType<ThreeAgentStore['snapshot']>);
const images=async(rows:SpatialObservation[])=>rows.map(r=>({id:r.id,path:'unused',direction:'front',sha256:'mock'}));
const answer=(overrides:Record<string,unknown>={})=>({kind:'answer',text:'A door',target:'current opening',sourceIds:['now'],contextRefs:[],memoryRefs:[],abstained:false,...overrides});

test('retrieval spreads near-duplicate candidates over time, clock pages never claim places',()=>{
 const hits=diverseMemorySearch(old,'green shelves');assert.equal(hits.length,4);assert.equal(new Set(hits.map(r=>Math.floor(r.atMs/20000))).size,4);
 const b=causalMemoryBlocks(old);assert.equal(b.length,4);assert.equal(b[0]!.count,20);assert.ok(!JSON.stringify(b).includes('placeId'));
 assert.deepEqual(diverseMemorySearch(old,'absent'),[]);
});
test('explicit assurance detector distinguishes negation and contradictory positive instructions',()=>{
 assert.equal(explicitMovementAssurance('入口在右侧，可以直接走进去。').length,1);
 assert.equal(explicitMovementAssurance('无法确认可以直接走进去。').length,0);
 assert.equal(explicitMovementAssurance('我不能保证安全，但你可以直接走进去。').length,1);
 assert.equal(explicitMovementAssurance('右侧看到敞开门口。').length,0);
});
test('v2 removes numeric time examples and does not expose old descriptions initially',async()=>{
 await answerCausalContextQuestionV2('Question',row('now',300000),snapshot(),async input=>{
  assert.ok(!input.prompt.includes('123000'));assert.ok(!JSON.stringify(input.data).includes('green table'));assert.ok(JSON.stringify(input.data).includes('closed wooden door'));
  assert.ok(input.prompt.includes('{"kind":"memory.overview"}'));assert.ok(input.prompt.includes('应先检索'));
  return answer();
 },images,id=>row(id,1000));
});
test('invalid raw-history citation gets model-visible feedback, never automatic citation repair',async()=>{
 let n=0;
 const result=await answerCausalContextQuestionV2('Question',row('now',300000),snapshot(),async input=>{
  if(n++===0)return answer({sourceIds:['recent']});
  assert.match(JSON.stringify(input.data),/descriptions must cite contextRefs/);return answer({sourceIds:[],contextRefs:['context:recent']});
 },images,id=>row(id,1000));
 assert.equal(result.audit.history.length,1);assert.deepEqual(result.sourceIds,[]);assert.equal(result.audit.turns,2);
});
test('movement assurance is not delivered; candidate retained and model must correct it',async()=>{
 let n=0;
 const result=await answerCausalContextQuestionV2('Entrance?',row('now',300000),snapshot(),async()=>n++===0?answer({text:'可以直接走进去。'}):answer({text:'右侧看到一个敞开门口。'}),images,id=>row(id,1000));
 assert.equal(result.audit.history.length,1);assert.ok(!result.text.includes('可以直接'));
 assert.equal((result.audit.history[0]!.action as any).text,'可以直接走进去。');
});
test('memory-disabled branch cannot fetch facts even when model requests them',async()=>{
 let n=0;
 const result=await answerCausalContextQuestionV2('Earlier?',row('now',300000),snapshot(),async input=>{
  assert.ok(!JSON.stringify(input.data).includes('green table'));
  if(n++===0)return {kind:'memory.overview'};
  return answer({text:'Unable to confirm',abstained:true,sourceIds:[]});
 },images,()=>{throw Error('No raw fetch');},{persistentMemory:false});
 assert.equal(result.audit.deliveredMemory.length,0);
});
test('overview/open expose only persisted sources and inspect cannot guess a reference',async()=>{
 let n=0;
 const result=await answerCausalContextQuestionV2('Earlier?',row('now',300000),snapshot(),async()=>{
  if(n++===0)return {kind:'memory.overview'};
  if(n===2)return {kind:'memory.open',blockIds:['time-block-0']};
  return answer({text:'Green table',sourceIds:[],memoryRefs:['memory-v1']});
 },images,id=>row(id,1000));
 assert.equal(result.memoryRefs[0],'memory-v1');assert.equal(result.audit.deliveredMemory.length,6);
});
test('oracle images are explicitly diagnostic, causal and not treated as a memory retrieval',async()=>{
 const result=await answerCausalContextQuestionV2('Earlier?',row('now',300000),snapshot(),async()=>answer({sourceIds:['old-0']}),images,id=>row(id,0),{persistentMemory:false,diagnosticEvidence:[row('old-0',0)]});
 assert.deepEqual(result.audit.diagnosticEvidenceIds,['old-0']);assert.equal(result.audit.route,'context-or-current-only');
 await assert.rejects(answerCausalContextQuestionV2('Question',row('now',300000),snapshot(),async()=>answer(),images,id=>row(id,0),{diagnosticEvidence:[row('future',310000)]}),/Noncausal diagnostic/);
});
