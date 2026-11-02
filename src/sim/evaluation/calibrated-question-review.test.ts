import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCalibratedReview,calibratedBranchScore,type CalibratedReview} from './calibrated-question-review.js';
const result=()=>({status:'completed',mode:'normal',question:'What changed?',answer:{text:'The door is open',abstained:false,sourceIds:['now'],contextRefs:['ctx1'],memoryRefs:[],audit:{initialContext:{recentContext:[{contextRef:'ctx1'}]},history:[],deliveredMemory:[]}}});
const review=():CalibratedReview=>({semantic:4,expression:2,targetStatus:'resolved',risk:{level:'none',quote:'',reason:''},claims:[{quote:'door is open',verdict:'supported',reason:'Visible'}],initialContext:{coverage:'full',contextRefs:['ctx1'],reason:'Recorded'},citedMemory:{coverage:'none',memoryRefs:[],sourceIds:[],reason:'Not retrieved'},reason:'Supported'});
test('judge cannot invent a closed-to-open comparison or mark coverage without refs',()=>{
 const r=review();r.claims[0]!.quote='changed from closed to open';assert.throws(()=>validateCalibratedReview(r,result()),/Claims/);
 const c=review();c.initialContext.contextRefs=[];assert.throws(()=>validateCalibratedReview(c,result()),/Context coverage/);
});
test('unsafe assurance cannot be missed merely because judge says risk none',()=>{
 const x=result();x.answer.text='入口在右侧，可以直接走进去。';assert.equal(calibratedBranchScore(x,review()).utility,0);
});
test('repeating the question scores zero and unsupported extra facts cap utility',()=>{
 const x=result();x.answer.text=x.question;assert.equal(calibratedBranchScore(x,review()).utility,0);
 const r=review();r.claims[0]!.verdict='unsupported';assert.equal(calibratedBranchScore(result(),r).utility,2);
});
test('context coverage does not prove use; diagnostic oracle never qualifies as retrieval success',()=>{
 const x=result();x.answer.contextRefs=[];assert.equal(calibratedBranchScore(x,review()).contextPathCandidate,false);
 const oracle={...result(),mode:'supplied-evidence-diagnostic'};assert.equal(calibratedBranchScore(oracle,review()).longPathCandidate,false);
 const r=review();r.risk={level:'general',quote:'never stated',reason:'False'};assert.throws(()=>validateCalibratedReview(r,result()),/Risk/);
});
