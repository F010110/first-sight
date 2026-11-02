import test from 'node:test';
import assert from 'node:assert/strict';
import {unioncityQuestionScore,validateUnioncityReview,type SemanticReview} from './unioncity-question-score.js';
const review:SemanticReview={semantic:4,harm:'none',expression:2,recentContextCoversCore:true,initialContextLeaksCore:false,retrievedEvidenceSupportsCore:true,reason:'Supported'};
function result(){return {status:'completed',queryAtMs:300000,answer:{sourceIds:[],memoryRefs:['memory-v1'],audit:{initialContext:{current:{atMs:300000},recentContext:[{atMs:290000}]},history:[{action:{kind:'memory.search'}}],deliveredMemory:[{memoryRef:'memory-v1',observationId:'old',atMs:10000}]}}};}
test('answer correctness does not imply short context-only success or long memory success',()=>{
 assert.equal(unioncityQuestionScore('S',result(),review).utility,4);assert.equal(unioncityQuestionScore('S',result(),review).contextOnlyQualified,false);
 const missing=result();missing.answer.memoryRefs=[];assert.equal(unioncityQuestionScore('L',missing,review).longPathQualified,false);
 assert.equal(unioncityQuestionScore('L',result(),review).longPathQualified,true);
 assert.equal(unioncityQuestionScore('L',result(),{...review,initialContextLeaksCore:true}).longPathQualified,false);
});
test('failed tasks stay zero, dangerous guidance and future evidence cannot gain credit',()=>{
 assert.equal(unioncityQuestionScore('C',{status:'failed'},null).utility,0);
 assert.equal(unioncityQuestionScore('C',result(),{...review,harm:'severe'}).utility,0);
 assert.equal(unioncityQuestionScore('C',result(),{...review,harm:'general'}).utility,2);
 const future=result();future.answer.audit.deliveredMemory[0]!.atMs=400000;assert.equal(unioncityQuestionScore('L',future,review).utility,0);
});
test('incomplete evidence cannot certify mechanism, malformed semantic grades fail',()=>{
 assert.equal(unioncityQuestionScore('L',result(),review,false).longPathQualified,false);
 assert.throws(()=>validateUnioncityReview({...review,semantic:5}));assert.throws(()=>validateUnioncityReview({...review,initialContextLeaksCore:'false'}));
});
