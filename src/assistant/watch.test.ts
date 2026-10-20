import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AssistantRuntime} from './runtime.js';
import {assistantCapabilities} from './capabilities.js';
import type {ObservationService,VisualTargetResult} from './contracts.js';

function setup(check:(id:string)=>Promise<VisualTargetResult>=async id=>({status:'observed',description:'画面中有候选标志',sourceIds:[id]})){
 let clock=1000;
 const memory:ObservationService={async observe(){},async question(){return {text:'图片',source:'visual',sourceIds:[]};},checkTarget:check,discardPending(){},close(){}};
 const events:Array<{kind:string;value:unknown}>=[];
 const runtime=new AssistantRuntime({async plan(){return {capability:'conversation',reply:'好'};}},memory,{async append(kind,value){events.push({kind,value:structuredClone(value)});}},assistantCapabilities(memory,true),true,()=>clock);
 return {runtime,events,setClock(value:number){clock=value;}};
}
test('watch registers actual state and delivers once across observations',async()=>{
 const {runtime,setClock}=setup();await runtime.submit('看到标志提醒我','task.watch');await runtime.idle();
 assert.equal(runtime.view().watches[0]?.status,'active');await runtime.control('capture.start');
 await runtime.observe({id:'one',atMs:1000,frames:['one.png']});await runtime.idle();setClock(3000);
 await runtime.observe({id:'two',atMs:3000,frames:['two.png']});await runtime.idle();
 assert.equal(runtime.view().watches[0]?.notificationCount,1);assert.equal(runtime.view().watches[0]?.status,'completed');await runtime.close();
});
test('finding is candidate until explicit user confirmation',async()=>{
 const {runtime}=setup();const id=await runtime.submit('寻找标志','task.find');await runtime.idle();await runtime.control('capture.start');
 await runtime.observe({id:'one',atMs:1000,frames:['one.png']});await runtime.idle();assert.equal(runtime.view().watches[0]?.status,'candidate');
 await runtime.control('watch.confirm',id!);assert.equal(runtime.view().watches[0]?.status,'completed');await runtime.close();
});
test('cancelled in-flight target check cannot deliver a reminder',async()=>{
 let release!:(result:VisualTargetResult)=>void;let start!:()=>void;
 const ready=new Promise<void>(resolve=>{start=resolve;});
 const {runtime}=setup(async()=>{start();return new Promise(resolve=>{release=resolve;});});
 const id=await runtime.submit('看到标志提醒我','task.watch');await runtime.idle();await runtime.control('capture.start');
 await runtime.observe({id:'one',atMs:1000,frames:['one.png']});await ready;await runtime.control('watch.cancel',id!);
 release({status:'observed',description:'迟到目标',sourceIds:['one']});await runtime.idle();
 assert.equal(runtime.view().watches[0]?.status,'cancelled');assert.equal(runtime.view().messages.some(m=>m.text.includes('迟到目标')),false);await runtime.close();
});
test('expiry works even with no incoming images and rejects late confirmation',async()=>{
 const {runtime,setClock}=setup();const id=await runtime.submit('寻找标志','task.find');await runtime.idle();setClock(122000);await runtime.expireWatches();
 assert.equal(runtime.view().watches[0]?.status,'expired');await assert.rejects(runtime.control('watch.confirm',id!),/valid/);await runtime.close();
});
test('unsupported citations fail closed, not successful detections',async()=>{
 const {runtime}=setup(async()=>({status:'observed',description:'旧图',sourceIds:['old']}));await runtime.submit('看到标志提醒我','task.watch');await runtime.idle();await runtime.control('capture.start');
 await runtime.observe({id:'one',atMs:1000,frames:['one.png']});await runtime.idle();assert.equal(runtime.view().watches[0]?.status,'failed');assert.equal(runtime.view().watches[0]?.notificationCount,0);await runtime.close();
});
test('a new question supersedes the pending answer without cancelling subscriptions',async()=>{
 const {runtime}=setup();await runtime.submit('看到标志提醒我','task.watch');await runtime.idle();
 await runtime.submit('第一问','conversation');await runtime.submit('第二问','conversation');await runtime.idle();
 assert.equal(runtime.view().tasks.at(-2)?.status,'cancelled');assert.equal(runtime.view().tasks.at(-1)?.status,'completed');assert.equal(runtime.view().watches[0]?.status,'active');await runtime.close();
});
