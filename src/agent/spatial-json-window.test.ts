import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spatialJsonVlm} from './spatial-json-vlm.js';

test('window images carry explicit current-window time labels, not misleading historical reference labels',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/window-json-')),beforeFetch=globalThis.fetch,key=process.env.QWEN_API_KEY,base=process.env.QWEN_BASE_URL;
 process.env.QWEN_API_KEY='mock';process.env.QWEN_BASE_URL='https://mock.invalid';let calls=0;
 try{
  const bytes=Buffer.from([137,80,78,71,13,10,26,10]),path=join(root,'original.png');await writeFile(path,bytes);
  const images=['a','b','history'].map(id=>({id,direction:'front',path,sha256:createHash('sha256').update(bytes).digest('hex')}));
  globalThis.fetch=async(_url,init)=>{calls++;const payload=JSON.parse(init!.body as string),text=payload.messages[0].content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n');assert.match(text,/CURRENT_WINDOW sourceId=a direction=front atMs=0/);assert.match(text,/CURRENT_WINDOW sourceId=b direction=front atMs=2000/);assert.match(text,/REFERENCE sourceId=history/);return new Response(JSON.stringify({choices:[{message:{content:'{}'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:2}}));};
  const request=spatialJsonVlm(join(root,'requests'),2,.1);
  await request({phase:'identity',prompt:'JSON',data:{current:{id:'b',atMs:2000}},images,windowSources:[{id:'a',atMs:0},{id:'b',atMs:2000}]});
  await assert.rejects(request({phase:'identity',prompt:'JSON',data:{current:{id:'b',atMs:2000}},images,windowSources:[{id:'a',atMs:3000},{id:'b',atMs:2000}]}),/window source bindings/);assert.equal(calls,1);
  globalThis.fetch=async(_url,init)=>{calls++;const payload=JSON.parse(init!.body as string);assert.equal(payload.messages.length,1);assert.match(payload.messages[0].content[0].text,/"observations"/);return new Response(JSON.stringify({choices:[{message:{content:'{"observations":[]}'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:2}}));};
  const batch=spatialJsonVlm(join(root,'batch'),2,.1),sources=[{id:'a',atMs:0},{id:'b',atMs:2000}];
  await batch({phase:'perception',prompt:'JSON',data:{current:{id:'b',atMs:2000},observations:sources},windowSources:sources,images:images.slice(0,2)});
  await assert.rejects(batch({phase:'perception',prompt:'JSON',data:{current:{id:'b',atMs:2000},observations:sources,workingContext:{guess:'old place'}},windowSources:sources,images:images.slice(0,2)}),/cannot receive history/);assert.equal(calls,2);
 }finally{globalThis.fetch=beforeFetch;if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;if(base===undefined)delete process.env.QWEN_BASE_URL;else process.env.QWEN_BASE_URL=base;await rm(root,{recursive:true,force:true});}
});
