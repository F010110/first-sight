import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {SpatialSqliteStore} from '../../agent/spatial-sqlite-store.js';

test('QA acceptance stops after first failure and preserves trace instead of billing next case',async()=>{
 const root=await mkdtemp(join(tmpdir(),'qa-acceptance-'));let calls=0;let missingFlag=false;
 const server=createServer(async(req,res)=>{
  let input='';for await(const c of req)input+=c;const body=JSON.parse(input);assert.equal(body.enable_thinking,false);calls++;
  res.setHeader('Content-Type','text/event-stream');
  const content=missingFlag?JSON.stringify({kind:'question',answer:'unsupported',done:true,historicalEvidenceIds:[]}):'invalid JSON';
  res.end(`data: ${JSON.stringify({id:'r',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})}\n\ndata: [DONE]\n\n`);
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address!=='string');
 try{
  await writeFile(join(root,'frame.png'),'fixture');await writeFile(join(root,'observations.jsonl'),JSON.stringify({id:'o',atMs:10,cameras:{front:'frame.png'}}));
  const dbPath=join(root,'memory.sqlite');const db=new SpatialSqliteStore(dbPath);db.close();
  const plan=join(root,'plan.json');await writeFile(plan,JSON.stringify(['first','second'].map(id=>({id,question:'past?',asOfMs:5,recordingId:'r',currentId:'o'}))));
  for(const missing of [false,true]){missingFlag=missing;
  const output=join(root,missing?'missing-flag':'output');const child=spawn(process.execPath,[new URL('./spatial-qa-acceptance.js',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),dbPath,root,plan,output,'--confirm-paid'],{env:{...process.env,QWEN_API_KEY:'mock',QWEN_BASE_URL:`http://127.0.0.1:${address.port}`},stdio:'pipe'});
  let errors='';child.stderr.on('data',c=>errors+=c);const code=await new Promise<number|null>(r=>child.on('close',r));assert.equal(code,0,errors);
   // Missing metadata now permits one locked continuation within the FIRST
   // case. It must still fail and never advance to the second planned case.
   const result=JSON.parse(await readFile(join(output,'results.json'),'utf8'));assert.equal(result.length,1);assert.ok(result[0].error);assert.equal(calls,missing?3:1);if(missing)assert.match(result[0].error,/HistoricalAnswerValidationError: Error: Invalid metadata-only patch/);
  const summary=JSON.parse(await readFile(join(output,'complete.json'),'utf8'));assert.equal(summary.status,'stopped-on-error');assert.equal(summary.processedCases,1);assert.equal(summary.plannedCases,2);
  assert.ok(JSON.parse(await readFile(join(output,'first-trace.json'),'utf8')).length>0);
  }
 }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
