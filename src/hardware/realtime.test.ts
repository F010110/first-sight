import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RealtimeMemory,type LiveOriginal} from './realtime-memory.js';
import {answerRealtimeQuestion} from './realtime-question.js';
import {realtimeServer} from '../desktop/realtime-server.js';
import {RealtimeMethod2} from './realtime-method2.js';
const row=(id:string,atMs:number):LiveOriginal=>({id,atMs,requestWallTimeMs:atMs,receivedAtMs:atMs+100,jpegPath:id+'.jpg',jpegSha256:'hash',pngPath:id+'.png',pngSha256:'hash'});
test('single-view method2 keeps independent perception and all-member original comparison',async()=>{
 let comparisons=0;
 const method=new RealtimeMethod2(async input=>{const d=input.data as any;assert.ok(input.images.every(i=>i.direction==='front'));assert.equal(new Set(input.images.map(i=>i.path)).size,input.images.length);
  if(input.phase==='perception'){assert.deepEqual(Object.keys(d),['current']);assert.equal(input.images.length,1);return {observationId:d.current.id,region:'bounded room',clearRegion:true,layoutEvidence:['wall','doorway'],uncertainties:[],retrievalQueries:[],sourceIds:[d.current.id]};}
  if(d.memberIds){comparisons+=d.memberIds.length;assert.equal(input.images.length,d.memberIds.length+1);assert.equal(d.visitMemory.relations,undefined);return {groupId:d.groupId,version:d.version,pageIndex:d.pageIndex,currentId:d.current.id,scopeMatch:'yes',reason:'same visible boundary',memberChecks:d.memberIds.map((id:string)=>({id,relation:'compatible',evidence:'same wall and doorway'})),sourceIds:[d.current.id,...d.memberIds]};}
  return {coherent:true,scope:{name:'room',definition:'bounded visible room',boundaryRules:['door boundary'],sourceIds:[d.current.id]}};
 });
 const a=await method.observe({...row('a',1000),features:[Array(72).fill(.5)]});await method.observe({...row('b',3000),features:[Array(72).fill(.5)]});const c=await method.observe({...row('c',5000),features:[Array(72).fill(.5)]});assert.equal(c.placeId,a.placeId);assert.equal(comparisons,3);
});
test('live question snapshot excludes future judgments and cannot mutate producer memory',async()=>{
 const root=await mkdtemp(join(tmpdir(),'live-memory-'));const memory=new RealtimeMemory(join(root,'memory.sqlite'));
 try{memory.archive(row('old',1000));memory.archive(row('future',4000));const before=memory.snapshot(2000);
 memory.commit('old',{placeId:'g1'},3000);assert.equal(before.rows[0]!.judgment,null);assert.equal(memory.snapshot(2000).rows.length,1);assert.equal(memory.snapshot(2000).rows[0]!.judgment,null);
 const after=memory.snapshot(3000);after.rows[0]!.judgment.placeId='tampered';assert.equal(memory.snapshot(3000).rows[0]!.judgment.placeId,'g1');
 }finally{memory.close();await rm(root,{recursive:true,force:true});}
});
test('stopped or stale input refuses current question without model calls',async()=>{
 const snapshot={asOfMs:5000,rows:[{original:row('a',4900),judgment:null,availableAtMs:null}]};let calls=0;
 const request=async()=>{calls++;throw Error('must not call');};
 assert.equal((await answerRealtimeQuestion(snapshot,'眼前有什么',request,false)).abstained,true);
 snapshot.asOfMs=10000;assert.equal((await answerRealtimeQuestion(snapshot,'眼前有什么',request)).abstained,true);assert.equal(calls,0);
});
test('historical answer requires searched and inspected originals from the fixed snapshot',async()=>{
 const snapshot={asOfMs:5000,rows:[{original:row('old',1000),judgment:null,availableAtMs:null},{original:row('now',4900),judgment:null,availableAtMs:null}]};
 let calls=0;const result=await answerRealtimeQuestion(snapshot,'刚才看见什么',async input=>{
  calls++;if(calls===1)return {kind:'answer',text:'unsupported',sourceIds:['old'],abstained:false};
  if(calls===2)return {kind:'search',query:'',cursor:0};
  if(calls===3)return {kind:'inspect',sourceIds:['old']};
  assert.deepEqual(input.images.map(i=>i.id),['now','old']);return {kind:'answer',text:'历史画面里的物体',sourceIds:['old'],abstained:false};
 });assert.equal(calls,4);assert.deepEqual(result.sourceIds,['old']);
});
test('realtime HTTP opens idle and rejects cross-origin device start',async()=>{
 const root=await mkdtemp(join(tmpdir(),'live-http-'));const app=realtimeServer(root,0,false);
 await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));const port=(app.server.address() as {port:number}).port;const base=`http://127.0.0.1:${port}`;
 try{const state=await (await fetch(base+'/api/live/state')).json() as any;assert.equal(state.session,null);assert.equal(state.allowPaid,false);
 assert.equal((await fetch(base+'/api/live/start',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/api/live/start',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({modelEnabled:true,confirmPaid:true,budgetUSD:.75})})).status,400);
 assert.equal((await fetch(base+'/realtime.html')).status,200);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
