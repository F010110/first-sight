import test from 'node:test';
import assert from 'node:assert/strict';
import {requireDeliveredIds} from './source-access.js';
test('inspect errors distinguish the unavailable requested ID from delivered alternatives without granting access',()=>{
 const delivered=new Set(['observation-60','observation-68']);
 assert.throws(()=>requireDeliveredIds(['observation-64'],3,delivered,'memory_inspect'),error=>{
  assert.match(String(error),/memory_inspect.ids/);assert.match(String(error),/observation-64/);assert.match(String(error),/observation-60/);assert.match(String(error),/location.sourceIds/);return true;
 });
 assert.deepEqual([...delivered],['observation-60','observation-68']);
 assert.deepEqual(requireDeliveredIds(['observation-60'],3,delivered,'memory_inspect'),['observation-60']);
});
test('IDs remain distinct, bounded, tool-specific and strictly delivered',()=>{
 const delivered=new Set(['a']);
 for(const ids of [[],['a','a'],['a','b','c','d'],null,[1],['place-uuid']])assert.throws(()=>requireDeliveredIds(ids,3,delivered,'memory_read'),/memory_read.ids/);
});
