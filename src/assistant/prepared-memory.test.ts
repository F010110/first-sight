import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {SpatialContextMemory} from '../agent/spatial-context-memory.js';
import {SpatialContextLoop} from '../agent/spatial-context-loop.js';
import {PreparedMemory,type PreparedObservation} from './prepared-memory.js';
import {QuestionAgent} from './question-agent.js';
import {existsSync} from 'node:fs';
import {publicRequiredEvidenceIds} from '../sim/evaluation/memory-answer-repair.js';

const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){
 const root=await mkdtemp(resolve('cam/local/prepared-memory-test-'));
 const image=join(root,'synthetic.png');const bytes=Buffer.from('synthetic-image-test-only');await writeFile(image,bytes);
 const memory=new SpatialContextMemory(join(root,'memory.sqlite'));
 const loop=new SpatialContextLoop(memory,async input=>({assessment:null as never,assessments:input.observations.map(o=>({observationId:o.id,atMs:o.atMs,placeId:null,reason:o.id==='future'?'FUTURE_SECRET':'fixture visible',sourceIds:[o.id]})),next:{kind:'finish'}}));
 const rows:PreparedObservation[]=[{observation:{id:'past',atMs:10,frames:[image]},sha256:[hash(bytes)],availableAtMs:20},{observation:{id:'current',atMs:20,frames:[image]},sha256:[hash(bytes)],availableAtMs:20},{observation:{id:'future',atMs:30,frames:[image]},sha256:[hash(bytes)],availableAtMs:30}];
 await loop.runWindow(rows.slice(0,2).map(r=>r.observation));const first={availableAtMs:20,observationIds:['past','current'],context:loop.context.view()};
 await loop.runWindow([rows[2]!.observation]);const future={availableAtMs:30,observationIds:['future'],context:loop.context.view()};memory.close();
 await writeFile(join(root,'observations.json'),JSON.stringify(rows));await writeFile(join(root,'contexts.jsonl'),[first,future].map(v=>JSON.stringify(v)).join('\n')+'\n');
 const hashes=Object.fromEntries(await Promise.all(['memory.sqlite','observations.json','contexts.jsonl'].map(async file=>[file,hash(await readFile(join(root,file)))])));
 await writeFile(join(root,'complete.json'),JSON.stringify({schema:'prepared-spatial-memory-v1',hashes}));return {root,rows};
}
test('prepared Context and retrieval are causal; question-only run never modifies producer',async()=>{
 const {root,rows}=await fixture();let memory:PreparedMemory|undefined;
 const key=process.env.QWEN_API_KEY,base=process.env.QWEN_BASE_URL;
 process.env.QWEN_API_KEY='synthetic-test-key';process.env.QWEN_BASE_URL='http://synthetic.invalid';
 try{
  const before=hash(await readFile(join(root,'memory.sqlite')));memory=await PreparedMemory.open(root);
  assert.equal(memory.context(10,rows[0]!.observation).location,null);
  assert.equal(JSON.stringify(memory.context(20,rows[1]!.observation)).includes('FUTURE_SECRET'),false);
  const session=memory.session(20);assert.deepEqual(session.search({}).hits.map(h=>h.id),['past']);
  let calls=0;
  const request:typeof fetch=async(_url,init)=>{
   const content=JSON.parse(String(init?.body)).messages[0].content;assert.equal(JSON.stringify(content).includes('FUTURE_SECRET'),false);
   if(calls===1)assert.ok(JSON.parse(content[0].text).feedback.includes('不要重复相同搜索'));
   const actions=[{kind:'search',query:'',afterMs:11,beforeMs:12},{kind:'search',query:'',afterMs:null,beforeMs:11},{kind:'inspect',ids:['past']},{kind:'answer',answer:'过去的记录',sourceIds:['past'],abstained:false}];
   return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:10},choices:[{message:{content:JSON.stringify(actions[calls++])}}]}));
  };
  const agent=new QuestionAgent(memory,join(root,'qa'),true,request);const answer=await agent.answer(rows[1]!, '之前有什么？',true);
  assert.equal(answer.text,'过去的记录');assert.equal(calls,4);memory.close();memory=undefined;
  assert.equal(hash(await readFile(join(root,'memory.sqlite'))),before);
 }finally{if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;if(base===undefined)delete process.env.QWEN_BASE_URL;else process.env.QWEN_BASE_URL=base;memory?.close();await rm(root,{recursive:true,force:true});}
});
test('prepared bundle rejects a changed Context file',async()=>{
 const {root}=await fixture();try{await writeFile(join(root,'contexts.jsonl'),'{}');await assert.rejects(PreparedMemory.open(root),/integrity/);}finally{await rm(root,{recursive:true,force:true});}
});
test('baseline parity: public time binding, corrective feedback and transport retry preserve evidence gates',async()=>{
 const {root,rows}=await fixture();const memory=await PreparedMemory.open(root);
 const key=process.env.QWEN_API_KEY,base=process.env.QWEN_BASE_URL;process.env.QWEN_API_KEY='test';process.env.QWEN_BASE_URL='http://synthetic.invalid';
 try{
  const required=memory.requirements('回看00:00:00.010',rows[1]!.observation);assert.deepEqual(required.requiredIds,['past']);
  assert.equal(memory.requirements('回看00:00:00.030',rows[1]!.observation).unresolved,true);
  assert.equal(memory.requirements('回看00:00:00',rows[2]!.observation).unresolved,true); // ambiguous second, not guessed
  let calls=0,first='';
  const request:typeof fetch=async(_url,init)=>{
   const body=String(init?.body);if(calls===0){calls++;first=body;throw Object.assign(new Error('socket'),{code:'ECONNRESET'});}
   if(calls===1)assert.equal(body,first);
   const actions=[{kind:'answer',answer:'肯定回答',sourceIds:['current'],abstained:false},{kind:'search',query:'',afterMs:999,beforeMs:999},{kind:'inspect',ids:['past']},{kind:'answer',answer:'无法确认',sourceIds:['past'],abstained:false},{kind:'answer',answer:'过去可见环境',sourceIds:['past'],abstained:false}];
   const value=actions[calls++-1];return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:10},choices:[{message:{content:JSON.stringify(value)}}]}));
  };
  const agent=new QuestionAgent(memory,join(root,'recovered'),true,request);
  assert.equal((await agent.answer(rows[1]!,'回看00:00:00.010',true)).text,'过去可见环境');assert.equal(calls,6);
  const search=JSON.parse(await readFile(join(root,'recovered/0002/resolved-search.json'),'utf8'));assert.equal(search.query.afterMs,10);assert.equal(search.query.beforeMs,10);
  const usage=JSON.parse(await readFile(join(root,'recovered/usage.json'),'utf8'));assert.equal(usage.calls,6);assert.equal(usage.unknownCallsReserved,1);
 }finally{memory.close();if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;if(base===undefined)delete process.env.QWEN_BASE_URL;else process.env.QWEN_BASE_URL=base;await rm(root,{recursive:true,force:true});}
});
test('baseline parity: all original90 public source requirements survive the read-only split',{skip:!existsSync('run/campus-spatial-memory/2026-10-20T13-42-03-856Z-ecad0254/complete.json')},async()=>{
 const memory=await PreparedMemory.open('run/campus-spatial-memory/2026-10-20T13-42-03-856Z-ecad0254');
 try{
  const rows=(await readFile('run/inspect-repair-full90-v1/model-replay/observations.jsonl','utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const questions=JSON.parse(await readFile('run/inspect-repair-full90-v1/model-questions.json','utf8'));
  for(const question of questions){const current=memory.select(question.currentObservationId).observation;const required=memory.requirements(question.question,current);assert.deepEqual([...required.requiredIds].sort(),publicRequiredEvidenceIds(question,rows).sort(),question.id);assert.equal(required.unresolved,false,question.id);}
  const newTasks=JSON.parse(await readFile('run/campus-assistant-questions90-v1/tasks.json','utf8'));
  for(const task of newTasks){const current=memory.select(rows[task.index].id).observation;const required=memory.requirements(task.text,current);assert.equal(required.unresolved,false,task.id);if(task.tier!=='current')assert.equal(required.requiredIds.length,1,task.id);}
 }finally{memory.close();}
});
test('baseline refusal metadata can recover without invented historical inspection',async()=>{
 const {root,rows}=await fixture();const memory=await PreparedMemory.open(root),key=process.env.QWEN_API_KEY,base=process.env.QWEN_BASE_URL;
 process.env.QWEN_API_KEY='test';process.env.QWEN_BASE_URL='http://synthetic.invalid';
 try{
  let calls=0;const request:typeof fetch=async(_url,init)=>{
   const prompt=JSON.parse(JSON.parse(String(init?.body)).messages[0].content[0].text);
   if(calls===1)assert.ok(prompt.feedback.includes('abstained改为true'));
   const value={kind:'answer',answer:'无法确认未记录时段的情况。',sourceIds:[],abstained:calls++>0};
   return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:10},choices:[{message:{content:JSON.stringify(value)}}]}));
  };
  const result=await new QuestionAgent(memory,join(root,'refusal'),true,request).answer(rows[1]!,'未记录时段发生了什么？',true);
  assert.equal(result.abstained,true);assert.deepEqual(result.sourceIds,[]);assert.equal(calls,2);
 }finally{memory.close();if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;if(base===undefined)delete process.env.QWEN_BASE_URL;else process.env.QWEN_BASE_URL=base;await rm(root,{recursive:true,force:true});}
});
