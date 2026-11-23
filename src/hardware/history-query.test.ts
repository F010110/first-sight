import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historySelection,temporalPlaceHints} from './history-query.js';
test('omitted and null tool options have identical semantics',()=>{
 assert.deepEqual(historySelection({query:'marker'},['p']),historySelection({query:'marker',placeId:null,afterMs:null,beforeMs:null,cursor:null,order:null,strategy:null},['p']));
});
test('nonempty invalid IDs and time ranges remain errors, not silently widened searches',()=>{
 assert.throws(()=>historySelection({placeId:'可选精确ID'},['real']),/actual placeId/);
 assert.throws(()=>historySelection({afterMs:20,beforeMs:10},[]),/afterMs/);
});
test('temporal place context is only a retrieval hint and does not mutate rows',()=>{
 const rows=[{id:'a',atMs:0,placeId:'p1'},{id:'b',atMs:2,placeId:null},{id:'c',atMs:9,placeId:null},{id:'d',atMs:10,placeId:'p2'}];
 const hints=temporalPlaceHints(rows);assert.equal(hints.get('b'),'p1');assert.equal(hints.get('c'),'p2');assert.equal(rows[1]!.placeId,null);
});
