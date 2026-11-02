import test from 'node:test';import assert from 'node:assert/strict';
import {spatialScorecard,validateObservationReview,validateAssociationReview} from './spatial-scorecard.js';
test('unreviewed and failed spatial cases stay in denominator; absent dimensions remain null',()=>{
 const s=spatialScorecard([{id:'x',status:'failed',review:null,error:'failed'}],[],{checks:0,violations:[]},2);
 assert.equal(s.dimensions.grounding.score,0);assert.equal(s.dimensions.grounding.denominator,8);
 assert.equal(s.dimensions.positiveRevisitRecall.score,null);assert.equal(s.gate.passed,false);
});
test('review must quote candidate rather than inventing a hallucination',()=>{
 assert.throws(()=>validateObservationReview({grounding:4,coverage:4,direction:4,temporal:4,reason:'x',issues:[{quote:'invented',kind:'unsupported',reason:'x'}]},'actual'));
 assert.throws(()=>validateAssociationReview({support:4,calibration:4,revisitFound:null,unsupportedIdentity:false,reason:'x'},true));
});
test('perfect descriptions cannot mask a failed revisit or an integrity violation',()=>{
 const o={id:'x',status:'completed' as const,review:{grounding:4,coverage:4,direction:4,temporal:4,issues:[],reason:'ok'},error:null};
 const a={id:'pair',positive:true,review:{support:4,calibration:4,revisitFound:false,unsupportedIdentity:false,reason:'miss'},error:null,targetDelivered:false,targetReadViaTool:false};
 assert.equal(spatialScorecard([o],[a],{checks:1,violations:[]},1).gate.passed,false);
 assert.equal(spatialScorecard([o],[],{checks:1,violations:['future']},1).gate.passed,false);
});
