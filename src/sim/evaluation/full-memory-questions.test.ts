import test from 'node:test';import assert from 'node:assert/strict';
import {validateFixedQuestionGrade} from './full-memory-questions.js';
test('fixed-question scoring cannot omit semantic, safety or evidence-channel verdicts',()=>{
 const good={semantic:3,harm:'none',targetStatus:'resolved',memorySupportsCore:true,inheritedCoversCore:false,extraUnsupported:false,reason:'按固定参考核对'};
 assert.equal(validateFixedQuestionGrade(good).semantic,3);
 assert.throws(()=>validateFixedQuestionGrade({...good,semantic:5}));assert.throws(()=>validateFixedQuestionGrade({...good,memorySupportsCore:undefined}));
});
