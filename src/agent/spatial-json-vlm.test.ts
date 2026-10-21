import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';
import {spatialJsonVlm} from './spatial-json-vlm.js';
test('separated provider sends no chat history, verifies original hashes and accounts capped requests',async()=>{
 const root=await mkdtemp(resolve('cam/local/separated-provider-')),path=join(root,'original.png');
 const bytes=Buffer.from([137,80,78,71,13,10,26,10,1]);await writeFile(path,bytes);
 const oldFetch=globalThis.fetch,key=process.env.QWEN_API_KEY,base=process.env.QWEN_BASE_URL;let calls=0;
 process.env.QWEN_API_KEY='fixture-secret';process.env.QWEN_BASE_URL='https://fixture.invalid';
  globalThis.fetch=async(_url,init)=>{calls++;assert.ok(!String(init!.body).includes('private-original-id'));const payload=JSON.parse(String(init!.body));assert.equal(payload.model,'qwen3.8-flash');assert.equal(payload.enable_thinking,false);assert.equal(payload.messages.length,1);assert.equal(payload.messages[0].content.filter((c:any)=>c.type==='image_url').length,1);return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:20},choices:[{message:{content:'{"ok":true}'}}]}),{status:200});};
 try{
   const input={phase:'perception' as const,prompt:'current only',data:{current:{id:'current',atMs:1}},images:[{id:'current',direction:'front',path,sha256:createHash('sha256').update(bytes).digest('hex')}],metadata:{referenceBindings:[{alias:'S0',originalId:'private-original-id',kind:'source' as const}]}};
  const request=spatialJsonVlm(join(root,'requests'),1,.1);assert.deepEqual(await request(input),{ok:true});
  const receipt=await readFile(join(root,'requests/0000/input.json'),'utf8');assert.ok(!receipt.includes('fixture-secret'));assert.ok(!receipt.includes('base64'));assert.ok(!receipt.includes('history'));
  const usage=JSON.parse(await readFile(join(root,'requests/usage.json'),'utf8'));assert.equal(usage.calls,1);assert.equal(usage.unknownCallsReserved,0);
  await assert.rejects(request(input),/budget exhausted/);assert.equal(calls,1);
  await assert.rejects(spatialJsonVlm(join(root,'tamper'))({...input,images:[{...input.images[0]!,sha256:'0'.repeat(64)}]}),/hash\/PNG mismatch/);assert.equal(calls,1);
  await assert.rejects(spatialJsonVlm(join(root,'history'))({...input,data:{...input.data,oldReason:'poison'}}),/cannot receive history/);assert.equal(calls,1);
  await assert.rejects(spatialJsonVlm(join(root,'reference'))({...input,images:[{...input.images[0]!,id:'past'}]}),/reference images/);assert.equal(calls,1);
  globalThis.fetch=async()=>{calls++;return new Response('{"error":"retained failure"}',{status:400});};
  await assert.rejects(spatialJsonVlm(join(root,'failed'))(input),/HTTP 400/);assert.equal(calls,2);
  const failedUsage=JSON.parse(await readFile(join(root,'failed/usage.json'),'utf8'));assert.equal(failedUsage.calls,1);assert.equal(failedUsage.unknownCallsReserved,1);
  assert.equal(await readFile(join(root,'failed/0000/response.txt'),'utf8'),'{"error":"retained failure"}');
 }finally{globalThis.fetch=oldFetch;if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;if(base===undefined)delete process.env.QWEN_BASE_URL;else process.env.QWEN_BASE_URL=base;await rm(root,{recursive:true,force:true});}
});
