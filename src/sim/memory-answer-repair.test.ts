import {test} from 'node:test';import assert from 'node:assert/strict';
import {answerFailures,repairFeedback} from './memory-answer-repair.js';
import type {MemoryRow} from './memory-evaluation-session.js';
const rows=[{id:'past',atMs:0,sourceAtMs:20000,episodeNumber:1},{id:'now',atMs:1000,sourceAtMs:30000,episodeNumber:2}] as MemoryRow[];
const q={id:'q',question:'第1段20秒与当前这次记录，各自在室内还是室外？',queryAtMs:1001,currentObservationId:'now'};
test('repair detects JSON, missing public-record citations and flags without answer labels',()=>{
 assert.match(answerFailures('{',q,rows,new Set())[0]!,/Invalid JSON/);
 const raw=JSON.stringify({answer:'前一次室外，当前室内',abstained:false,historicalEvidenceIds:['past']});
 assert.match(answerFailures(raw,q,rows,new Set(['past']))[0]!,/now/);
 assert.deepEqual(answerFailures(JSON.stringify({answer:'前一次室外，当前室内',abstained:false,historicalEvidenceIds:['past','now']}),q,rows,new Set(['past','now'])),[]);
 assert.ok(answerFailures(JSON.stringify({answer:'不能。旧录像不能证明今天开放',abstained:false,historicalEvidenceIds:['past']}),q,rows,new Set(['past'])).some(s=>s.includes('refuses')));
 assert.match(repairFeedback(raw,['missing current']),/missing current/);
});
test('refusal flag check also covers explicit uncertainty after a subject prefix',()=>{
 for(const answer of ['当前画面没有门牌，无法确认精确地址。','当前画面无法确定学校是否营业。','这些旧录像无法证明今天仍然开放。']){
  assert.ok(answerFailures(JSON.stringify({answer,abstained:false,historicalEvidenceIds:['past','now']}),q,rows,new Set(['past','now'])).some(s=>s.includes('refuses')));
  assert.deepEqual(answerFailures(JSON.stringify({answer,abstained:true,historicalEvidenceIds:[]}),q,rows,new Set()),[]);
 }
});
