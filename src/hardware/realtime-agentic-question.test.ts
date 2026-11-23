import {test} from 'node:test';
import assert from 'node:assert/strict';
import {answerRealtimeQuestion as nativeAnswer} from './realtime-question.js';
import type {SpatialJsonRequest} from '../agent/spatial-json-vlm.js';
import type {LiveOriginal,RealtimeMemory} from './realtime-memory.js';
type Snapshot=ReturnType<RealtimeMemory['snapshot']>;
const answerRealtimeQuestion=(value:Snapshot,text:string,request:(input:SpatialJsonRequest)=>Promise<unknown>)=>nativeAnswer(value,text,input=>(input.data as any).operation==='verify-history-evidence'?Promise.resolve({supported:true,reason:'unit-test fixture only',sourceIds:(input.data as any).candidate.sourceIds}):request(input));
const row=(id:string,atMs:number):LiveOriginal=>({id,atMs,requestWallTimeMs:atMs,receivedAtMs:atMs,jpegPath:id+'.jpg',jpegSha256:'test',pngPath:id+'.png',pngSha256:'test'});
const snapshot=():Snapshot=>({asOfMs:5000,rows:[{original:row('desk',1000),judgment:{placeId:'p1',groups:[{id:'p1',scope:{name:'书桌区域',definition:'书桌与墙角'}}],perception:{region:'书桌前',layoutEvidence:['桌面、墙角'],retrievalQueries:[]}},availableAtMs:1100},{original:row('now',4900),judgment:null,availableAtMs:null}]});

test('agent can recover from empty object search using place overview, browse and direct inspection',async()=>{
 let calls=0;
 const result=await answerRealtimeQuestion(snapshot(),'之前马克笔在哪',async input=>{
  calls++;const data=input.data as any;
  assert.equal(data.overview.places[0].name,'书桌区域');
  if(calls===1)return {kind:'search',query:'marker'};
  if(calls===2){assert.equal(data.toolResult.totalCandidates,0);assert.match(data.feedback,/改用overview/);return {kind:'browse',placeId:'p1',notes:'尝试书桌而不是重复物品词'};}
  if(calls===3){assert.equal(data.toolResult.hits[0].id,'desk');assert.equal(data.history.length,2);return {kind:'inspect',sourceIds:['desk']};}
  assert.ok(input.images.some(image=>image.id==='desk'));return {kind:'answer',text:'书桌上',sourceIds:['desk'],abstained:false};
 });
 assert.equal(result.abstained,false);assert.equal(calls,4);
});

test('known causal original may be inspected without keyword search; unseen citation still fails',async()=>{
 let calls=0;
 const result=await answerRealtimeQuestion(snapshot(),'之前什么物体',async input=>{
  calls++;
  if(calls===1)return {kind:'answer',text:'unsupported',sourceIds:['desk'],abstained:false};
  if(calls===2){assert.match((input.data as any).feedback,/actually viewed/);return {kind:'inspect',sourceIds:['desk']};}
  return {kind:'answer',text:'actual viewed evidence',sourceIds:['desk'],abstained:false};
 });
 assert.equal(calls,3);assert.deepEqual(result.sourceIds,['desk']);
});

test('already delivered current original is legitimate evidence without a search ritual',async()=>{
 const result=await answerRealtimeQuestion(snapshot(),'历史图片上有什么',async()=>({kind:'answer',text:'图中所见',sourceIds:['now'],abstained:false}));
 assert.equal(result.abstained,false);
});

test('future originals and late judgments never leak into overview or inspection',async()=>{
 const value=snapshot();value.rows[0]!.availableAtMs=6000;value.rows.push({original:row('future',9000),judgment:null,availableAtMs:null});
 let calls=0;
 const result=await answerRealtimeQuestion(value,'之前看到了什么',async input=>{
  calls++;const data=input.data as any;
  assert.equal(data.overview.places.length,0);assert.ok(!JSON.stringify(data.overview).includes('future'));
  if(calls===1)return {kind:'inspect',sourceIds:['future']};
  assert.match(data.feedback,/因果快照/);return {kind:'answer',text:'不能确认',sourceIds:[],abstained:true};
 });
 assert.equal(result.abstained,true);
});

