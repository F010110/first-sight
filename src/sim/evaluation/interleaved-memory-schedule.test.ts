import {test} from 'node:test';import assert from 'node:assert/strict';import {interleavedSchedule} from './interleaved-memory-schedule.js';
test('questions flush early windows, share current frame without future leakage and deterministic ties',()=>{
 const rows=Array.from({length:20},(_,i)=>({id:'o'+i,atMs:i*2000,frames:[],recordingId:'r'}));
 const questions=[{id:'b',question:'b',currentObservationId:'o0',queryAtMs:1},{id:'a',question:'a',currentObservationId:'o0',queryAtMs:1},{id:'c',question:'c',currentObservationId:'o9',queryAtMs:18001}];
 const events=interleavedSchedule(rows,questions);assert.deepEqual(events.filter(e=>e.question).map(e=>e.question!.id),['a','b','c']);
 for(const e of events){assert.ok(e.observations.length<=4);if(e.question)assert.ok(e.observations.every(o=>o.atMs<e.question!.queryAtMs));}
 assert.equal(new Set(events.flatMap(e=>e.observations.map(o=>o.id))).size,20);
 assert.throws(()=>interleavedSchedule(rows,[{...questions[0]!,currentObservationId:'o1'}]));
});
