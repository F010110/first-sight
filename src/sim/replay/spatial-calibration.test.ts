import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

test('calibration: usage accounting, pre-call budget denial and missing-usage halt',async()=>{
 const root=await mkdtemp(join(tmpdir(),'calibration-test-'));let calls=0,omitUsage=false;
 const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const request=JSON.parse(body);calls++;
  assert.equal(request.enable_thinking,false);assert.equal(request.model,'qwen3.8-flash');
  const content=request.messages[0].content as Array<{text?:string}>;
   const ids=content.flatMap(c=>c.text?.startsWith('CURRENT_TARGET ')?[c.text.split(' ')[1]!.replace(/^observationId=/,'')]:[]);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({places:[{id:'new-1',summary:'mock room'}],assignments:ids.map(id=>({observationId:id,placeId:'new-1',reason:'mock only'}))})}}],...(!omitUsage?{usage:{prompt_tokens:1000,completion_tokens:100}}:{})}));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address!=='string');
 try{
  const image=join(root,'frame.png');await writeFile(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
  await writeFile(join(root,'observations.jsonl'),JSON.stringify({id:'o1',sessionId:'s1',atMs:0,cameras:{front:'frame.png',left:'frame.png',right:'frame.png'}}));
   const extractor=join(root,'extract.cjs');await writeFile(extractor,`let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{console.log(JSON.stringify(JSON.parse(s).map(o=>({id:o.id,features:[Array(72).fill(0)]}))));});`);
    const run=async(name:string,maxCost:number,review=false,resume=false)=>{
    const config=join(root,name+'.json');await writeFile(config,JSON.stringify({inputPerMillion:1,outputPerMillion:4,maxCost,maxWindows:1,maxObservations:1,currency:'test-unit',...review?{identityReview:true,visualRecall:{command:process.execPath,args:[extractor]}}:{}}));
    const child=spawn(process.execPath,[new URL('./spatial-calibration.js',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),root,join(root,name),config,'--confirm-paid',...resume?['--resume']:[]],{env:{...process.env,QWEN_API_KEY:'mock',QWEN_BASE_URL:`http://127.0.0.1:${address.port}`},stdio:'pipe'});
   let stderr='';child.stderr.on('data',c=>stderr+=c);const code=await new Promise<number|null>(r=>child.on('close',r));return {code,stderr};
  };
  assert.equal((await run('success',1)).code,0);assert.equal(calls,1);
   const usage=JSON.parse(await readFile(join(root,'success','usage.json'),'utf8'));assert.equal(usage.inputTokens,1000);assert.equal(usage.estimatedCost,0.0014);
   assert.equal((await run('success',1,false,true)).code,0);assert.equal(calls,1,'resume must not re-bill committed observations');
  assert.notEqual((await run('denied',0.01)).code,0);assert.equal(calls,1);
  omitUsage=true;assert.notEqual((await run('unknown',1)).code,0);assert.equal(calls,2);
    assert.equal(JSON.parse(await readFile(join(root,'unknown','usage.json'),'utf8')).unknownUsage,true);
    omitUsage=false;
    assert.equal((await run('unknown',1,false,true)).code,0);assert.equal(calls,3,'pending observations must be recovered without duplicate ingest');
    assert.equal(JSON.parse(await readFile(join(root,'unknown','usage.json'),'utf8')).priorUnresolvedCallsReserved,1);
    assert.notEqual((await run('review-denied',0.3,true)).code,0);assert.equal(calls,3);
    assert.equal((await run('review-success',1,true)).code,0);assert.equal(calls,5);
   const reviewed=JSON.parse(await readFile(join(root,'review-success','usage.json'),'utf8'));assert.equal(reviewed.maximumProviderCalls,4);assert.equal(reviewed.inputTokens,2000);assert.equal(reviewed.estimatedCost,0.0028);assert.equal(reviewed.reservationPerWindow,0.5408);
 }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
