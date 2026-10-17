import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,mkdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SpatialEvidenceRetriever } from './spatial-evidence-retrieve.js';

test('raw evidence: unclassified search, strict scope, restart, inspect integrity and citations',async()=>{
 const root=await mkdtemp(join(tmpdir(),'raw-evidence-'));
 try{
  await mkdir(join(root,'images'));const bytes=Buffer.from('image-fixture');await writeFile(join(root,'images','a.png'),bytes);await writeFile(join(root,'complete.json'),'{}');
  const db=new DatabaseSync(join(root,'evidence.sqlite'));db.exec('CREATE TABLE observations(seq INTEGER PRIMARY KEY,id TEXT,session TEXT,at_ms REAL,raw TEXT)');
  for(let i=0;i<4;i++){const e={id:`o${i}`,sessionId:i===3?'other':'r',atMs:i*2,cameras:Object.fromEntries(['front','left','right'].map(v=>[v,'images/a.png'])),sha256:Object.fromEntries(['front','left','right'].map(v=>[v,createHash('sha256').update(bytes).digest('hex')]))};db.prepare('INSERT INTO observations VALUES(?,?,?,?,?)').run(i+1,e.id,e.sessionId,e.atMs,JSON.stringify(e));}db.close();
  let retriever=new SpatialEvidenceRetriever(root);retriever.close();retriever=new SpatialEvidenceRetriever(root);
  try{
   assert.throws(()=>retriever.session({asOfMs:5}),/recording/);
   const session=retriever.session({asOfMs:4,recordingId:'r'},3);
   assert.equal(session.search({query:'classroom'}).status,'unknown');
   const found=session.search({limit:1});assert.equal(found.hits[0]!.id,'o0');assert.equal(found.hits[0]!.placeId,null);
   assert.deepEqual(session.search({cursor:found.nextCursor!,limit:4}).hits.map(h=>h.id),['o1']);
   await assert.rejects(()=>session.inspect(['o2']),/retrieved/);assert.throws(()=>session.validateCitations(['o0']));
   const images=await session.inspect(['o0']);assert.equal(images.length,3);assert.equal(images[0]!.data,bytes.toString('base64'));session.validateCitations(['o0']);
   await assert.rejects(()=>session.inspect(['o1']),/budget/);
   const fresh=retriever.session({asOfMs:4,recordingId:'r'});fresh.search();await writeFile(join(root,'images','a.png'),'tampered');await assert.rejects(()=>fresh.inspect(['o0']),/integrity/);assert.throws(()=>fresh.validateCitations(['o0']));
  }finally{retriever.close();}
 }finally{await rm(root,{recursive:true,force:true});}
});
