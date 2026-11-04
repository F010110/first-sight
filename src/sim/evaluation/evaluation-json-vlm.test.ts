import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
import {evaluationJsonVlm} from './evaluation-json-vlm.js';
test('Qwen review uses the configured same-version Max without changing the Flash producer',async()=>{
 const root=await mkdtemp(resolve('cam/local/qwen-max-review-')),path=join(root,'original.png'),bytes=Buffer.from([137,80,78,71,13,10,26,10,1]);await writeFile(path,bytes);
 const fetchBefore=globalThis.fetch,key=process.env.QWEN_API_KEY,base=process.env.QWEN_BASE_URL;process.env.QWEN_API_KEY='qwen-test';process.env.QWEN_BASE_URL='https://qwen-fixture.invalid/v1';let calls=0;
 globalThis.fetch=async(url,input)=>{calls++;assert.equal(String(url),'https://qwen-fixture.invalid/v1/chat/completions');const body=JSON.parse(String(input!.body));assert.equal(body.model,'qwen3.8-max-0902');assert.equal(body.enable_thinking,false);return new Response(JSON.stringify({model:body.model,usage:{prompt_tokens:1,completion_tokens:1},choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]}));};
 try{
  const request=evaluationJsonVlm(join(root,'requests'),3,{transport:'qwen'}),images=[{id:'one',direction:'front',path,sha256:createHash('sha256').update(bytes).digest('hex')}];
  await assert.rejects(request('qwen3.8-flash','JSON',{},images),/same-version Max/);
  assert.deepEqual(await request('qwen3.8-max-0902','JSON',{},images),{ok:true});assert.equal(calls,1);
 }finally{globalThis.fetch=fetchBefore;if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;if(base===undefined)delete process.env.QWEN_BASE_URL;else process.env.QWEN_BASE_URL=base;await rm(root,{recursive:true,force:true});}
});
test('parallel evaluation requests preserve separate provenance and usage without leaking credentials',async()=>{
 const root=await mkdtemp(resolve('cam/local/ensemble-provider-')),path=join(root,'original.png'),bytes=Buffer.from([137,80,78,71,13,10,26,10,1]);await writeFile(path,bytes);
 const fetchBefore=globalThis.fetch,key=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='secret-for-test';
 globalThis.fetch=async(_url,input)=>{const body=JSON.parse(String(input!.body));return new Response(JSON.stringify({model:body.model,provider:'fixture',usage:{prompt_tokens:1,completion_tokens:1},choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]}));};
 try{
  const request=evaluationJsonVlm(join(root,'requests'),3),images=[{id:'one',direction:'front',path,sha256:createHash('sha256').update(bytes).digest('hex')}];
  await Promise.all([request('model-a','JSON',{},images),request('model-b','JSON',{},images)]);
  const a=await readFile(join(root,'requests/0000/input.json'),'utf8'),b=await readFile(join(root,'requests/0001/input.json'),'utf8');
  assert.equal(JSON.parse(a).model,'model-a');assert.equal(JSON.parse(b).model,'model-b');assert.ok(!a.includes('secret-for-test'));
  const usage=JSON.parse(await readFile(join(root,'requests/usage.json'),'utf8'));assert.equal(usage.calls,2);assert.equal(usage.unknownCallsReserved,0);
 }finally{globalThis.fetch=fetchBefore;if(key===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=key;await rm(root,{recursive:true,force:true});}
});

test('Flash judge is refused unless explicitly opted in, and then records a list-price estimate',async()=>{
 const {mkdtemp,rm,writeFile}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const root=await mkdtemp(join(tmpdir(),'opencode/flash-judge-')),originalFetch=globalThis.fetch,key=process.env.QWEN_API_KEY,base=process.env.QWEN_BASE_URL;
 process.env.QWEN_API_KEY='fixture';process.env.QWEN_BASE_URL='https://fixture.invalid/v1';let body:any=null;
 try{
  globalThis.fetch=async(_url,input)=>{body=JSON.parse(String(input!.body));return new Response(JSON.stringify({model:body.model,usage:{prompt_tokens:1000000,completion_tokens:1000000},choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]}));};
  await assert.rejects(evaluationJsonVlm(join(root,'strict'),2,{transport:'qwen',allowTextOnly:true})('qwen3.8-flash','JSON',{},[]),/allowFlash/);
  const request=evaluationJsonVlm(join(root,'allowed'),2,{transport:'qwen',allowTextOnly:true,allowFlash:true});
  assert.deepEqual(await request('qwen3.8-flash','JSON',{},[]),{ok:true});assert.equal(body.model,'qwen3.8-flash');
  const usage=JSON.parse(await readFile(join(root,'allowed','usage.json'),'utf8'));assert.equal(usage.estimatedUSD,Number((.1356+.4584).toFixed(8)));assert.match(usage.authority,/list-price estimate/);
  await assert.rejects(request('qwen3.8-turbo','JSON',{},[]),/allowFlash/);
 }finally{globalThis.fetch=originalFetch;if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;if(base===undefined)delete process.env.QWEN_BASE_URL;else process.env.QWEN_BASE_URL=base;await rm(root,{recursive:true,force:true});}
});
