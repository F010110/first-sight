import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

test('capture runner validates committed receipts, never invents missing views, and rejects duplicate receipts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hardware-run-'));
 try{
  const capture=join(root,'capture');await mkdir(join(capture,'frames'),{recursive:true});
  const bytes=Buffer.from([255,216,0,255,217]),frame=join(capture,'frames','0.jpg');await writeFile(frame,bytes);
  const row={id:'r:0',recordingId:'r',atMs:0,sourceAtMs:0,frames:[frame],sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,sequence:0,receivedAtMs:2500,timestampSource:'host-request',exposureTimeKnown:false,direction:'front'};
  await writeFile(join(capture,'plan.json'),JSON.stringify({schemaVersion:1,recordingId:'r',timestampSource:'host-request',exposureTimeKnown:false,requestedFrames:1}));
  await writeFile(join(capture,'observations.jsonl'),JSON.stringify(row)+'\n');
  await writeFile(join(capture,'complete.json'),JSON.stringify({status:'captured',frames:1}));
  async function run(out:string){return await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,[new URL('./run-camera.js',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),capture,out,'--validate-only'],{stdio:'pipe'});child.on('error',reject);child.on('close',resolve);});}
  const out=join(root,'valid');assert.equal(await run(out),0);
  assert.equal(JSON.parse(await readFile(join(out,'complete.json'),'utf8')).observations,1);
  const accepted=JSON.parse(await readFile(join(out,'accepted.jsonl'),'utf8'));assert.equal(accepted.observation.frames.length,1);
  // Same ID under the next sequence must not be assessed or overwritten.
  await writeFile(join(capture,'plan.json'),JSON.stringify({schemaVersion:1,recordingId:'r',timestampSource:'host-request',exposureTimeKnown:false,requestedFrames:2}));
  await writeFile(join(capture,'observations.jsonl'),JSON.stringify(row)+'\n'+JSON.stringify({...row,sequence:1,atMs:4000,sourceAtMs:4000,receivedAtMs:6500})+'\n');
  const invalid=join(root,'invalid');assert.notEqual(await run(invalid),0);
  assert.match(JSON.parse(await readFile(join(invalid,'stopped.json'),'utf8')).error,/duplicate/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Wi-Fi paid use is blocked without explicit unverified exposure-sync acknowledgement',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wifi-gate-'));
 try{
  const capture=join(root,'capture');await mkdir(capture);
  await writeFile(join(capture,'plan.json'),JSON.stringify({schemaVersion:1,transport:'wifi-http',recordingId:'r',timestampSource:'host-request',exposureTimeKnown:false,requestedFrames:1}));
  const result=await new Promise<{code:number|null;stderr:string}>((resolve,reject)=>{
   const child=spawn(process.execPath,[new URL('./run-camera.js',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),capture,join(root,'output'),'--confirm-paid'],{env:{...process.env,QWEN_API_KEY:'test-no-network',QWEN_BASE_URL:'http://127.0.0.1:1'},stdio:'pipe'});
   let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('close',code=>resolve({code,stderr}));
  });
  assert.notEqual(result.code,0);assert.match(result.stderr,/requires --allow-unverified-sync/);
 }finally{await rm(root,{recursive:true,force:true});}
});
