import test from 'node:test';
import assert from 'node:assert/strict';
import {splitQuestionReview,scoreSplitReview,summarizeSplitScores} from './split-question-review.js';
const result=()=>({status:'completed',question:'What was there?',mode:'supplied-evidence-diagnostic',answer:{text:'A green table',abstained:false,sourceIds:['old-image'],contextRefs:[],memoryRefs:[],audit:{initialContext:{recentContext:[]},deliveredMemory:[]}}});
const raw=()=>({semantic:4,expression:2,targetStatus:'resolved',risk:{level:'none',quote:'',reason:''},claims:[{quote:'green table',verdict:'supported',reason:'Visible in provided old image'}],initialContext:{coverage:'none',contextRefs:[],reason:'Old info absent'},citedMemory:{coverage:'full',memoryRefs:[],sourceIds:['old-image'],reason:'Incorrectly labels diagnostic image as persistent'},reason:'Correct color'});
test('bad diagnostic-vs-memory judgment does not erase a valid semantic grade or silently repair channel',()=>{
 const split=splitQuestionReview(raw(),result());assert.ok(split.semantic);assert.equal(split.mechanism,null);assert.match(split.mechanismError!,/Memory support/);
 const score=scoreSplitReview(result(),split,'answerable');assert.equal(score.utility,4);assert.equal(score.mechanismValid,false);
});
test('invented quote fails semantics independently, channel can remain valid',()=>{
 const r=raw();r.claims[0]!.quote='changed from brown to green';r.citedMemory={coverage:'none',memoryRefs:[],sourceIds:[],reason:'Diagnostic, not memory'};
 const split=splitQuestionReview(r,result());assert.equal(split.semantic,null);assert.ok(split.mechanism);assert.equal(scoreSplitReview(result(),split).utility,null);
});
test('honest nonanswer to an answerable question is not full task completion, wrong target cannot gain credit',()=>{
 const answer=result();answer.answer.abstained=true;answer.answer.text='I cannot confirm';const r=raw();r.claims=[];
 assert.equal(scoreSplitReview(answer,splitQuestionReview(r,answer),'answerable').utility,1);
 const wrong=raw();wrong.targetStatus='wrong';assert.equal(scoreSplitReview(result(),splitQuestionReview(wrong,result()),'answerable').utility,0);
});
test('ungraded remains unknown with full planned denominator; execution failure remains zero',()=>{
 const summary=summarizeSplitScores([{utility:4},{utility:null},{utility:0}]);assert.equal(summary.pointPercent,null);assert.equal(summary.planned,3);assert.deepEqual(summary.possiblePercentRange,[100/3,200/3]);
 assert.equal(scoreSplitReview({status:'failed'},splitQuestionReview({},result())).utility,0);
});
