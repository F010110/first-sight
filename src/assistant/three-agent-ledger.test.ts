import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spatialJsonVlm} from '../agent/spatial-json-vlm.js';

test('reopening a model provider retains budget reservations and never calls network over cap',async()=>{
 const root=await mkdtemp(join(tmpdir(),'three-agent-ledger-'));const previous={key:process.env.QWEN_API_KEY,base:process.env.QWEN_BASE_URL};
 const originalFetch=globalThis.fetch;let networkCalls=0;
 try{
  process.env.QWEN_API_KEY='unit-test-not-a-key';process.env.QWEN_BASE_URL='http://invalid.test';
  globalThis.fetch=async()=>{networkCalls++;throw Error('Must not call network');};
  const requests=join(root,'requests');await mkdir(requests);
  const ledger={calls:1,estimatedUSD:.05,unknownCallsReserved:1};
  await writeFile(join(requests,'usage.json'),JSON.stringify(ledger));
  const bytes=Buffer.from([137,80,78,71,13,10,26,10]);const path=join(root,'header-only.png');await writeFile(path,bytes);
  const request=spatialJsonVlm(requests,1,.1,true);
   await assert.rejects(request({phase:'perception',prompt:'test',data:{current:{id:'a'}},images:[{id:'a',direction:'front',path,sha256:createHash('sha256').update(bytes).digest('hex')}]}),/budget exhausted/);
   const input={phase:'perception' as const,prompt:'test',data:{current:{id:'a'}},images:[{id:'a',direction:'front',path,sha256:createHash('sha256').update(bytes).digest('hex')}]};
   await assert.rejects(request(input),/budget exhausted/);
   await assert.rejects(spatialJsonVlm(requests,1,.1,true)(input),/budget exhausted/);
   assert.ok(!(await readdir(requests)).some(name=>/^\d+$/.test(name)));
   assert.equal((await readFile(join(requests,'budget-denials.jsonl'),'utf8')).trim().split('\n').length,3);
  assert.equal(networkCalls,0);assert.deepEqual(JSON.parse(await readFile(join(requests,'usage.json'),'utf8')),ledger);
 }finally{
  globalThis.fetch=originalFetch;
  for(const [name,value] of [['QWEN_API_KEY',previous.key],['QWEN_BASE_URL',previous.base]] as const)if(value===undefined)delete process.env[name];else process.env[name]=value;
  await rm(root,{recursive:true,force:true});
 }
});

test('source-bound text transport is opt-in and rejects incomplete generations without JSON repair',async()=>{
 const root=await mkdtemp(join(tmpdir(),'source-bound-transport-'));const previous={key:process.env.QWEN_API_KEY,base:process.env.QWEN_BASE_URL};const originalFetch=globalThis.fetch;
 try{
  process.env.QWEN_API_KEY='unit-test-not-a-key';process.env.QWEN_BASE_URL='http://invalid.test';
  const bytes=Buffer.from([137,80,78,71,13,10,26,10]);const path=join(root,'header-only.png');await writeFile(path,bytes);
  let finish='stop';
  globalThis.fetch=async(_url,init)=>{
   const payload=JSON.parse(String(init?.body));assert.equal(payload.response_format,undefined);assert.equal(payload.enable_thinking,false);
   return new Response(JSON.stringify({choices:[{finish_reason:finish,message:{content:'可见砖墙和街道。'}}],usage:{prompt_tokens:100,completion_tokens:20}}),{status:200});
  };
  const input={phase:'perception' as const,responseMode:'text' as const,prompt:'Natural description',data:{current:{id:'a'}},images:[{id:'a',direction:'front',path,sha256:createHash('sha256').update(bytes).digest('hex')}]};
  const request=spatialJsonVlm(join(root,'requests'),3,.1,true,256);
  assert.equal(await request(input),'可见砖墙和街道。');finish='length';await assert.rejects(request(input),/finish normally/);
 }finally{
  globalThis.fetch=originalFetch;for(const [name,value] of [['QWEN_API_KEY',previous.key],['QWEN_BASE_URL',previous.base]] as const)if(value===undefined)delete process.env[name];else process.env[name]=value;
  await rm(root,{recursive:true,force:true});
 }
});

test('JSON transport supplies required JSON keyword even when caller uses only a Chinese schema example',async()=>{
 const root=await mkdtemp(join(tmpdir(),'json-output-contract-')),previous={key:process.env.QWEN_API_KEY,base:process.env.QWEN_BASE_URL},originalFetch=globalThis.fetch;
 let calls=0;
 try{
  process.env.QWEN_API_KEY='unit-test-not-a-key';process.env.QWEN_BASE_URL='http://invalid.test';
  const bytes=Buffer.from([137,80,78,71,13,10,26,10]),path=join(root,'header-only.png');await writeFile(path,bytes);
  globalThis.fetch=async(_url,init)=>{
   calls++;const payload=JSON.parse(String(init?.body));
   assert.equal(payload.response_format.type,'json_object');
   const text=payload.messages[0].content.filter((item:any)=>item.type==='text').map((item:any)=>item.text).join('\n');
   if(!/json/i.test(text))return new Response(JSON.stringify({error:{message:'messages must contain json'}}),{status:400});
   return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"kind":"answer"}'}}],usage:{prompt_tokens:100,completion_tokens:20}}),{status:200});
  };
  const request=spatialJsonVlm(join(root,'requests'),1,.03,true);
  assert.deepEqual(await request({phase:'identity',prompt:'仅回答：{"kind":"answer"}',data:{current:{id:'a'}},images:[{id:'a',direction:'front',path,sha256:createHash('sha256').update(bytes).digest('hex')}]}),{kind:'answer'});
  assert.equal(calls,1);
  assert.equal(JSON.parse(await readFile(join(root,'requests/usage.json'),'utf8')).unknownCallsReserved,0);
 }finally{globalThis.fetch=originalFetch;for(const [name,value] of [['QWEN_API_KEY',previous.key],['QWEN_BASE_URL',previous.base]] as const)if(value===undefined)delete process.env[name];else process.env[name]=value;await rm(root,{recursive:true,force:true});}
});

test('text-only investigation is explicit and cannot silently remove perception images',async()=>{
 const root=await mkdtemp(join(tmpdir(),'text-only-investigation-'));
 try{
  const input={prompt:'Return JSON',data:{current:{id:'a'}},images:[]};
  await assert.rejects(spatialJsonVlm(join(root,'identity'),1,.03)({...input,phase:'identity'}),/needs 1–12 images/);
  await assert.rejects(spatialJsonVlm(join(root,'perception'),1,.03)({...input,phase:'perception',textOnlyIdentity:true}),/cannot disable perception images/);
 }finally{await rm(root,{recursive:true,force:true});}
});
