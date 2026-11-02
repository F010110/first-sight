import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {answerWithPiHarness} from './first-sight-harness.js';
import {RuntimeContextStore} from './context-store.js';
import {MemoryAccess} from './memory-access.js';
import type {ThreeAgentStore} from '../three-agent-store.js';

test('versioned runtime context is immutable per snapshot and refuses clock regression',()=>{
 const store=new RuntimeContextStore({current:{id:'a',atMs:10},value:'old'}),old=store.snapshot();
 store.update({current:{id:'b',atMs:20},value:'new'});
 assert.equal(old.data.value,'old');assert.equal(store.snapshot().version,1);
 assert.throws(()=>store.update({current:{id:'a',atMs:1},value:'bad'}));
 old.data.value='mutation';assert.equal(store.snapshot().data.value,'new');
});

test('mechanical memory distinguishes text misses, read coverage and image inspection',async()=>{
 const access=new MemoryAccess([{memoryRef:'memory-v1',observationId:'old',atMs:0,text:'普通房间'}] as any,100,()=>({id:'old',atMs:0,frames:[]}));
 assert.equal((await access.execute({op:'find',terms:['角落物件']})).total,0);
 await access.execute({op:'read'});
 const before=await access.execute({op:'coverage'});assert.equal(before.read,1);assert.equal(before.inspected,0);assert.equal(before.semanticCoverageCertified,false);
 await access.execute({op:'inspect',memoryRefs:['memory-v1']});assert.equal((await access.execute({op:'coverage'})).inspected,1);
 await assert.rejects(access.execute({op:'read',beforeMs:101}));
});

test('Pi durable harness executes tools, loads skills, rejects fabricated citations and finishes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/pi-harness-')),key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';let calls=0;
 const snapshot={asOfMs:100000,results:[{lane:'memory',observation_id:'old',source_at_ms:1000,available_at_ms:10,evidence_until_ms:1000,memoryRef:'memory-v1',result:{summary:'普通房间'}}]} as unknown as ReturnType<ThreeAgentStore['snapshot']>;
 const finish={text:'无法从未检查画面确定角落里是否有物件。',target:'历史角落',memoryRefs:['memory-v1'],sourceIds:[],contextRefs:[],abstained:true};
 try{
  const answer=await answerWithPiHarness({question:'角落里是否有物件?',row:{id:'now',atMs:100000,frames:[]},snapshot,sessionRoot:root,compactAfterRun:true,images:async()=>[],observation:id=>({id,atMs:1000,frames:[]}),request:async request=>{
   calls++;const data=request.data as any;assert.equal(request.includeUsage,true);
   if(data.role==='pi-compaction')return {output:{summary:'用户询问历史角落；memory-v1仅为文字来源，画面尚未检查，不能判断不存在。',memoryRefs:['memory-v1']},usage:{prompt_tokens:100,completion_tokens:50}};
   assert.equal(data.role,'pi-harness');
   if(calls>1)assert.ok(data.runtimeContext.version>0);
   const actions=[{assessment:'当前图不能回答历史角落，需查历史',tool:'context',arguments:{}},{tool:'load_skill',arguments:{name:'memory-investigation'}},{tool:'memory',arguments:{op:'read'}},{tool:'finish',arguments:{...finish,memoryRefs:['invented']}},{tool:'finish',arguments:finish}];
   return {output:actions[calls-1],usage:{prompt_tokens:100,completion_tokens:50}};
  }});
  assert.equal(calls,6);assert.equal(answer.audit.schema,'pi-memory-harness-v1');assert.ok(answer.audit.loadedSkills.includes('memory-investigation'));
  assert.ok(answer.audit.history.some((h:any)=>h.result.error));assert.ok((await readdir(root)).length>1);
  const transcript=JSON.parse(await readFile(join(root,'transcript.json'),'utf8'));
  assert.ok(transcript.some((e:any)=>e.type==='compaction'));
  assert.ok(transcript.some((e:any)=>e.type==='message'&&e.message.role==='toolResult'));
 }finally{if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(root,{recursive:true,force:true});}
});
