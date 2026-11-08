import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {imageIndexPlaceMatcher} from './visual-revisit.js';

test('persistent matcher bounds in-flight work, times out the real process and closes pending requests',async()=>{
 const root=mkdtempSync(join(tmpdir(),'matcher-timeout-')),script=join(root,'hung.cjs');writeFileSync(script,"require('node:readline').createInterface({input:process.stdin}).on('line',()=>{});");
 const matcher=imageIndexPlaceMatcher(script,{python:process.execPath,timeoutMs:100});
 const image={id:'o',direction:'front',path:'unused',sha256:'unused'},candidates=[{placeId:'p',image}];
 try{
  const first=matcher.match([image],candidates);const second=await matcher.match([image],candidates);assert.equal(second.ok,false);assert.match(second.error!,/in-flight/);
  const timed=await first;assert.equal(timed.ok,false);assert.match(timed.error!,/deadline/);
  const pending=matcher.match([image],candidates);await matcher.close!();assert.equal((await pending).ok,false);
 }finally{await matcher.close!();rmSync(root,{recursive:true,force:true});}
});

test('content-deduplicated image paths cannot steal another place candidate source ID',async()=>{
 const root=mkdtempSync(join(tmpdir(),'matcher-provenance-')),script=join(root,'reply.cjs');
 writeFileSync(script,"require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.op==='close')process.exit(0);console.log(JSON.stringify({id:r.id,ok:true,best:null,nearest:null,results:r.places.map(p=>({id:p.placeId,path:p.members[0].path,inliers:3,similarity:0.1}))}));});");
 const matcher=imageIndexPlaceMatcher(script,{python:process.execPath,timeoutMs:5000}),image={direction:'front',path:'same-content-addressed-image',sha256:'same'};
 try{const result=await matcher.match([{...image,id:'current'}],[{placeId:'place-a',image:{...image,id:'old-a'}},{placeId:'place-b',image:{...image,id:'old-b'}}]);assert.deepEqual(result.results.map(r=>[r.placeId,r.observationId]),[['place-a','old-a'],['place-b','old-b']]);}finally{await matcher.close!();rmSync(root,{recursive:true,force:true});}
});
