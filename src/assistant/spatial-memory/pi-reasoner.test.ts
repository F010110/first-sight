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

test('persistent work history is delivered across turns and budget compaction uses the model boundary',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-session-context-')),key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';
 let service:SpatialMemoryService|undefined,compactions=0,historySeen=false;
 try{
  const request=async(input:any)=>{
   if(input.data.role==='spatial-compaction'){
    compactions++;assert.ok(input.data.messages.length>0||input.data.previousSummary);assert.ok(input.prompt.includes('source/place/visit IDs'));
    return {output:{summary:'WORK-SUMMARY: preserve source a and its committed place; historical, not current visibility.'},usage};
   }
   const {current,messages,runtimeContext}=input.data;
   if(current.id==='c'){historySeen=true;assert.ok(JSON.stringify(messages).includes('WORK-SUMMARY'),JSON.stringify({compactions,roles:messages.map((m:any)=>m.role)}));assert.deepEqual(runtimeContext.inspectedIds,['c']);assert.deepEqual(runtimeContext.deliveredIds,[]);}
   return {output:{tool:'memory_add',arguments:{assessment:{location:{status:'new',placeId:null,name:'place '+current.id,reason:'current evidence',sourceIds:[current.id]},hypotheses:[],unresolved:['pending source check'],relations:[]}}},usage};
  };
  const reasoner=await createPiSpatialReasoner(join(dir,'pi'),request,{maxContextChars:1000,keepRecentTokens:400});
  service=await SpatialMemoryService.create(join(dir,'memory'),{async perceive(r){return {summary:'independent '+r.id+' visible '.repeat(100),details:['detail']};}},{reasoner});
  for(const [i,id] of ['a','b','c'].entries()){
   const views=[];for(const direction of ['front','left','right']){const path=join(dir,id+'-'+direction+'.png'),bytes=Buffer.from(id+direction);await writeFile(path,bytes);views.push({id,direction,path,sha256:createHash('sha256').update(bytes).digest('hex')});}
   await service.observe({id,atMs:i*1000,views});
  }
  await service.finishInput();assert.ok(compactions>0);assert.ok(historySeen);assert.equal(service.progress().spatialStates,3);
 }finally{await service?.close().catch(()=>{});if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(dir,{recursive:true,force:true});}
});

