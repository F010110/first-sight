import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {RealtimeMemory} from '../hardware/realtime-memory.js';import {listRecordings,readRecording,recordingImage,recordingPath} from './live-recordings.js';
test('recorded sessions automatically list originals, persist questions and restrict image paths',async()=>{
 const root=await mkdtemp(join(tmpdir(),'recordings-')),id='11111111-1111-1111-1111-111111111111',directory=join(root,id);await mkdir(join(directory,'capture','frames'),{recursive:true});const path=join(directory,'capture','frames','0.jpg');await writeFile(path,'jpeg');const db=new RealtimeMemory(join(directory,'memory.sqlite'));
 try{assert.deepEqual(await listRecordings(root),[]);db.archive({id:'f',atMs:1000,requestWallTimeMs:1000,receivedAtMs:1100,jpegPath:path,jpegSha256:'hash'});db.commit('f',{placeId:null,groups:[]},2000);db.question('q',{id:'q',atMs:1200,answeredAtMs:2200,question:'test'});
  assert.equal((await listRecordings(root))[0]!.frames,1);assert.equal(readRecording(root,id).rows[0]!.availableAtMs,2000);assert.equal(readRecording(root,id).questions.length,1);assert.equal((await recordingImage(root,id,'f')).bytes.toString(),'jpeg');assert.throws(()=>recordingPath(root,'../escape'));await assert.rejects(recordingImage(root,id,'missing'));
  db.archive({id:'g',atMs:3000,requestWallTimeMs:3000,receivedAtMs:3100,jpegPath:path,jpegSha256:'hash'});
  await writeFile(join(directory,'live-events.jsonl'),[
   {atMs:900,value:{kind:'recording',manual:true,effective:true}},
   {atMs:1500,value:{kind:'recording',manual:false,effective:false}},
   {atMs:2900,value:{kind:'recording',manual:true,effective:true}},
   {atMs:2950,value:{kind:'device-restarted'}},
   {atMs:3500,value:{kind:'recording',manual:false,effective:false}}
  ].map(e=>JSON.stringify(e)).join('\n')+'\n');
  const segments=await listRecordings(root);assert.equal(segments.length,2);assert.equal(segments[0]!.frames,1);assert.equal(segments[0]!.stoppedAtMs,3500);
  assert.equal(readRecording(root,id+'~900').rows[0]!.original.id,'f');assert.equal(readRecording(root,id+'~2900').rows[0]!.original.id,'g');assert.equal((await recordingImage(root,id+'~900','f')).bytes.toString(),'jpeg');await assert.rejects(recordingImage(root,id+'~2900','f'));
 }finally{db.close();await rm(root,{recursive:true,force:true});}
});
