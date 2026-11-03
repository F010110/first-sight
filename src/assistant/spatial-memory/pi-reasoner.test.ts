import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createPiSpatialReasoner} from './pi-reasoner.js';
import {SpatialMemoryService} from './service.js';
import type {Observation} from './contracts.js';

const usage={prompt_tokens:100,completion_tokens:20};

test('Pi session and skill run the spatial tool loop, commit durably and record skill versions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-pi-')),key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';
 const sources=join(dir,'sources');await mkdir(sources);
 const row=async(id:string,atMs:number):Promise<Observation>=>{const views=[];for(const direction of ['front','left','right']){const bytes=Buffer.from(id+direction),path=join(sources,id+'-'+direction+'.png');await writeFile(path,bytes);views.push({id,direction,path,sha256:createHash('sha256').update(bytes).digest('hex')});}return {id,atMs,views};};
 let timelineChecked=false;
 const request=async(input:any)=>{
  const data=input.data as any;assert.ok(Array.isArray(data.tools));assert.ok(data.tools.some((t:any)=>t.name==='record_spatial_state'));
  if(data.current.id==='b'&&!timelineChecked){timelineChecked=true;assert.ok(!JSON.stringify(data.messages).includes('"kind":"timeline"'));return {output:{tool:'memory_timeline',arguments:{assessment:{location:{status:'unknown',placeId:null,name:'未知',reason:'先浏览历史',sourceIds:['b']},hypotheses:[],unresolved:[],relations:[]}}},usage};}
  return {output:{tool:'record_spatial_state',arguments:{assessment:{location:{status:'new',placeId:null,name:'区域'+data.current.id,reason:'当前三摄布局',sourceIds:[data.current.id]},hypotheses:[],unresolved:[],relations:[]}}},usage};
 };
 const reasoner=await createPiSpatialReasoner(join(dir,'pi'),request);
 const service=await SpatialMemoryService.create(join(dir,'memory'),{async perceive(r){return {summary:'事实'+r.id,details:['细节'+r.id]};}},{reasoner});
 try{
  await service.observe(await row('a',0));await service.observe(await row('b',1000));await service.finishInput();
  assert.equal(service.progress().spatialStates,2);assert.equal(timelineChecked,true);
  assert.equal(service.latest()!.state.assessment.location.status,'known');
  const session=JSON.parse(await readFile(join(dir,'pi','session.json'),'utf8'));assert.ok(session.id);
  const checkpoints=(await readFile(join(dir,'pi','pi-checkpoints.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(checkpoints.length,2);assert.ok(checkpoints[0].tipId);assert.ok(checkpoints[0].skillVersions['spatial-memory-v2']);
 }finally{await service.close();if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(dir,{recursive:true,force:true});}
});

test('windowed Pi session keeps memory tools, rejects missing interim assessment and inspects delivered history',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-window-pi-')),key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';
 await mkdir(join(dir,'sources'));let service:SpatialMemoryService|undefined,secondCalls=0;
 const request=async(input:any)=>{
  const runtime=input.data.runtimeContext,id=input.data.current.id;
  assert.equal(runtime.window.observations.length,4);
  const unknown={location:{status:'unknown',placeId:null,name:'待确认',reason:'当前窗口待检查历史',sourceIds:[id]},hypotheses:[],unresolved:['确认历史身份'],relations:[]};
  if(id==='w3'){
   assert.equal(input.images.length,12);
   return {output:{tool:'record_spatial_state',arguments:{assessment:{...unknown,location:{...unknown.location,status:'new',name:'甲区域'}}}},usage};
  }
  secondCalls++;
  if(secondCalls===1)return {output:{tool:'memory_timeline',arguments:{}} ,usage};
  if(secondCalls===2){assert.ok(JSON.stringify(input.data.messages).includes('assessment'));return {output:{tool:'memory_timeline',arguments:{assessment:unknown}},usage};}
  if(secondCalls===3){assert.equal(runtime.lastToolResult.kind,'timeline');assert.equal(runtime.workingContext.location.status,'unknown');return {output:{tool:'memory_read',arguments:{ids:['w0'],assessment:unknown}},usage};}
  if(secondCalls===4){assert.equal(runtime.lastToolResult.records[0].window.observations.length,4);return {output:{tool:'memory_inspect',arguments:{ids:['w0'],assessment:unknown}},usage};}
  assert.equal(input.images.length,6);assert.deepEqual(runtime.inspectedIds,['w7','w0']);
  return {output:{tool:'record_spatial_state',arguments:{assessment:{...unknown,unresolved:[],location:{status:'known',placeId:runtime.workingContext.recent[0].assessment.location.placeId,name:'甲区域',reason:'检查过的历史原图支持重访',sourceIds:['w7','w0']}}}},usage};
 };
 try{
  const reasoner=await createPiSpatialReasoner(join(dir,'pi'),request);
  service=await SpatialMemoryService.create(join(dir,'memory'),{async perceive(row){return {summary:'观察'+row.id,details:['布局']};}},{reasoner,windowMs:8000});
  for(let i=0;i<8;i++){
   const id='w'+i,views=[];for(const direction of ['front','left','right']){const bytes=Buffer.from(id+direction),path=join(dir,'sources',id+'-'+direction+'.png');await writeFile(path,bytes);views.push({id,direction,path,sha256:createHash('sha256').update(bytes).digest('hex')});}
   await service.observe({id,atMs:i*2000,views});
  }
  await service.finishInput();assert.equal(service.progress().spatialStates,2);assert.equal(service.progress().coveredObservations,8);assert.equal(service.progress().places,1);assert.equal(secondCalls,5);
 }finally{await service?.close().catch(()=>{});if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(dir,{recursive:true,force:true});}
});
