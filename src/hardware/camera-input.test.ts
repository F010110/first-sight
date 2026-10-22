import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {cameraObservation,CameraWindows} from './camera-input.js';
import {spatialWindows} from '../agent/spatial-window-schedule.js';

test('streaming hardware windows match existing replay schedule, including final flush',()=>{
 for(const gap of [2000,4000,15000])for(const count of [1,4,12,30]){
  const rows=Array.from({length:count},(_,i)=>({id:String(i),atMs:i*gap,recordingId:'r',frames:['front.jpg']}));
  const scheduler=new CameraWindows();
  assert.deepEqual([...rows.flatMap(row=>scheduler.push(row)),...scheduler.finish()],spatialWindows(rows));
 }
});
test('hardware adapter delivers one actual view and rejects corrupt or out-of-archive images',async()=>{
 const root=await mkdtemp(join(tmpdir(),'camera-input-'));
 try{
  await mkdir(join(root,'frames'));const frame=join(root,'frames','0.jpg'),bytes=Buffer.from([255,216,0,255,217]);await writeFile(frame,bytes);
  const row={id:'r:0',recordingId:'r',atMs:0,sourceAtMs:0,frames:[frame],sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,sequence:0,receivedAtMs:2500,timestampSource:'host-request',exposureTimeKnown:false,direction:'front'};
   const observation=await cameraObservation(row,root);assert.deepEqual(observation.frames,[frame]);assert.equal(observation.atMs,0);
   const wifi={...row,transport:'wifi-single-http',wireSha256:row.sha256,deviceBootId:'boot',deviceSequence:0,deviceCaptureMs:123,deviceClockAligned:false,width:640,height:480};
   assert.deepEqual((await cameraObservation(wifi,root)).frames,[frame]);
   for(const bad of [{wireSha256:'wrong'},{deviceSequence:1},{deviceBootId:''},{deviceClockAligned:true},{deviceCaptureMs:-1}])await assert.rejects(cameraObservation({...wifi,...bad},root),/single Wi-Fi/);
  await assert.rejects(cameraObservation({...row,sha256:'bad'},root),/integrity/);
  await assert.rejects(cameraObservation({...row,frames:[join(root,'outside.jpg')]},root),/outside/);
  await assert.rejects(cameraObservation({...row,exposureTimeKnown:true},root),/Invalid/);
  await assert.rejects(cameraObservation({...row,frames:[frame,frame,frame]},root),/Invalid/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('hardware scheduling rejects duplicate timestamps and unannounced device sessions',()=>{
 const scheduler=new CameraWindows(),row={id:'a',atMs:0,recordingId:'r',frames:['front.jpg']};scheduler.push(row);
 assert.throws(()=>scheduler.push({...row,id:'b'}),/Duplicate/);
 assert.throws(()=>scheduler.push({...row,id:'c',atMs:2000,recordingId:'restart'}),/session/);
});

test('Wi-Fi input accepts three independent archived paths, not duplicate views or excessive dispatch skew',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wifi-input-'));
 try{
  await mkdir(join(root,'frames'));
  const cameras=[];
  for(const [index,direction] of ['front','left','right'].entries()){
   const frame=join(root,'frames',direction+'.jpg'),bytes=Buffer.from([255,216,index,255,217]);await writeFile(frame,bytes);
   cameras.push({direction,cameraId:direction,deviceClockAligned:false,frame,requestAtMs:100+index*10,receivedAtMs:800+index*10,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
  }
  const row={id:'r:0',recordingId:'r',transport:'wifi-http',atMs:100,sourceAtMs:100,timestampSource:'host-request',exposureTimeKnown:false,frames:cameras.map(c=>c.frame),cameras,dispatchSkewMs:20,maxDispatchSkewMs:250};
  const observation=await cameraObservation(row,root);assert.equal(observation.frames.length,3);
  await assert.rejects(cameraObservation({...row,dispatchSkewMs:300},root),/Invalid/);
  await assert.rejects(cameraObservation({...row,cameras:[cameras[0],cameras[0],cameras[2]]},root),/Invalid/);
  await assert.rejects(cameraObservation({...row,exposureTimeKnown:true},root),/Invalid/);
 }finally{await rm(root,{recursive:true,force:true});}
});
