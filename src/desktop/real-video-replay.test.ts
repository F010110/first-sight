import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {listRealVideos,readRealVideo,realVideoReplay} from './real-video-replay.js';

test('real original videos serve ranges, exclude incomplete packages, reject traversal and changed originals',async()=>{
 const root=await mkdtemp(join(tmpdir(),'real-video-')),folder=join(root,'example');await mkdir(join(folder,'clips'),{recursive:true});await mkdir(join(root,'incomplete'));
 const bytes=Buffer.from('original-video-fixture'),file=join(folder,'clips/0000.mp4');await writeFile(file,bytes);
 await writeFile(join(folder,'manifest.json'),JSON.stringify({schema:'original-real-video-v1',title:'Original',scope:'single camera',cameraCount:1,source:'fixture',durationMs:30000,clips:[{file:'clips/0000.mp4',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),durationMs:30000,sourcePath:'secret-source'}],privatePose:'secret-oracle'}));
 const server=createServer(async(req,res)=>{try{if(!await realVideoReplay(req,res,new URL(req.url!,'http://localhost'),root)){res.writeHead(404);res.end();}}catch{res.writeHead(400);res.end();}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try{
  assert.equal((await listRealVideos(root)).length,1);await assert.rejects(readRealVideo(root,'../example'));
  const manifest=await (await fetch(base+'/api/replay/real-video?id=example')).json() as any;
  assert.equal(manifest.cameraCount,1);assert.equal(manifest.clips.length,1);assert.doesNotMatch(JSON.stringify(manifest),/secret|sha256|folder/);
  const response=await fetch(base+manifest.clips[0].url,{headers:{Range:'bytes=2-5'}});assert.equal(response.status,206);assert.equal(await response.text(),bytes.subarray(2,6).toString());
  assert.equal((await fetch(base+manifest.clips[0].url,{headers:{Range:'bytes=999-'}})).status,416);
  assert.equal((await fetch(base+'/api/replay/real-video-media?id=example&clip=../0')).status,400);
  await writeFile(file,Buffer.alloc(bytes.length));assert.equal((await fetch(base+manifest.clips[0].url)).status,400);
  assert.equal((await fetch(base+'/api/replay/real-videos',{method:'POST'})).status,404);
 }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
