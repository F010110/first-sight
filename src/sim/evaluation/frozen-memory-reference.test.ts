import test from 'node:test';import assert from 'node:assert/strict';
import {validateReferenceDraft,verifyReference,validateReferenceScore,referenceCoverage} from './frozen-memory-reference.js';
test('fixed references retain only supported facts and never promote unknowns to targets',()=>{
 const d=validateReferenceDraft({facts:[{camera:'front',importance:'core',text:'门口'},{camera:'left',importance:'detail',text:'猜测用途'}],unknowns:['暗处未知']});
 const v=verifyReference(d,{checks:[{id:'f0',verdict:'supported',reason:'清晰'},{id:'f1',verdict:'uncertain',reason:'不可见'}],unknowns:[]});
 assert.equal(v.facts.length,1);assert.throws(()=>verifyReference(d,{checks:[],unknowns:[]}));
 const ref={id:'one',atMs:1,facts:v.facts,unknowns:v.unknowns,authority:'fixture'};
 const score=validateReferenceScore({matches:[{factId:'f0',coverage:'partial',reason:'部分'}],errors:[],reason:'固定参照'},ref);
 assert.deepEqual(referenceCoverage(ref,score),{earned:.5,possible:1});assert.deepEqual(referenceCoverage(ref,null),{earned:null,possible:1});
 assert.throws(()=>validateReferenceScore({...score,matches:[{factId:'invented',coverage:'full',reason:'x'}]},ref));
 const disputed=validateReferenceScore({...score,matches:[{factId:'f0',coverage:'reference-disputed',reason:'待复核原图'}]},ref);
 assert.equal(referenceCoverage(ref,disputed).earned,null);
 assert.throws(()=>validateReferenceScore({...score,errors:[{kind:'contradiction',referenceFactId:'invented',quote:'候选句',reason:'无实际参照'}]},ref));
});
