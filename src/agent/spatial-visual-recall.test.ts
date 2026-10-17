import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpatialSqliteStore } from './spatial-sqlite-store.js';
import { SpatialVisualRecall,visualDistance,type FeatureExtractor } from './spatial-visual-recall.js';
import { SpatialV2Service } from './spatial-v2-service.js';
import type { SpatialObservation } from './incremental-spatial-memory.js';

test('v2 temporal overlap is bounded, same-recording and committed before current batch',async()=>{
 const root=await mkdtemp(join(tmpdir(),'temporal-overlap-')),path=join(root,'memory.sqlite');const db=new SpatialSqliteStore(path);
 const rows=[['other',0],['r',10],['r',20],['other',25],['r',30]] as const;
 for(const [recordingId,atMs] of rows){const row={id:'o'+atMs,recordingId,atMs,frames:['0']};db.ingest(row);db.commit([{observationId:row.id,placeId:'p',reason:'fixture'}],[{id:'p',summary:'fixture',lastSeenMs:atMs,representatives:[row]}]);}db.close();
 const recall=new SpatialVisualRecall(join(root,'recall.sqlite'),path,async rows=>rows.map(r=>({id:r.id,features:[Array(72).fill(0)]})));
 const service=new SpatialV2Service(path,async(batch,history)=>{assert.deepEqual(history.observations.map(o=>o.id),['o20','o30']);assert.ok(history.observations.every(o=>o.atMs<batch[0]!.atMs&&o.recordingId==='r'));return {places:[],assignments:batch.map(o=>({observationId:o.id,placeId:'p',reason:'test only'}))};},recall,()=>{},true);
 try{await service.load();await service.ingest({id:'q',recordingId:'r',atMs:40,frames:['0']});await service.tick(100,true);assert.equal(service.summary().pending,0);}finally{service.close();await rm(root,{recursive:true,force:true});}
});

test('learned descriptors accept signed vectors, cosine rank and reject sidecar reuse',async()=>{
 const root=await mkdtemp(join(tmpdir(),'learned-recall-')),path=join(root,'topology.sqlite'),index=join(root,'visual.sqlite');
 const db=new SpatialSqliteStore(path);const row={id:'old',atMs:0,frames:['old']};db.ingest(row);db.commit([{observationId:'old',placeId:'p',reason:'fixture'}],[{id:'p',summary:'fixture',representatives:[row],lastSeenMs:0}]);
 const extract:FeatureExtractor=async rows=>rows.map(r=>({id:r.id,features:[[1,-1,0]]}));const spec={version:'test-learned-sha256',dimensions:3,metric:'cosine' as const};
 let recall=new SpatialVisualRecall(index,path,extract,spec);
 try{await recall.index([row]);assert.equal((await recall.query([{id:'q',atMs:10,frames:['q']}],10)).hits[0]!.placeId,'p');assert.ok(Math.abs(visualDistance([[1,-1,0]],[[2,-2,0]],'cosine'))<1e-10);assert.equal(visualDistance([[1,0]],[[0,1]],'cosine'),1);recall.close();recall=new SpatialVisualRecall(index,path,extract,spec);assert.throws(()=>new SpatialVisualRecall(index,path,extract),/mismatch/);}finally{recall.close();db.close();await rm(root,{recursive:true,force:true});}
});

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
