import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {SpatialContextMemory} from './spatial-context-memory.js';import {SpatialSqliteStore} from './spatial-sqlite-store.js';import {SpatialContextLoop} from './spatial-context-loop.js';
test('real SQLite double-write, reassessment, actual retriever, reopen and original retention',async()=>{
 const root=await mkdtemp(join(tmpdir(),'context-store-')),path=join(root,'memory.sqlite'),image=join(root,'image.png');await writeFile(image,'original');let memory=new SpatialContextMemory(path);
 try{
  const a={id:'a',atMs:1,frames:[image]},b={id:'b',atMs:2,frames:[image]};await memory.writeObservation(a);const first=await memory.writeAssessment({observationId:'a',atMs:1,placeId:'new',reason:'yellow hall',sourceIds:['a']});assert.notEqual(first.placeId,'new');
  await memory.writeOutput(1,{question:'用户问题',answer:'先前回答',abstained:false});
  await memory.writeObservation(b);await memory.writeAssessment({observationId:'b',atMs:2,placeId:first.placeId,reason:'yellow hall',sourceIds:['b']});
  const hits=await memory.search('yellow',2);assert.deepEqual(hits.map(h=>h.id),['a']);const evidence=await memory.inspect(['a'],2);assert.equal(evidence[0]?.images[0]?.data,Buffer.from('original').toString('base64'));
  await memory.writeAssessment({observationId:'b',atMs:2,placeId:null,reason:'identity uncertain',sourceIds:['b']});memory.close();memory=new SpatialContextMemory(path);await memory.writeObservation(b);
  const store=new SpatialSqliteStore(path);assert.equal(store.assignment('b')?.placeId,null);assert.equal(store.assignment('b')?.reason,'identity uncertain');assert.deepEqual(store.observation('a'),a);assert.equal(store.counts().observations,2);store.close();
  const direct=await memory.inspect(['a'],2);assert.equal(direct[0]?.images.length,1);
  const prior=await memory.search('先前回答',2);const statement=prior.find(e=>e.kind==='model-statement');assert.ok(statement);const read=await memory.inspect([statement.id],2);assert.equal(read[0]?.kind,'model-statement');assert.equal(read[0]?.images.length,0);
 }finally{memory.close();await rm(root,{recursive:true,force:true});}
});
