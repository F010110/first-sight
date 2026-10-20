import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {CampusSource} from './campus-source.js';

test('actual campus manifest has 851 observations, three verified PNGs, no GT projection',async()=>{
 const source=await CampusSource.load('run/inspect-repair-full90-v1/model-replay/observations.jsonl');assert.equal(source.length,851);
 const first=await source.read(0);assert.equal(first.id,'a6c325f697fb4e1f9c5c36d8');assert.equal(first.views.length,3);assert.equal(first.views[0]?.mime,'image/png');
 assert.equal('judgmentAvailableAtMs' in first,false);assert.equal('room' in first,false);assert.equal(source.time(1)-source.time(0),2000);
});
test('campus source rejects tampered original hashes and unordered timeline',async()=>{
 const root=await mkdtemp(resolve('cam/local/campus-source-test-'));
 try{
  const [first]= (await readFile('run/inspect-repair-full90-v1/model-replay/observations.jsonl','utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const file=join(root,'input.jsonl');first.sha256.front='0'.repeat(64);await writeFile(file,JSON.stringify(first)+'\n');
  const source=await CampusSource.load(file);await assert.rejects(source.read(0),/hash mismatch/);
  await writeFile(file,JSON.stringify(first)+'\n'+JSON.stringify({...first,id:'duplicate-time'})+'\n');await assert.rejects(CampusSource.load(file),/timeline/);
 }finally{await rm(root,{recursive:true,force:true});}
});
