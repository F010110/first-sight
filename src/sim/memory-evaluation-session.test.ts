import {test} from 'node:test';import assert from 'node:assert/strict';
import {eligibleRows,memorySession,type MemoryRow} from './memory-evaluation-session.js';
const row=(id:string,atMs:number,available=atMs):MemoryRow=>({id,atMs,sourceAtMs:atMs,episodeNumber:1,judgmentAvailableAtMs:available,cameras:{},sha256:{}});
test('mode scope excludes old and future evidence, current remains accessible',()=>{
 const rows=[row('old',0),row('recent',1000000),row('now',1200000),row('future',1300000)];
 assert.deepEqual(eligibleRows(rows,'now',1200001,'current-only').map(r=>r.id),['now']);
 assert.deepEqual(eligibleRows(rows,'now',1200001,'recent-5min').map(r=>r.id),['recent','now']);
 assert.deepEqual(eligibleRows(rows,'now',1200001,'full-history').map(r=>r.id),['old','recent','now']);
});
test('joint-window future judgments and inherited history are not exposed',async()=>{
 const rows=[row('a',0,500),row('b',100,100)];const assignments=new Map([['a',{placeId:'p',reason:'FUTURE'}],['b',{placeId:'p',reason:'OLDSECRET'}]]);
 const full=memorySession(rows,'b',101,'full-history',assignments,()=>{});
 assert.equal(full.search({query:'FUTURE'}).hits.length,0);
 const recent=memorySession(rows,'b',101,'recent-5min',assignments,()=>{});
 assert.equal(recent.search({query:'OLDSECRET'}).hits.length,0);
 await assert.rejects(recent.inspect(['a']),/in-scope/);
 assert.equal(full.search({query:'第1段0.1秒'}).hits[0]?.id,'b');
});
