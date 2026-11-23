import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeReplay,replayNativeMemory,type NativeReplayInput} from './run-egolife-native.js';
import {egoLifeTask,answerEgoLifeWithFirstSight} from './egolife-first-sight-adapter.js';
import {answerRealtimeQuestion} from '../hardware/realtime-question.js';
import type {LiveOriginal} from '../hardware/realtime-memory.js';
import type {RealtimeMethod2} from '../hardware/realtime-method2.js';

const task=egoLifeTask({ID:'1',type:'EntityLog',question:'Where?',query_time:{date:'DAY1',time:'11210217'},choice_a:'Desk',choice_b:'Shelf',choice_c:'Drawer',choice_d:'Unknown'});
function input():NativeReplayInput{return {schema:'egolife-native-rgb-replay-v1',cloudProcessingAuthorized:false,samplingIntervalMs:2000,source:{revision:'pinned',firstMs:40000000,lastMs:41000000,missingIntervals:[]},tasks:[task],originals:[]};}
test('local-preview data cannot silently authorize cloud processing',async()=>{
 await assert.rejects(validateNativeReplay(input()),/authorization/);
});
test('native replay cannot run on captions or missing originals',async()=>{
 const value=input();value.cloudProcessingAuthorized=true;
 await assert.rejects(validateNativeReplay(value),/actual source images/);
});
test('native answer integration actually enforces the original-image guard',async()=>{
 let calls=0;
 await assert.rejects(answerEgoLifeWithFirstSight(task,{asOfMs:task.cutoffMs,rows:[]},answerRealtimeQuestion,async()=>{calls++;return {}; }),/尚无可用原图/);
 assert.equal(calls,0);
});
test('replay uses native latest-frame supersession and real completion timestamps, not all-frame forcing',async()=>{
 // Scheduler-only test: no model, no images sent, no accuracy claim.
 const value=input();value.source={revision:'test',firstMs:0,lastMs:10000,missingIntervals:[]};
 value.originals=[0,2000,4000,6000,8000,10000].map(atMs=>({id:String(atMs),atMs,requestWallTimeMs:atMs,receivedAtMs:atMs,jpegPath:'unused-in-scheduler-test',jpegSha256:'unused'}));
 const archived:string[]=[],modeled:string[]=[],commits:Array<[string,number]>=[];let timer=0;
 const method={interrupt:(_row:LiveOriginal)=>{},observe:async(row:LiveOriginal)=>{modeled.push(row.id);timer+=5000;return {} as Awaited<ReturnType<RealtimeMethod2['observe']>>;}};
 const result=await replayNativeMemory(value,{archive:row=>{archived.push(row.id);},commit:(id,_judgment,at)=>{commits.push([id,at]);}},method,async()=>{},()=>timer);
 assert.equal(archived.length,6);assert.deepEqual(modeled,['0','4000','10000']);
 assert.deepEqual(commits,[['0',5000],['4000',10000],['10000',15000]]);
 assert.equal(result.completedObservations,3);
});
test('producer failure does not erase independently archived history',async()=>{
 const value=input();value.source={revision:'test',firstMs:0,lastMs:4000,missingIntervals:[]};
 value.originals=[0,2000,4000].map(atMs=>({id:String(atMs),atMs,requestWallTimeMs:atMs,receivedAtMs:atMs,jpegPath:'unused',jpegSha256:'unused'}));
 let archived=0;
 const result=await replayNativeMemory(value,{archive:()=>{archived++;},commit:()=>{throw Error('Must not commit');}},{interrupt:()=>{},observe:async()=>{throw Error('bounded failure');}},async()=>{},()=>0);
 assert.equal(archived,3);assert.equal(result.completedObservations,0);assert.match(result.producerFailure!,/bounded failure/);
});
