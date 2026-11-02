import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import type {Server} from 'node:http';
import {createAnnotationReviewServer} from './annotation-review-server.js';

const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'annotation-review-')),images=join(root,'originals');await mkdir(images);
 const bytes=Buffer.from([137,80,78,71,13,10,26,10]);const path=join(images,'frame.png');await writeFile(path,bytes);
 const views=Object.fromEntries(['front','left','right'].map(v=>[v,'/image/frame-a/'+v]));
 const sample={schema:'unioncity-annotation-review-v1',provenance:{oracleOnly:true},frames:[{id:'frame-a',views}],segments:[{id:'segment-001'}],revisits:[{id:'revisit-1'}],map:{layers:[{id:'street'}]}};
 const raw=Buffer.from(JSON.stringify(sample));await writeFile(join(root,'sample.json'),raw);await writeFile(join(root,'map-street.png'),bytes);
 await writeFile(join(root,'integrity.json'),JSON.stringify({sampleSHA256:hash(raw),maps:{street:hash(bytes)}}));
 await writeFile(join(root,'bindings.json'),JSON.stringify({allowedImageRoot:images,bindings:Object.fromEntries(['front','left','right'].map(v=>['frame-a/'+v,{path,sha256:hash(bytes)}]))}));
 return {root,path,raw,cleanup:()=>rm(root,{recursive:true,force:true})};
}
async function listen(server:Server){await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${(server.address() as {port:number}).port}`;}
async function close(server:Server){await new Promise<void>(r=>server.close(()=>r()));}

test('memory verdicts bind immutable cases, allow independent human review but never annotation edits',async()=>{
 const f=await fixture();let server:Server|undefined;
 try{
  const bytes=Buffer.from(JSON.stringify([{id:'frame-a',reference:{annotation:{placeId:'street'}},candidate:{summary:'街道'},structure:{sourceObservations:[]}}]));await writeFile(join(f.root,'memory-cases.json'),bytes);const sample=JSON.parse(f.raw.toString());sample.provenance.memoryEvaluation=true;sample.provenance.memoryCasesSHA256=hash(bytes);const raw=Buffer.from(JSON.stringify(sample));await writeFile(join(f.root,'sample.json'),raw);const integrity=JSON.parse(await readFile(join(f.root,'integrity.json'),'utf8'));await writeFile(join(f.root,'integrity.json'),JSON.stringify({...integrity,sampleSHA256:hash(raw)}));
  server=await createAnnotationReviewServer(f.root);const base=await listen(server),state=await(await fetch(base+'/api/sample')).json() as any;
  const item=await(await fetch(base+'/api/memory?id=frame-a')).json() as any;assert.equal(item.grade,null);assert.equal(item.candidate.summary,'街道');assert.equal((await fetch(base+'/api/memory?id=../secrets')).status,404);
  const headers={'Content-Type':'application/json',Origin:base,'X-Review-Token':state.reviewToken},body={expectedRevision:0,targetType:'observation',targetId:'frame-a',status:'uncertain',note:'独立人工审核'};
  assert.equal((await fetch(base+'/api/reviews',{method:'POST',headers,body:JSON.stringify({...body,correctedLabel:'替换标准'})})).status,400);
  assert.equal((await fetch(base+'/api/reviews',{method:'POST',headers,body:JSON.stringify(body)})).status,200);assert.deepEqual(await readFile(join(f.root,'memory-cases.json')),bytes);
  await close(server);server=await createAnnotationReviewServer(f.root);const reopened=await listen(server);assert.equal(((await(await fetch(reopened+'/api/sample')).json()) as any).reviews[0].note,body.note);
 }finally{if(server)await close(server);await f.cleanup();}
});

test('oracle review serves only bound images and persists versioned user corrections without modifying base',async()=>{
 const f=await fixture();let server=await createAnnotationReviewServer(f.root);let base=await listen(server);
 try{
  const state=await(await fetch(base+'/api/sample')).json() as any;assert.equal(state.revision,0);assert.equal(state.sample.provenance.oracleOnly,true);assert.ok(!JSON.stringify(state.sample).includes(f.root));
  assert.equal((await fetch(base+'/image/frame-a/front')).status,200);assert.equal((await fetch(base+'/map/street.png')).status,200);assert.equal((await fetch(base+'/image/not-bound/front')).status,404);assert.equal((await fetch(base+'/bindings.json')).status,404);
  const body={expectedRevision:0,targetType:'observation',targetId:'frame-a',status:'needs-change',note:'用户修订',correctedDescription:'仅有砖墙，无法确认动作'};
  assert.equal((await fetch(base+'/api/reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,403);
  const headers={'Content-Type':'application/json',Origin:base,'X-Review-Token':state.reviewToken};
  assert.equal((await fetch(base+'/api/reviews',{method:'POST',headers,body:JSON.stringify(body)})).status,200);
  assert.equal((await fetch(base+'/api/reviews',{method:'POST',headers,body:JSON.stringify(body)})).status,409);
  assert.deepEqual(await readFile(join(f.root,'sample.json')),f.raw);
  await close(server);server=await createAnnotationReviewServer(f.root);base=await listen(server);
  const reopened=await(await fetch(base+'/api/export')).json() as any;assert.equal(reopened.revision,1);assert.equal(reopened.reviews[0].correctedDescription,body.correctedDescription);
  await writeFile(f.path,'tampered');assert.equal((await fetch(base+'/image/frame-a/front')).status,409);
 }finally{await close(server);await f.cleanup();}
});

test('review mutations reject cross-origin, unknown fields/targets and changed base integrity',async()=>{
 const f=await fixture();const server=await createAnnotationReviewServer(f.root),base=await listen(server);
 try{
  const state=await(await fetch(base+'/api/sample')).json() as any;const body={expectedRevision:0,targetType:'segment',targetId:'segment-001',status:'approved',note:''};
  const request=(value:any,origin=base)=>fetch(base+'/api/reviews',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'X-Review-Token':state.reviewToken},body:JSON.stringify(value)});
  assert.equal((await request(body,'https://foreign.example')).status,403);
  assert.equal((await request({...body,targetId:'unknown'})).status,400);
  assert.equal((await request({...body,correctedDescription:'cannot replace all frame descriptions'})).status,400);
  assert.equal((await request({...body,filename:'../../sample.json'})).status,400);
  await writeFile(join(f.root,'sample.json'),'{}');await assert.rejects(createAnnotationReviewServer(f.root),/base changed/);
 }finally{await close(server);await f.cleanup();}
});

test('completed rerender annotations are read-only even with a valid same-origin review token',async()=>{
 const f=await fixture();const sample=JSON.parse(f.raw.toString());sample.reviewRequired=false;const raw=Buffer.from(JSON.stringify(sample));
 await writeFile(join(f.root,'sample.json'),raw);const integrity=JSON.parse(await readFile(join(f.root,'integrity.json'),'utf8'));integrity.sampleSHA256=hash(raw);await writeFile(join(f.root,'integrity.json'),JSON.stringify(integrity));
 const server=await createAnnotationReviewServer(f.root),base=await listen(server);
 try{
  const state=await(await fetch(base+'/api/sample')).json() as any;
  const response=await fetch(base+'/api/reviews',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Review-Token':state.reviewToken},body:JSON.stringify({expectedRevision:0,targetType:'observation',targetId:'frame-a',status:'approved',note:''})});
  assert.equal(response.status,405);assert.equal((await(await fetch(base+'/api/sample')).json() as any).revision,0);
 }finally{await close(server);await f.cleanup();}
});
