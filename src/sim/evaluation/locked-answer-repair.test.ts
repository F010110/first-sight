import {test} from 'node:test';import assert from 'node:assert/strict';
import {applyLockedProtocolPatch} from './locked-answer-repair.js';
import type {MemoryRow} from './memory-evaluation-session.js';
const rows=[{id:'past',atMs:0,sourceAtMs:0,episodeNumber:1},{id:'now',atMs:1000,sourceAtMs:2000,episodeNumber:2}] as MemoryRow[];
const q={id:'q',question:'第1段0秒与当前，各自在室内还是室外？',queryAtMs:1001,currentObservationId:'now'};
const original={kind:'question',answer:'过去室外，当前室内。',confidence:.92,done:true,shouldSpeak:true,historicalEvidenceIds:['past'],abstained:false};
test('metadata repair preserves every factual/control field exactly',()=>{
 const result=applyLockedProtocolPatch(JSON.stringify(original),JSON.stringify({historicalEvidenceIds:['past','now'],abstained:false}),q,rows,new Set(['past','now']));
 for(const [key,value] of Object.entries(original))if(!['historicalEvidenceIds','abstained'].includes(key))assert.deepEqual(result.value[key],value);
});
test('reject rewrites, unviewed IDs, omitted comparison sources, fake abstention and malformed patches',()=>{
 for(const patch of [{answer:'改成其他答案',historicalEvidenceIds:['past','now'],abstained:false},{historicalEvidenceIds:['invented'],abstained:false},{historicalEvidenceIds:['past'],abstained:false},{historicalEvidenceIds:[],abstained:true},{abstained:'true',historicalEvidenceIds:[]},{unrepairable:true}])assert.throws(()=>applyLockedProtocolPatch(JSON.stringify(original),JSON.stringify(patch),q,rows,new Set(['past','now'])));
});
test('non-leading explicit refusal can fix flag without changing wording',()=>{
 const answer='这些旧录像无法证明学校今天仍然开放。';
 const result=applyLockedProtocolPatch(JSON.stringify({...original,answer}),JSON.stringify({historicalEvidenceIds:[],abstained:true}),q,rows,new Set());
 assert.equal(result.value.answer,answer);assert.equal(result.value.abstained,true);
});
test('visibility-limited refusal is not mistaken for a confident hidden-content answer',()=>{
 const answer='当前视野中未检测到抽屉。';
 assert.equal(applyLockedProtocolPatch(JSON.stringify({...original,answer}),JSON.stringify({historicalEvidenceIds:['now'],abstained:true}),q,rows,new Set(['now'])).value.answer,answer);
 assert.throws(()=>applyLockedProtocolPatch(JSON.stringify({...original,answer:'历史里没有抽屉，所以里面从没放过任何东西。'}),JSON.stringify({historicalEvidenceIds:[],abstained:true}),q,rows,new Set()));
});
