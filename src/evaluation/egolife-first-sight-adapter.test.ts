import {test} from 'node:test';
import assert from 'node:assert/strict';
import {egoLifeTask,egoLifeTime,canonicalEgoLifeResponse,answerEgoLifeWithFirstSight} from './egolife-first-sight-adapter.js';
const row={ID:'1',type:'EntityLog',question:'Where was the cup?',query_time:{date:'DAY1',time:'11210217'},choice_a:'Desk',choice_b:'Shelf',choice_c:'Drawer',choice_d:'Unknown',answer:'B',target_time:{date:'DAY1',time:'11152408'},reason:'SECRET_GOLD_REASON',keywords:'SECRET_TARGET',trigger:'SECRET_TRIGGER'};
test('official clock preserves centiseconds and distinguishes integer until_time from source milliseconds',()=>{
 assert.deepEqual(egoLifeTime('DAY1','11210217'),{untilTime:111210217,cutoffMs:40862170});
 assert.equal(egoLifeTime('DAY2','00000000').cutoffMs,86400000);
 assert.throws(()=>egoLifeTime('DAY1','24600000'));assert.throws(()=>egoLifeTime('DAY8','11210217'));
});
test('public question strips answer, evidence locations and other annotation hints',()=>{
 const task=egoLifeTask(row),text=JSON.stringify(task);
 for(const forbidden of ['answer','target_time','SECRET','keywords','trigger'])assert.ok(!text.includes(forbidden));
 assert.equal(task.choices.B,'Shelf');assert.equal(task.ID,'1');
});
test('choice protocol accepts explicit letters or unambiguous choice text, not arbitrary initial letters',()=>{
 const task=egoLifeTask(row);
 assert.equal(canonicalEgoLifeResponse('(B)',task.choices),'B');assert.equal(canonicalEgoLifeResponse('shelf.',task.choices),'B');
 assert.equal(canonicalEgoLifeResponse('Abstained',task.choices),null);assert.equal(canonicalEgoLifeResponse('Another guess',task.choices),null);
});
test('native callback receives causal question only; abstention cannot become A in upstream scorer',async()=>{
 const task=egoLifeTask(row);let called=false;
 const result=await answerEgoLifeWithFirstSight(task,{asOfMs:task.cutoffMs,rows:[]},async(snapshot,text,_request,active)=>{
  called=true;assert.equal(active,false);assert.ok(text.includes('历史'));assert.ok(!text.includes('SECRET'));return {text:'Abstained',sourceIds:[],abstained:true,asOfMs:snapshot.asOfMs};
 },async()=>{throw Error('No model calls in test');});
 assert.ok(called);assert.equal(result.status,'abstained');assert.equal(result.response,'Error');
});
test('future or misaligned snapshots fail before invoking native engine',async()=>{
 const task=egoLifeTask(row);await assert.rejects(answerEgoLifeWithFirstSight(task,{asOfMs:task.cutoffMs+1,rows:[]},async()=>{throw Error('Must not run');},async()=>null),/clock/);
});
