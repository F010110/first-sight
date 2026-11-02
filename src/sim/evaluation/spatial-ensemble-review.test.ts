import test from 'node:test';import assert from 'node:assert/strict';
import {validateEnsembleReview,resolveEnsemble,ensembleDisputes,type EnsembleReview} from './spatial-ensemble-review.js';
const claims=[{id:'o1',camera:'front',text:'桌子'}];
const review=(issues:any[]=[]):EnsembleReview=>({checkedClaimIds:['o1'],issues,ratings:{grounding:4,coverage:4,direction:4,temporal:4},reason:'已看图'});
const error={claimId:'o1',verdict:'contradicted',severity:'minor',camera:'front',evidence:'右下角',reason:'可见差异'};
test('ensemble requires complete real claim IDs and located evidence',()=>{
 assert.throws(()=>validateEnsembleReview({...review(),checkedClaimIds:[]},claims));
 assert.throws(()=>validateEnsembleReview(review([{...error,claimId:'invented'}]),claims));
 assert.equal(validateEnsembleReview(review(),claims).issues.length,0);
});
test('a single accusation or missing reviewer cannot establish a confirmed loss',()=>{
 const a=review([error]),b=review();assert.deepEqual(ensembleDisputes(a,b),['o1']);
 assert.equal(resolveEnsemble(claims,a,b,null).findings[0]!.status,'disputed');
 assert.equal(resolveEnsemble(claims,a,null,null).ratings.grounding!.score,null);
 assert.equal(resolveEnsemble(claims,a,b,b).findings[0]!.status,'cleared-adjudicated');
 assert.equal(resolveEnsemble(claims,a,a,null).findings[0]!.status,'confirmed-consensus');
});
