import {test} from 'node:test';import assert from 'node:assert/strict';import {boundedNetworkRetry} from './bounded-network-retry.js';
test('socket failure retries exact operation within three attempts and preserves failures',async()=>{
 let calls=0;const failures:number[]=[];
 const result=await boundedNetworkRetry(async()=>{calls++;if(calls<3)throw Object.assign(new TypeError('fetch failed'),{cause:{code:'UND_ERR_SOCKET'}});return 'ok'},async(_e,attempt)=>{failures.push(attempt)},3,0);
 assert.equal(result,'ok');assert.equal(calls,3);assert.deepEqual(failures,[0,1]);
});
test('nontransport error never retries; persistent socket failures stop',async()=>{
 let calls=0;await assert.rejects(boundedNetworkRetry(async()=>{calls++;throw Error('HTTP 401')},async()=>{},3,0),/401/);assert.equal(calls,1);
 calls=0;await assert.rejects(boundedNetworkRetry(async()=>{calls++;throw Object.assign(Error('socket'),{code:'ECONNRESET'})},async()=>{},3,0),/socket/);assert.equal(calls,3);
});
