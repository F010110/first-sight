import {test} from 'node:test';
import assert from 'node:assert/strict';
import {questionSpatialModule} from './question-module-v3.js';
import type {ArchivedEvidence} from './observation-archive.js';

test('dynamic question module compresses independently, retains source/tail pointers and does not mutate long-term facts',()=>{
 const rows:ArchivedEvidence[]=Array.from({length:8},(_,i)=>({sequence:i+1,observation:{id:'o'+i,atMs:i*2000,views:[]},archivedAtMs:i,factsAvailableAtMs:i,facts:{summary:'visible room',details:Array.from({length:8},()=>String(i).repeat(1000))}}));
 const before=JSON.stringify(rows),module=questionSpatialModule(rows,null,20000);
 assert.ok(module.compression.omittedFactIds.length>0);assert.equal(module.pendingCurrent,true);assert.deepEqual(module.observations.slice(-2).map(o=>o.facts),rows.slice(-2).map(r=>r.facts));assert.equal(JSON.stringify(rows),before);assert.equal(module.spatial,null);assert.equal(module.observations.length,8);
});