test('rolling image window permits wider inspection but never exceeds12 images',async()=>{
 const value:Snapshot={asOfMs:10000,rows:Array.from({length:18},(_,i)=>({original:row('r'+i,i*500),judgment:null,availableAtMs:null}))};
 let calls=0;
 const result=await answerRealtimeQuestion(value,'历史经历',async input=>{
  calls++;assert.ok(input.images.length<=12);
  if(calls<=4)return {kind:'inspect',sourceIds:Array.from({length:4},(_,i)=>'r'+((calls-1)*4+i))};
  assert.ok(!input.images.some(i=>i.id==='r0'));assert.ok((input.data as any).viewedIds.includes('r0'));
  return {kind:'answer',text:'之前实际查看的证据',sourceIds:['r0'],abstained:false};
 });
 assert.equal(result.abstained,false);assert.equal(calls,5);
});

test('repeated empty queries retain history and explicit strategy-change feedback',async()=>{
 let calls=0;
 await answerRealtimeQuestion(snapshot(),'历史物品',async input=>{
  calls++;
  if(calls<=2)return {kind:'search',query:'absent-keyword'};
  assert.equal((input.data as any).toolResult.repetitions,2);assert.equal((input.data as any).history.length,2);
  assert.equal((input.data as any).toolResult.automaticRecovery,true);
  assert.ok(input.images.some(i=>i.id==='desk'));
  return {kind:'answer',text:'证据不足',sourceIds:[],abstained:true};
 });
});

test('null optional filters execute normally instead of causing the observed14-error loop',async()=>{
 let calls=0;
 await answerRealtimeQuestion(snapshot(),'之前马克笔',async input=>{
  calls++;
  assert.ok(!input.prompt.includes('可选精确ID'));
  if(calls===1)return {kind:'search',query:'书桌',placeId:null,afterMs:null,beforeMs:null,cursor:null};
  assert.ok((input.data as any).toolResult.hits.some((r:any)=>r.id==='desk'));
  return {kind:'answer',text:'不确定',sourceIds:[],abstained:true};
 });
 assert.equal(calls,2);
});

test('place browsing automatically delivers nearby unlabeled originals, without assigning their place',async()=>{
 const value=snapshot();value.rows.splice(1,0,{original:row('unmodeled',2000),judgment:null,availableAtMs:null});
 let calls=0;
 await answerRealtimeQuestion(value,'历史物品',async input=>{
  calls++;if(calls===1)return {kind:'browse',placeId:'p1'};
  assert.ok(input.images.some(i=>i.id==='unmodeled'));assert.equal(value.rows[1]!.judgment,null);
  return {kind:'answer',text:'不能确认',sourceIds:[],abstained:true};
 });
});

test('independent reviewer can reject a viewed but unsupported historical answer',async()=>{
 let reviews=0;
 const result=await nativeAnswer(snapshot(),'谁之前计划种花',async input=>{
  if((input.data as any).operation==='verify-history-evidence'){reviews++;return {supported:false,reason:'Silent table images cannot establish spoken intent',sourceIds:[]};}
  return {kind:'answer',text:'某个人计划种花',sourceIds:['now'],abstained:false};
 });
 assert.equal(reviews,2);assert.equal(result.abstained,true);assert.match(result.text,/spoken intent/);
});

test('neighbors delivers a causal short sequence rather than only the current picture',async()=>{
 let calls=0;
 await answerRealtimeQuestion(snapshot(),'历史动作',async input=>{
  calls++;if(calls===1)return {kind:'neighbors',sourceId:'desk',radiusMs:6000};
  assert.ok(input.images.some(i=>i.id==='desk'));assert.equal((input.data as any).toolResult.imagesDelivered,true);
  return {kind:'answer',text:'不能确认',sourceIds:[],abstained:true};
 });
});
