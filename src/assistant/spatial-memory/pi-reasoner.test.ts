import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createPiSpatialReasoner} from './pi-reasoner.js';
import {SpatialMemoryService} from './service.js';
import type {Observation,Assessment} from './contracts.js';

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
   if(data.current.id==='b'&&!profileChecked){profileChecked=true;return {output:{tool:'memory_place',arguments:{placeId:data.runtimeContext.workingContext.recent[0].assessment.location.placeId,assessment:{location:{status:'new',placeId:null,name:'????',reason:'read place profile',sourceIds:['b']},hypotheses:[],unresolved:[],relations:[]}}},usage};}
   if(data.current.id==='b'&&!timelineChecked){assert.equal(data.runtimeContext.lastToolResult.kind,'place-profile');assert.equal(data.runtimeContext.lastToolResult.profile.attributes[0].value,'red awning');assert.equal(data.runtimeContext.lastToolResult.profile.notes[0].text,'red awning');assert.equal(data.runtimeContext.lastToolResult.profile.visits[0].windows[0].observationId,'a');assert.deepEqual(data.runtimeContext.inspectedIds,['b']);assert.ok(data.runtimeContext.deliveredIds.includes('a'));}
   if(data.current.id==='b'&&!timelineChecked){timelineChecked=true;assert.ok(JSON.stringify(data.messages).includes('memory_add'));assert.ok(JSON.stringify(data.messages).includes('事实a'));assert.ok(!JSON.stringify(data.messages).includes('"kind":"timeline"'));return {output:{tool:'memory_timeline',arguments:{assessment:{location:{status:'known',placeId:data.runtimeContext.workingContext.recent[0].assessment.location.placeId,name:'区域内部',reason:'先浏览历史',sourceIds:['b'],contextRefs:['a']},hypotheses:[],unresolved:[],relations:[]}}},usage};}
     if(data.current.id==='b'){const supplied=(data.runtimeContext.inspectedIds as string[]).filter(x=>x!=='b').slice(0,1);const cited=['b',...supplied];return {output:{tool:'memory_add',arguments:{assessment:{location:{status:'known',placeId:data.runtimeContext.workingContext.recent[0].assessment.location.placeId,name:'区域内部',reason:'当前布局延续，名称扩大',sourceIds:cited,contextRefs:['a']},hypotheses:[],unresolved:[],relations:[]},rename:{name:'区域内部',reason:'当前图片确认更广内部范围',sourceIds:cited}}},usage};}
    return {output:{tool:'memory_add',arguments:{assessment:{location:{status:'new',placeId:null,name:'区域'+data.current.id,reason:'当前三摄布局',sourceIds:[data.current.id]},hypotheses:[],unresolved:[],relations:[],...data.current.id==='a'?{placeUpdates:[{key:'landmark',value:'red awning',status:'asserted',reason:'current image',sourceIds:['a']}]}:{}},notes:data.current.id==='a'?[{text:'red awning',sourceIds:['a']}]:[]}},usage};
 };
 const reasoner=await createPiSpatialReasoner(join(dir,'pi'),request);
 const service=await SpatialMemoryService.create(join(dir,'memory'),{async perceive(r){return {summary:'事实'+r.id,details:['细节'+r.id]};}},{reasoner});
 try{
  await service.observe(await row('a',0));await service.observe(await row('b',1000));await service.finishInput();
  assert.equal(service.progress().spatialStates,2);assert.equal(timelineChecked,true);
   assert.equal(service.latest()!.state.assessment.location.status,'known');
   assert.equal(service.latest()!.state.memoryReceipt!.renamedPlace,true);assert.equal(service.latest()!.state.assessment.placeRename!.name,'区域内部');assert.equal(service.progress().places,1);
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
 await mkdir(join(dir,'sources'));let service:SpatialMemoryService|undefined,firstPlace:string|null=null,secondPlace:string|null=null,candidateSeen=false,candidateInspected=false;
 const request=async(input:any)=>{
  const id=input.data.current.id,unknown={location:{status:'new',placeId:null,name:'待确认',reason:'窗口判断',sourceIds:[id]},hypotheses:[],unresolved:[],relations:[]};
  const prior=input.data.runtimeContext.workingContext.recent.at(-1)?.assessment.location.placeId??null;
  if(!prior)return {output:{tool:'memory_add',arguments:{assessment:{...unknown,location:{status:'new',placeId:null,name:'旧地点',reason:'首个窗口建立当前区域',sourceIds:[id],regionChangeEvidence:['首次建立']}},notes:[]}},usage};
  firstPlace??=prior;
  if(!secondPlace){secondPlace='created';return {output:{tool:'memory_add',arguments:{assessment:{...unknown,location:{status:'new',placeId:null,name:'另一地点',reason:'正面换区证据',sourceIds:[id],regionChangeEvidence:['从旧区域移动到另一区域']}},notes:[]}},usage};}
  const candidate=input.data.runtimeContext.revisit?.candidates?.[0];if(!candidate)throw Error('missing automatic revisit candidate');
  candidateSeen=candidate.placeId===firstPlace;
  if(!candidateInspected){
   candidateInspected=true;assert.equal(input.images.length,12,'candidate images must not displace current window images');
   return {output:{tool:'memory_add',arguments:{assessment:{...unknown,location:{status:'new',placeId:null,name:'待核对的新地点',reason:'场景变化但尚未核对旧候选',sourceIds:input.data.runtimeContext.window.observations.map((o:any)=>o.id),regionChangeEvidence:['室内外环境变化']}},notes:[]}},usage};
  }
  assert.equal(input.data.runtimeContext.lastToolResult.kind,'revisit-inspection');
  assert.ok(input.data.runtimeContext.inspectedIds.includes(candidate.matchedObservationId),'candidate evidence not inspected');
  assert.equal(input.images.length,6);
  const currentWindow=input.data.runtimeContext.window.observations.map((o:any)=>o.id);
  return {output:{tool:'memory_add',arguments:{assessment:{...unknown,location:{status:'known',placeId:firstPlace,name:'旧地点',reason:'召回候选原图支持重访',sourceIds:[...currentWindow,candidate.matchedObservationId],contextRefs:[candidate.matchedObservationId]}},notes:[]}},usage};
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
  const prior=()=>runtime.workingContext.recent[0]?.assessment.location.placeId??null;
  const interim:()=>Assessment=()=>prior()?{location:{status:'known',placeId:prior(),name:'甲区域',reason:'当前窗口待检查历史',sourceIds:[id],contextRefs:[runtime.workingContext.recent[0].observationId]},hypotheses:[],unresolved:['确认历史身份'],relations:[]}:{location:{status:'new',placeId:null,name:'甲区域',reason:'首个窗口建立',sourceIds:[id],regionChangeEvidence:['首次建立']},hypotheses:[],unresolved:[],relations:[]};
  if(id==='w3'){
   assert.equal(input.images.length,12);
    return {output:{tool:'memory_add',arguments:{assessment:{...interim(),location:{...interim().location,status:'new',placeId:null,name:'甲区域',regionChangeEvidence:['首次建立']}}}},usage};
  }
  secondCalls++;
  if(secondCalls===1)return {output:{tool:'memory_timeline',arguments:{}} ,usage};
  if(secondCalls===2){assert.ok(JSON.stringify(input.data.messages).includes('assessment'));return {output:{tool:'memory_timeline',arguments:{assessment:interim()}},usage};}
  if(secondCalls===3){assert.equal(runtime.lastToolResult.kind,'timeline');assert.equal(runtime.workingContext.location.status,'known');return {output:{tool:'memory_read',arguments:{ids:['w0'],assessment:interim()}},usage};}
  if(secondCalls===4){assert.equal(runtime.lastToolResult.records[0].window.observations.length,4);return {output:{tool:'memory_inspect',arguments:{ids:['w0'],assessment:interim()}},usage};}
  assert.equal(input.images.length,6);assert.deepEqual(runtime.inspectedIds,['w4','w5','w6','w7','w0']);
   return {output:{tool:'memory_add',arguments:{assessment:{...interim(),unresolved:[],location:{status:'known',placeId:runtime.workingContext.recent[0].assessment.location.placeId,name:'甲区域',reason:'检查过的历史原图支持重访',sourceIds:['w7','w0']}}}},usage};
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

test('known claims that cite read-but-uninspected history receive those originals; unknown place IDs list real ones',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-known-history-')),key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';
 await mkdir(join(dir,'sources'));let service:SpatialMemoryService|undefined,step=0,placeId='';
 const row=async(id:string,atMs:number)=>{const views=[];for(const direction of ['front','left','right']){const bytes=Buffer.from(id+direction),path=join(dir,'sources',id+'-'+direction+'.png');await writeFile(path,bytes);views.push({id,direction,path,sha256:createHash('sha256').update(bytes).digest('hex')});}return {id,atMs,views};};
 const request=async(input:any)=>{
  const id=input.data.current.id,runtime=input.data.runtimeContext,base={hypotheses:[],unresolved:[],relations:[]};
  if(id==='h3')return {output:{tool:'memory_add',arguments:{assessment:{location:{status:'new',placeId:null,name:'����',reason:'�״ν���',sourceIds:[id]},...base}}},usage};
  step++;
  if(step===1)return {output:{tool:'memory_timeline',arguments:{assessment:{location:{status:'known',placeId:placeId||runtime.workingContext.recent[0].assessment.location.placeId,name:'??',reason:'????',sourceIds:[id],contextRefs:[runtime.workingContext.recent[0].observationId]},...base}}},usage};
  if(step===2){assert.equal(runtime.lastToolResult.kind,'timeline');
   return {output:{tool:'memory_add',arguments:{assessment:{location:{status:'known',placeId:placeId||runtime.workingContext.recent[0].assessment.location.placeId,name:'����',reason:'��ʷͬ����',sourceIds:[id,'h3'],contextRefs:['h3']},...base}}},usage};}
  if(step===3){assert.equal(runtime.lastToolResult.kind,'historical-evidence-inspection');assert.deepEqual(runtime.lastToolResult.observationIds,['h3']);assert.ok(runtime.inspectedIds.includes('h3'));assert.equal(input.images.length,6);
   return {output:{tool:'memory_add',arguments:{assessment:{location:{status:'known',placeId:runtime.workingContext.recent[0].assessment.location.placeId,name:'����',reason:'�����ʷԭͼ��ȷ��ͬ����',sourceIds:[id,'h3'],contextRefs:['h3']},...base}}},usage};}
  if(step===4){assert.match(String(runtime.feedback?.error),/not an existing place/);assert.match(String(runtime.feedback?.error),/Place IDs that actually appear in this session/);
   return {output:{tool:'memory_add',arguments:{assessment:{location:{status:'new',placeId:null,name:'?????',reason:'????',sourceIds:[id]},...base}}},usage};}
  return {output:{tool:'memory_add',arguments:{assessment:{location:{status:'new',placeId:null,name:'?????',reason:'????',sourceIds:[id]},...base}}},usage};
 };
 try{
  const reasoner=await createPiSpatialReasoner(join(dir,'pi'),request);
  service=await SpatialMemoryService.create(join(dir,'memory'),{async perceive(r){return {summary:'�۲�'+r.id,details:['����']};}},{reasoner,windowMs:8000});
  for(let i=0;i<4;i++)await service.observe(await row('h'+i,i*2000));
  await service.finishInput();
  placeId=service.latest()!.state.assessment.location.placeId!;
  for(let i=4;i<8;i++)await service.observe(await row('h'+i,i*2000));
  await service.finishInput();
  assert.equal(service.progress().spatialStates,2);
 }finally{await service?.close().catch(()=>{});await new Promise(r=>setTimeout(r,50));if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});

test('a known claim with no delivered support receives that place newest stored window once',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-known-nosupport-')),key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';
 await mkdir(join(dir,'sources'));let service:SpatialMemoryService|undefined,calls=0;
 const row=async(id:string,atMs:number)=>{const views=[];for(const direction of ['front','left','right']){const bytes=Buffer.from(id+direction),path=join(dir,'sources',id+'-'+direction+'.png');await writeFile(path,bytes);views.push({id,direction,path,sha256:createHash('sha256').update(bytes).digest('hex')});}return {id,atMs,views};};
 const request=async(input:any)=>{
  const id=input.data.current.id,rt=input.data.runtimeContext,base={hypotheses:[],unresolved:[],relations:[]};
  if(id==='k3')return {output:{tool:'memory_add',arguments:{assessment:{location:{status:'new',placeId:null,name:'??',reason:'??',sourceIds:[id]},...base}}},usage};
  calls++;
  if(calls===1)return {output:{tool:'memory_add',arguments:{assessment:{location:{status:'known',placeId:rt.workingContext.recent[0].assessment.location.placeId,name:'??',reason:'????????????',sourceIds:[id]},...base}}},usage};
  assert.equal(rt.lastToolResult.kind,'historical-evidence-inspection');assert.equal(rt.lastToolResult.placeId,rt.workingContext.recent[0].assessment.location.placeId);assert.ok(rt.inspectedIds.includes(rt.lastToolResult.observationIds[0]));
  return {output:{tool:'memory_add',arguments:{assessment:{location:{status:'known',placeId:rt.lastToolResult.placeId,name:'??',reason:'??????????',sourceIds:[id,rt.lastToolResult.observationIds[0]]},...base}}},usage};
 };
 try{
  const reasoner=await createPiSpatialReasoner(join(dir,'pi'),request);
  service=await SpatialMemoryService.create(join(dir,'memory'),{async perceive(r){return {summary:'??'+r.id,details:['??']};}},{reasoner,windowMs:8000});
  for(let i=0;i<4;i++)await service.observe(await row('k'+i,i*2000));
  await service.finishInput();
  for(let i=4;i<8;i++)await service.observe(await row('k'+i,i*2000));
  await service.finishInput();
  assert.equal(calls,2);assert.equal(service.progress().spatialStates,2);
 }finally{await service?.close().catch(()=>{});await new Promise(r=>setTimeout(r,50));if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});

test('a bare unknown is rejected while a boundary transition stays available',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-no-unknown-')),key=process.env.QWEN_API_KEY;process.env.QWEN_API_KEY='mock';
 await mkdir(join(dir,'sources'));let service:SpatialMemoryService|undefined,calls=0,sawUnknown=false;
 const row=async(id:string,atMs:number)=>{const views=[];for(const direction of ['front','left','right']){const bytes=Buffer.from(id+direction),path=join(dir,'sources',id+'-'+direction+'.png');await writeFile(path,bytes);views.push({id,direction,path,sha256:createHash('sha256').update(bytes).digest('hex')});}return {id,atMs,views};};
 const request=async(input:any)=>{
  const id=input.data.current.id,runtime=input.data.runtimeContext,base={hypotheses:[],unresolved:[],relations:[]};
  // The schema must not offer an undetermined status at all.
  const schema=JSON.stringify(input.data.tools);assert.ok(schema.includes('known')&&schema.includes('unknown')&&schema.includes('boundary'),'schema must expose the boundary transition');
  calls++;
  if(calls===1){
   // A bare unknown must be refused, and the refusal must name the replacement statuses.
   return {output:{tool:'memory_add',arguments:{assessment:{location:{status:'unknown',placeId:null,name:'����',reason:'��ȷ��',sourceIds:[id]},...base}}},usage};
  }
  if(calls===2){const feedback=JSON.stringify(runtime.feedback?.error);assert.match(feedback,/boundary/);sawUnknown=true;
   return {output:{tool:'memory_add',arguments:{assessment:{location:{status:'new',placeId:null,name:'�����',reason:'�״ν�����ǰ����',sourceIds:[id],regionChangeEvidence:['�׸�����']},...base}}},usage};}
  return {output:{tool:'memory_add',arguments:{assessment:{location:{status:'known',placeId:runtime.workingContext.recent[0].assessment.location.placeId,name:'�����',reason:'��������',sourceIds:[id],contextRefs:[runtime.workingContext.recent[0].observationId]},...base}}},usage};
 };
 try{
  const reasoner=await createPiSpatialReasoner(join(dir,'pi'),request);
  service=await SpatialMemoryService.create(join(dir,'memory'),{async perceive(r){return {summary:'�۲�'+r.id,details:['����']};}},{reasoner,windowMs:8000});
  for(let i=0;i<4;i++)await service.observe(await row('u'+i,i*2000));await service.finishInput();
  assert.equal(sawUnknown,true);assert.equal(service.progress().spatialStates,1);assert.ok(['new','known'].includes(service.latest()!.state.assessment.location.status));assert.notEqual(service.latest()!.state.assessment.location.status,'unknown');
  const states=(await readFile(join(dir,'memory','spatial.sqlite')))?.length;assert.ok(states>0);
 }finally{await service?.close().catch(()=>{});await new Promise(r=>setTimeout(r,50));if(key===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=key;await rm(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
