import test from 'node:test';
import assert from 'node:assert/strict';
import {projectTwoSecondReplay} from './spatial-window-plan.js';

test('full813 replay retains the 110ms final source tail, preserves original times and never exceeds four members',()=>{
 const rows=Array.from({length:813},(_,i)=>({id:'o'+i,atMs:i===812?811110:i*1000,views:[]}));
 const projected=projectTwoSecondReplay(rows),buckets=new Map<number,number>();
 for(const row of projected){const key=Math.floor(row.atMs/8000);buckets.set(key,(buckets.get(key)??0)+1);}
 assert.equal(projected.length,813);assert.equal(buckets.size,204);assert.equal(Math.max(...buckets.values()),4);assert.equal(projected.at(-1)!.sourceAtMs,811110);assert.equal(projected.at(-1)!.atMs,1624000);assert.equal(rows.at(-1)!.atMs,811110);
});

test('replay projection keeps real source gaps instead of manufacturing continuity',()=>{
 const projected=projectTwoSecondReplay([{id:'a',atMs:0,views:[]},{id:'b',atMs:100000,views:[]}]);
 assert.equal(projected[1]!.atMs,200000);assert.equal(projected[1]!.sourceAtMs,100000);
});