test('Pi session and skill run the spatial tool loop, commit durably and record skill versions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-pi-')),key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';
 const sources=join(dir,'sources');await mkdir(sources);
 const row=async(id:string,atMs:number):Promise<Observation>=>{const views=[];for(const direction of ['front','left','right']){const bytes=Buffer.from(id+direction),path=join(sources,id+'-'+direction+'.png');await writeFile(path,bytes);views.push({id,direction,path,sha256:createHash('sha256').update(bytes).digest('hex')});}return {id,atMs,views};};
  let timelineChecked=false,profileChecked=false;
 const request=async(input:any)=>{
   const data=input.data as any;assert.ok(Array.isArray(data.tools));assert.ok(data.tools.some((t:any)=>t.name==='memory_add'));
   if(data.current.id==='b'&&!profileChecked){profileChecked=true;return {output:{tool:'memory_place',arguments:{placeId:data.runtimeContext.workingContext.recent[0].assessment.location.placeId,assessment:{location:{status:'unknown',placeId:null,name:'待确认',reason:'read place profile',sourceIds:['b']},hypotheses:[],unresolved:[],relations:[]}}},usage};}
   if(data.current.id==='b'&&!timelineChecked){assert.equal(data.runtimeContext.lastToolResult.kind,'place-profile');assert.equal(data.runtimeContext.lastToolResult.profile.attributes[0].value,'red awning');assert.equal(data.runtimeContext.lastToolResult.profile.notes[0].text,'red awning');assert.equal(data.runtimeContext.lastToolResult.profile.visits[0].windows[0].observationId,'a');assert.deepEqual(data.runtimeContext.inspectedIds,['b']);assert.ok(data.runtimeContext.deliveredIds.includes('a'));}
   if(data.current.id==='b'&&!timelineChecked){timelineChecked=true;assert.ok(JSON.stringify(data.messages).includes('memory_add'));assert.ok(JSON.stringify(data.messages).includes('事实a'));assert.ok(!JSON.stringify(data.messages).includes('"kind":"timeline"'));return {output:{tool:'memory_timeline',arguments:{assessment:{location:{status:'unknown',placeId:null,name:'未知',reason:'先浏览历史',sourceIds:['b']},hypotheses:[],unresolved:[],relations:[]}}},usage};}
   return {output:{tool:'memory_add',arguments:{assessment:{location:{status:'new',placeId:null,name:'区域'+data.current.id,reason:'当前三摄布局',sourceIds:[data.current.id]},hypotheses:[],unresolved:[],relations:[],...data.current.id==='a'?{placeUpdates:[{key:'landmark',value:'red awning',status:'asserted',reason:'current image',sourceIds:['a']}]}:{}},notes:data.current.id==='a'?[{text:'red awning',sourceIds:['a']}]:[]}},usage};
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
   await service.close();
   await rm(join(dir,'pi','pi-checkpoints.jsonl'));
   let recoveryCalls=0;
   const restored=await createPiSpatialReasoner(join(dir,'pi'),async()=>{recoveryCalls++;throw Error('No network during recovery');},{resume:true});
   const recovered=await SpatialMemoryService.create(join(dir,'memory'),{async perceive(){throw Error('No extraction during recovery');}},{reasoner:restored,resume:true});
   try{assert.equal(recovered.progress().spatialStates,2);assert.equal(recoveryCalls,0);
    const rebuilt=(await readFile(join(dir,'pi','pi-checkpoints.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.deepEqual(rebuilt.map(c=>c.tipId),checkpoints.map(c=>c.tipId));assert.ok(rebuilt.every(c=>c.recovery==='verified-sqlite-tool-effect'));
   }finally{await recovered.close();}
   const corrupted=JSON.parse((await readFile(join(dir,'pi','pi-checkpoints.jsonl'),'utf8')).split('\n')[0]!);corrupted.session.id='foreign-session';
   await writeFile(join(dir,'pi','pi-checkpoints.jsonl'),JSON.stringify(corrupted)+'\n');
   await assert.rejects(createPiSpatialReasoner(join(dir,'pi'),async()=>{throw Error('No network');},{resume:true}),/Pi recovery Session mismatch/);
 }finally{await service.close();if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(dir,{recursive:true,force:true});}
});

test('Pi receives automatically recalled older-place images and can cite the inspected candidate as revisit evidence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-revisit-pi-')),key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';
 await mkdir(join(dir,'sources'));let service:SpatialMemoryService|undefined,firstPlace:string|null=null,secondPlace:string|null=null,candidateSeen=false;
 const request=async(input:any)=>{
  const id=input.data.current.id,unknown={location:{status:'unknown',placeId:null,name:'待确认',reason:'窗口判断',sourceIds:[id]},hypotheses:[],unresolved:[],relations:[]};
  const prior=input.data.runtimeContext.workingContext.recent.at(-1)?.assessment.location.placeId??null;
  if(!prior)return {output:{tool:'memory_add',arguments:{assessment:{...unknown,location:{status:'new',placeId:null,name:'旧地点',reason:'首个窗口建立当前区域',sourceIds:[id],regionChangeEvidence:['首次建立']}},notes:[]}},usage};
  firstPlace??=prior;
  if(!secondPlace){secondPlace='created';return {output:{tool:'memory_add',arguments:{assessment:{...unknown,location:{status:'new',placeId:null,name:'另一地点',reason:'正面换区证据',sourceIds:[id],regionChangeEvidence:['从旧区域移动到另一区域']}},notes:[]}},usage};}
  const candidate=input.data.runtimeContext.revisit?.candidates?.[0];if(!candidate)throw Error('missing automatic revisit candidate');
  candidateSeen=candidate.placeId===firstPlace;
  assert.ok(input.data.runtimeContext.inspectedIds.includes(candidate.matchedObservationId),'candidate evidence not inspected');
  assert.equal(input.images.length,13);
  return {output:{tool:'memory_add',arguments:{assessment:{...unknown,location:{status:'known',placeId:firstPlace,name:'旧地点',reason:'召回候选原图支持重访',sourceIds:[id,candidate.matchedObservationId],contextRefs:[candidate.matchedObservationId]}},notes:[]}},usage};
 };
 try{
  const reasoner=await createPiSpatialReasoner(join(dir,'pi'),request);
  service=await SpatialMemoryService.create(join(dir,'memory'),{async perceive(row){return {summary:'观察'+row.id,details:['布局']};}},{reasoner,windowMs:8000,revisitPolicy:'required',revisitMatcher:{async match(current,candidates){const c=candidates[0]!;return {ok:true,best:null,nearest:null,results:[{placeId:c.placeId,observationId:c.image.id,path:c.image.path,queryPath:current[0]!.path,inliers:28,similarity:0.8}]};}}});
  for(let i=0;i<12;i++){const id='p'+i,views=[];for(const direction of ['front','left','right']){const bytes=Buffer.from(id+direction),path=join(dir,'sources',id+'-'+direction+'.png');await writeFile(path,bytes);views.push({id,direction,path,sha256:createHash('sha256').update(bytes).digest('hex')});}await service.observe({id,atMs:i*2000,views});}
  await service.finishInput();
  const states=service.snapshotAt(3,Number.MAX_SAFE_INTEGER);assert.equal(states.state.assessment.location.status,'known');assert.match(states.state.assessment.location.reason,/召回候选原图支持重访/);assert.equal(candidateSeen,true);assert.equal(service.progress().places,2);
 }finally{await service?.close().catch(()=>{});await new Promise(resolve=>setTimeout(resolve,50));if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
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
    return {output:{tool:'memory_add',arguments:{assessment:{...unknown,location:{...unknown.location,status:'new',name:'甲区域'}}}},usage};
  }
  secondCalls++;
  if(secondCalls===1)return {output:{tool:'memory_timeline',arguments:{}} ,usage};
  if(secondCalls===2){assert.ok(JSON.stringify(input.data.messages).includes('assessment'));return {output:{tool:'memory_timeline',arguments:{assessment:unknown}},usage};}
  if(secondCalls===3){assert.equal(runtime.lastToolResult.kind,'timeline');assert.equal(runtime.workingContext.location.status,'unknown');return {output:{tool:'memory_read',arguments:{ids:['w0'],assessment:unknown}},usage};}
  if(secondCalls===4){assert.equal(runtime.lastToolResult.records[0].window.observations.length,4);return {output:{tool:'memory_inspect',arguments:{ids:['w0'],assessment:unknown}},usage};}
  assert.equal(input.images.length,6);assert.deepEqual(runtime.inspectedIds,['w7','w0']);
   return {output:{tool:'memory_add',arguments:{assessment:{...unknown,unresolved:[],location:{status:'known',placeId:runtime.workingContext.recent[0].assessment.location.placeId,name:'甲区域',reason:'检查过的历史原图支持重访',sourceIds:['w7','w0']}}}},usage};
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
