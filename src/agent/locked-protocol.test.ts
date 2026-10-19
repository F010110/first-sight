import {test} from 'node:test';import assert from 'node:assert/strict';import {lockedProtocolPatch} from './locked-protocol.js';
test('metadata continuation cannot rewrite any answer fields',()=>{
 const original={answer:'不确定是否同层',confidence:.4,done:true,historicalEvidenceIds:[],abstained:false,custom:{preserved:1}};
 const patched=JSON.parse(lockedProtocolPatch(JSON.stringify(original),JSON.stringify({historicalEvidenceIds:['viewed'],abstained:true})));
 assert.deepEqual({...patched,historicalEvidenceIds:[],abstained:false},original);
 assert.throws(()=>lockedProtocolPatch(JSON.stringify(original),'{"answer":"changed","historicalEvidenceIds":[],"abstained":true}'));
});
