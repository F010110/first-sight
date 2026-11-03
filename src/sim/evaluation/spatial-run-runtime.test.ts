import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {deliveryDueAt,validateRealtimeInterval,attemptArtifact,appendRunRecord,readRunRecords} from './spatial-run-runtime.js';

test('delivery uses projected gaps, starts after initialization and reanchors a recovered suffix',()=>{
 const rows=[{atMs:0},{atMs:2000},{atMs:100000},{atMs:102000}];
 assert.equal(deliveryDueAt(rows,0,0,5000),5000);assert.equal(deliveryDueAt(rows,2,0,5000),105000);
 assert.equal(deliveryDueAt(rows,2,2,500000),500000);assert.equal(deliveryDueAt(rows,3,2,500000),502000);
 assert.doesNotThrow(()=>validateRealtimeInterval(2000));for(const value of [500,1000,3000,10000,NaN])assert.throws(()=>validateRealtimeInterval(value),/only/);
});
test('recovery outputs are unique and cumulative ledgers preserve the first attempt',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/spatial-attempt-'));
 try{
  await writeFile(join(root,'task-timing.json'),'original',{flag:'wx'});
  const name=attemptArtifact('task-timing','attempt-2',true);assert.notEqual(name,'task-timing.json');await writeFile(join(root,name),'recovery',{flag:'wx'});
  await appendRunRecord(root,'delivery.jsonl',{attemptId:'first',observationId:'a'});await appendRunRecord(root,'delivery.jsonl',{attemptId:'second',observationId:'b'});
  assert.equal(await readFile(join(root,'task-timing.json'),'utf8'),'original');assert.equal((await readRunRecords(root,'delivery.jsonl')).length,2);
 }finally{await rm(root,{recursive:true,force:true});}
});
