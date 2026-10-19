import {test} from 'node:test';import assert from 'node:assert/strict';import {spatialWindows} from './spatial-window-schedule.js';
test('window schedule covers all observations, flushes tail and isolates recordings',()=>{
 const rows=Array.from({length:25},(_,i)=>({id:i,atMs:i*2000,recordingId:i<13?'a':'b'}));const windows=spatialWindows(rows);
 assert.deepEqual(windows.flat(),rows);assert.ok(windows.length<rows.length);assert.ok(windows.every(w=>w.length<=4&&w.every(o=>o.recordingId===w[0]!.recordingId)));assert.ok(windows.some(w=>w.length<4));
 assert.throws(()=>spatialWindows([{atMs:1},{atMs:0}]));
});
