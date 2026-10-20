import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AssistantRuntime} from './runtime.js';
import {OutputPolicy} from './output-policy.js';
import type {Capability,ObservationService} from './contracts.js';

function setup(execute:Capability['execute']=async()=>({text:'回答',source:'conversation',sourceIds:[]})){
 const events:unknown[]=[];
 const memory:ObservationService={async observe(){},async question(){return {text:'图片',source:'visual',sourceIds:['image']};},discardPending(){},close(){}};
 const capabilities:Capability[]=[{id:'conversation',title:'对话',available:true,requiresFreshObservation:false,execute},{id:'visual.current',title:'图片',available:true,requiresFreshObservation:true,execute}];
 const runtime=new AssistantRuntime({async plan(){return {capability:'conversation',reply:'对话'};}},memory,{async append(kind,value){events.push({kind,value});}},capabilities,true);
 return {runtime,events};
}
test('conversation works without capture and records task lifecycle',async()=>{
 const {runtime}=setup();await runtime.submit('你好');await runtime.idle();
 assert.equal(runtime.view().tasks[0]?.status,'completed');assert.equal(runtime.view().messages.at(-1)?.text,'回答');await runtime.close();
});
test('cancel suppresses late result while control is not blocked by inference',async()=>{
 let release!:()=>void;let started!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});const ready=new Promise<void>(resolve=>{started=resolve;});
 const {runtime}=setup(async()=>{started();await gate;return {text:'迟到结果',source:'conversation',sourceIds:[]};});
 await runtime.submit('等待');await ready;await runtime.control('tasks.cancel');
 assert.equal(runtime.view().tasks[0]?.status,'cancelled');release();await runtime.idle();
 assert.equal(runtime.view().messages.some(m=>m.text==='迟到结果'),false);await runtime.close();
});
test('current visual task requires authorized fresh image',async()=>{
 const {runtime}=setup();await runtime.submit('看图片','visual.current');await runtime.idle();
 assert.equal(runtime.view().tasks[0]?.status,'failed');
 await assert.rejects(runtime.observe({id:'x',atMs:Date.now(),frames:['x.jpg']}),/authorized/);
 await runtime.control('capture.start');await runtime.observe({id:'x',atMs:Date.now(),frames:['x.jpg']});await runtime.idle();
 await runtime.submit('看图片','visual.current');await runtime.idle();assert.equal(runtime.view().tasks.at(-1)?.status,'completed');await runtime.close();
});
test('quiet and output interruption do not stop capture',async()=>{
 const {runtime}=setup();await runtime.control('capture.start');await runtime.control('mode.set','quiet');await runtime.control('output.interrupt');
 assert.equal(runtime.view().capture,'recording');assert.equal(runtime.view().outputPaused,true);
 await runtime.submit('主动问题');await runtime.idle();assert.equal(runtime.view().messages.at(-1)?.text,'回答');await runtime.close();
});
test('output policy rejects expired and duplicate proactive messages',()=>{
 const policy=new OutputPolicy(),state={mode:'explore' as const,outputPaused:false,cancelled:false};
 const candidate={action:'SHORT' as const,text:'提示',source:'system' as const,sourceIds:[],userInitiated:false,dedupeKey:'same'};
 assert.equal(policy.decide(candidate,state,100).deliver,true);assert.equal(policy.decide(candidate,state,101).deliver,false);
 assert.equal(policy.decide({...candidate,expiresAtMs:1},state,102).reason,'expired');
});
test('new question invalidates an old answer even while delivery audit is awaiting IO',async()=>{
 let ready!:()=>void,release!:()=>void,blocked=false;
 const entered=new Promise<void>(resolve=>{ready=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const memory:ObservationService={async observe(){},async question(){throw Error('unused');},discardPending(){},close(){}};
 const runtime=new AssistantRuntime({async plan(){return {capability:'conversation'};}},memory,{async append(kind){if(kind==='output-decision'&&!blocked){blocked=true;ready();await gate;}}},[{id:'conversation',title:'对话',available:true,requiresFreshObservation:false,async execute(text){return {text:'回答'+text,source:'conversation',sourceIds:[]};}}],true);
 await runtime.submit('旧问题');await entered;await runtime.submit('新问题');release();await runtime.idle();
 assert.equal(runtime.view().messages.some(m=>m.role==='assistant'&&m.text==='回答旧问题'),false);assert.equal(runtime.view().tasks[0]?.status,'cancelled');assert.equal(runtime.view().messages.at(-1)?.text,'回答新问题');await runtime.close();
});
test('rewinding a prepared scene can clear dialogue without touching spatial persistence',async()=>{
 const {runtime}=setup();await runtime.submit('较晚时刻的问题');await runtime.idle();assert.ok(runtime.view().messages.length);
 await runtime.control('conversation.reset');assert.equal(runtime.view().messages.length,0);await runtime.close();
});
