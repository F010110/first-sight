import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spatialV2Vlm } from './spatial-v2-vlm.js';

test('v2 rejects historical reference assignment and explicitly repairs target whitelist',async()=>{
 const root=await mkdtemp(join(tmpdir(),'strict-target-'));let calls=0;
 const previous={key:process.env.QWEN_API_KEY,base:process.env.QWEN_BASE_URL};
 const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const payload=JSON.parse(body);calls++;
  assert.ok(payload.messages[0].content.some((c:{text?:string})=>c.text?.includes('当前目标若与这里相同，应复用这个placeId')));
   assert.ok(!payload.messages[0].content.some((c:{text?:string})=>c.text?.includes('REFERENCE_ONLY 禁止分类')));
   if(calls<=2)assert.equal(payload.messages[0].content.filter((c:{text?:string})=>c.text?.startsWith('RECENT_TEMPORAL_CONTEXT')).length,1);
  if(calls===2||calls===4)assert.match(payload.messages.at(-1).content,/EXACTLY/);
  const assignments=[{observationId:'current',placeId:'p1',reason:'fixture'}];if(calls===1||calls>=3)assignments.push({observationId:'old',placeId:'p1',reason:'invalid historical assignment'});
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({places:[],assignments})}}],usage:{prompt_tokens:100,completion_tokens:30}}));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address!=='string');
 process.env.QWEN_API_KEY='mock';process.env.QWEN_BASE_URL=`http://127.0.0.1:${address.port}`;
 try{const image=join(root,'image.png');await writeFile(image,Buffer.from('fixture'));
  const row={id:'current',atMs:10,frames:[image]};const old={id:'old',atMs:0,frames:[image]};
   const history={version:1 as const,nodes:[{id:'p1',summary:'fixture',lastSeenMs:0,representatives:[old]}],observations:[{...old,id:'prior',atMs:5},{...old,id:'equal-time',atMs:10},{...old,id:'other-recording',recordingId:'other'}],pending:[],assignments:[],edges:[],currentPlaceId:'p1',revisions:[]};
   const result=await spatialV2Vlm(join(root,'requests'))([row],history);
  assert.equal(calls,2);assert.deepEqual(result.assignments.map(a=>a.observationId),['current']);
  await assert.rejects(()=>spatialV2Vlm(join(root,'persistent-invalid'))([row],{version:1,nodes:[{id:'p1',summary:'fixture',lastSeenMs:0,representatives:[old]}],observations:[],pending:[],assignments:[],edges:[],currentPlaceId:'p1',revisions:[]}),/EXACTLY/);
   assert.equal(calls,4);
   await assert.rejects(()=>spatialV2Vlm(join(root,'empty'))([],history),/window budget/);
   await assert.rejects(()=>spatialV2Vlm(join(root,'too-many-frames'))([{...row,frames:Array(4).fill(image)}],history),/camera group budget/);assert.equal(calls,4);
 }finally{
  if(previous.key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=previous.key;
  if(previous.base===undefined)delete process.env.QWEN_BASE_URL;else process.env.QWEN_BASE_URL=previous.base;
  await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});
 }
});
