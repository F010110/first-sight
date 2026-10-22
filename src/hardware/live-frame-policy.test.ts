import {test} from 'node:test';import assert from 'node:assert/strict';
import {LiveFramePolicy} from './live-frame-policy.js';
const f=(id:string,atMs:number)=>({id,atMs,requestWallTimeMs:10000+atMs});
test('bounded latest queue preserves audit ids and isolates stale frames',()=>{
 const p=new LiveFramePolicy(2500,5000,1);p.offer(f('a',0));assert.deepEqual(p.offer(f('b',2000)),['a']);assert.equal(p.status(12000).pending,1);
 assert.equal(p.take(15000).reason,'stale');assert.equal(p.status(15000).state,'current-state-unconfirmed');assert.equal(p.take(15000).frame,null);
});
test('sampling gaps are unknown and late async results cannot update current state',()=>{
 const p=new LiveFramePolicy();const a=f('a',0);p.offer(a);assert.equal(p.take(10000).continuity,'unknown');
 p.offer(f('b',2000));assert.equal(p.mayPublishCurrent(a,12000),false);assert.equal(p.take(12000).continuity,'sample-continuous');
 p.offer(f('c',12000));assert.equal(p.take(22000).continuity,'unknown');assert.equal(p.mayPublishCurrent(f('c',12000),25000),false);
 assert.throws(()=>p.offer(f('old',1000)),/regressed/);
});
test('future timestamps are not treated as fresh',()=>{const p=new LiveFramePolicy();p.offer(f('a',0));assert.equal(p.take(9999).reason,'clock-invalid');assert.equal(p.status(9999).state,'current-state-unconfirmed');});
test('discarded input interrupts continuity even if later timestamps are close',()=>{
 const p=new LiveFramePolicy();p.offer(f('a',0));p.take(10000);
 p.offer(f('stale',1000));assert.equal(p.take(14000).reason,'stale');
 p.offer(f('b',2000));assert.equal(p.take(14000).continuity,'unknown');
 p.offer(f('pending',3000));p.offer(f('newer',4000));assert.equal(p.take(14000).continuity,'unknown');
});
