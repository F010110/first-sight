import {test} from 'node:test';
import assert from 'node:assert/strict';
import {V3RequestSlots} from './request-slots-v3.js';

test('background 429 gets one finite cooldown without consuming the reserved question slot or retrying semantic errors',async()=>{
 const slots=new V3RequestSlots(1);let calls=0;
 const background=slots.wrap('spatial',async()=>{if(++calls===1)throw Error('Separated VLM HTTP 429');return 'ok';});
 const input={phase:'identity' as const,prompt:'test',data:{},images:[]};const pending=background(input);
 assert.equal(await slots.wrap('question',async()=> 'immediate')(input),'immediate');assert.equal(await pending,'ok');assert.equal(calls,2);
 let failed=0;await assert.rejects(()=>slots.wrap('perception',async()=>{failed++;throw Error('semantic failure');})(input),/semantic/);assert.equal(failed,1);
});
