import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpatialSqliteStore } from './spatial-sqlite-store.js';
import { SpatialVisualRecall,type FeatureExtractor } from './spatial-visual-recall.js';
import { SpatialV2Service } from './spatial-v2-service.js';
import type { SpatialObservation } from './incremental-spatial-memory.js';

test('visual recall reaches evicted old identity, scopes time, respects revisions and restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'visual-recall-')),path=join(root,'topology.sqlite'),index=join(root,'visual.sqlite');
 const extract:FeatureExtractor=async rows=>rows.map(r=>({id:r.id,features:[Array(72).fill(Number(r.frames[0]))]}));
 const db=new SpatialSqliteStore(path);const observations:SpatialObservation[]=[];
 for(let i=0;i<10;i++){
  const row={id:'o'+i,recordingId:'r1',atMs:i*1000,frames:[String(i/10)]};observations.push(row);db.ingest(row);
  db.commit([{observationId:row.id,placeId:'p'+i,reason:'fixture'}],[{id:'p'+i,summary:'fixture '+i,status:'candidate',lastSeenMs:row.atMs,representatives:[row]}]);
 }
 assert.ok(!db.context().nodes.some(n=>n.id==='p0'));
 let recall=new SpatialVisualRecall(index,path,extract);await recall.index(observations);
 assert.throws(()=>new SpatialVisualRecall(index,join(root,'other-library.sqlite'),extract),/another library/);
 const query={id:'return',recordingId:'r2',atMs:20000,frames:['0']};
 let result=await recall.query([query],20000,2);assert.equal(result.hits[0]!.placeId,'p0');assert.equal(result.hits[0]!.observationId,'o0');
 assert.equal((await recall.query([query],0,2)).hits.length,0);
 const revision=db.revise('merge','p0','fixture merge',['o0'],{targetId:'p1'});
 assert.equal((await recall.query([query],20000,1)).hits[0]!.placeId,'p1');
 db.undo(revision,'fixture undo');assert.equal((await recall.query([query],20000,1)).hits[0]!.placeId,'p0');
 const mergeForSplit=db.revise('merge','p0','fixture merge for split',['o0'],{targetId:'p1'});
 const split=db.revise('split','p1','fixture split',['o0'],{summary:'split candidate'});
 const splitPlace=(await recall.query([query],20000,1)).hits[0]!.placeId;assert.notEqual(splitPlace,'p0');
 db.undo(split,'undo split');assert.equal((await recall.query([query],20000,1)).hits[0]!.placeId,'p1');
 db.undo(mergeForSplit,'undo merge for split');assert.equal((await recall.query([query],20000,1)).hits[0]!.placeId,'p0');
 recall.close();db.close();recall=new SpatialVisualRecall(index,path,extract);
 const service=new SpatialV2Service(path,async(batch,history)=>{
  assert.ok(history.nodes.length<=3);assert.ok(history.nodes.some(n=>n.id==='p0'));
  assert.equal(history.nodes.find(n=>n.id==='p0')!.representatives[0]!.id,'o0');
  return {places:[],assignments:batch.map(o=>({observationId:o.id,placeId:'p0',reason:'mock original evidence confirmed'}))};
 },recall);
 try{
  await service.load();await service.ingest(query);await service.tick(30000,true);
  assert.equal(service.summary().currentPlaceId,'p0');assert.equal(service.summary().pending,0);
 }finally{service.close();await rm(root,{recursive:true,force:true});}
});
