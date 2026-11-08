import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createLayeredApplication,defaultLayeredOptions} from './layered-application.js';
import type {V3Request} from './pi-session-v3.js';
import type {Observation} from './contracts.js';
import type {PlaceMatcher} from './revisit-candidates.js';
const response=(tool:string,args:unknown)=>({output:{tool,arguments:args},usage:{prompt_tokens:10,completion_tokens:10}});
const facts={summary:'room',details:['fixed counter and doorway']};
const matcher:PlaceMatcher={async match(_current,candidates){return {ok:true,best:null,nearest:null,results:candidates.map(c=>({placeId:c.placeId,observationId:c.image.id,inliers:3,similarity:.1}))};}};
function fixture(){const root=mkdtempSync(join(tmpdir(),'layered-app-')),path=join(root,'source.png');writeFileSync(path,'source');const sha256=createHash('sha256').update('source').digest('hex');const row=(n:number):Observation=>({id:'o'+n,atMs:n*2000,views:['front','left','right'].map(direction=>({id:'o'+n,direction,path,sha256}))});return {root,row};}
const perception:V3Request=async r=>({observations:(r.data as any).observations.map((o:any)=>({id:o.id,facts}))});
const question:V3Request=async r=>{const context=(r.data as any).runtimeContext;return response('memory_answer',{answer:context.observations.length?'Visible room; spatial location may be pending.':'No observations yet.',sourceIds:context.observations.filter((o:any)=>o.facts).map((o:any)=>o.id)});};

test('real Pi v3 Session runs facts-first, recalls and inspects a revisit, preserves private QA and explicitly resumes without re-inference',async()=>{
 const f=fixture();let calls=0,firstRequestImages=-1;
 const spatial:V3Request=async r=>{
  calls++;const context=(r.data as any).runtimeContext,batch=context.batch;
  const candidates=context.revisit.flatMap((range:any)=>range.candidates);
  if(firstRequestImages<0)firstRequestImages=r.images.length;
  if(candidates.length&&!context.inspectedIds.includes(candidates[0].matchedObservationId))return response('memory_inspect',{ids:[batch.observations.at(-1).id,candidates[0].matchedObservationId]});
  const old=candidates[0];return response('memory_propose',{segments:[{observationIds:batch.observations.map((o:any)=>o.id),assessment:{location:{status:old?'known':'new',placeId:old?.placeId??null,name:'room',reason:'specific fixed layout matches inspected source',sourceIds:[batch.observations.at(-1).id,...old?[old.matchedObservationId]:[]]},hypotheses:[],unresolved:[],relations:[],memoryNotes:[{text:'fixed counter',sourceIds:[batch.observations.at(-1).id]}]}}]});
 };
 let app=await createLayeredApplication(join(f.root,'run'),{perception,spatial,question},{matcher});
 try{
  const empty=await app.ask('What is ahead?');assert.equal(empty.spatialVersion,0);assert.equal(empty.sourceIds.length,0);
  app.observe(f.row(0));await app.finishInput();assert.equal(firstRequestImages,0);assert.equal(app.progress().spatialVersion,1);
  app.observe(f.row(20));await app.finishInput();assert.equal(app.progress().spatialVersion,2);assert.equal(calls,3);
  const answer=await app.ask('Where am I?');assert.equal(answer.spatialVersion,2);assert.equal(app.progress().spatialVersion,2);
  await app.close();
  app=await createLayeredApplication(join(f.root,'run'),{perception,spatial,question},{matcher,resume:true});await app.finishInput();assert.equal(calls,3);assert.equal(app.progress().spatialVersion,2);
 }finally{await app.close();rmSync(f.root,{recursive:true,force:true});}
});

test('question has a reserved slot while the actual spatial model request is blocked; second writer is refused',async()=>{
 const f=fixture();let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{started=r;});
 const spatial:V3Request=async r=>{started();await gate;const batch=(r.data as any).runtimeContext.batch;return response('memory_propose',{segments:[{observationIds:batch.observations.map((o:any)=>o.id),assessment:{location:{status:'new',placeId:null,name:'room',reason:'visible layout',sourceIds:[batch.observations.at(-1).id]},hypotheses:[],unresolved:[],relations:[]}}]});};
 const app=await createLayeredApplication(join(f.root,'run'),{perception,spatial,question},{matcher,runtime:{...defaultLayeredOptions,requestTimeoutMs:10000}});
 try{
  app.observe(f.row(0));const drain=app.finishInput();await ready;
  assert.equal(app.progress().requestSlots.spatial,1);
  const answer=await app.ask('What can you see?');assert.equal(answer.spatialVersion,0);assert.deepEqual(answer.sourceIds,['o0']);
  await assert.rejects(()=>createLayeredApplication(join(f.root,'run'),{perception,spatial,question},{resume:true,matcher}),/live process/);
  release();await drain;
 }finally{release();await app.close();rmSync(f.root,{recursive:true,force:true});}
});

test('crash after real Pi/SQLite batch commit is reconciled without another paid/model call',async()=>{
 const f=fixture(),run=join(f.root,'crash-run'),script=join(f.root,'crash.mjs');
 writeFileSync(script,`
 import {createLayeredApplication} from ${JSON.stringify(new URL('./layered-application.js',import.meta.url).href)};
 import {ObservationArchive} from ${JSON.stringify(new URL('./observation-archive.js',import.meta.url).href)};
 const original=ObservationArchive.prototype.jobStatus;
 ObservationArchive.prototype.jobStatus=function(id,status,error){if(id.startsWith('spatial:')&&status==='done')process.exit(17);return original.call(this,id,status,error);};
 const row=${JSON.stringify(f.row(0))};
 const perception=async r=>({observations:r.data.observations.map(o=>({id:o.id,facts:{summary:'room',details:['fixed counter']}}))});
 const spatial=async r=>({output:{tool:'memory_propose',arguments:{segments:[{observationIds:['o0'],assessment:{location:{status:'new',placeId:null,name:'room',reason:'visible counter',sourceIds:['o0']},hypotheses:[],unresolved:[],relations:[]}}]}},usage:{prompt_tokens:1,completion_tokens:1}});
 const matcher={match:async()=>({ok:true,best:null,nearest:null,results:[]})};
 const app=await createLayeredApplication(${JSON.stringify(run)},{perception,spatial,question:spatial},{matcher});app.observe(row);await app.finishInput();
 `);
 const child=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:15000});assert.equal(child.status,17,child.stderr);
 let calls=0;const forbidden:V3Request=async()=>{calls++;throw Error('Unexpected model call during reconciliation');};
 const app=await createLayeredApplication(run,{perception:forbidden,spatial:forbidden,question},{matcher,resume:true});
 try{await app.finishInput();assert.equal(calls,0);assert.equal(app.progress().spatialVersion,1);assert.equal(app.progress().spatialThroughSequence,1);assert.equal(JSON.parse(readFileSync(join(run,'writer.lock'),'utf8')).pid,process.pid);}finally{await app.close();rmSync(f.root,{recursive:true,force:true});}
});

test('interrupted real Pi tool loop resumes the same batch/Session without silently forking',async()=>{
 const f=fixture(),run=join(f.root,'interrupted-run'),script=join(f.root,'interrupt.mjs');
 writeFileSync(script,`
 import {createLayeredApplication} from ${JSON.stringify(new URL('./layered-application.js',import.meta.url).href)};
 let calls=0;
 const perception=async r=>({observations:r.data.observations.map(o=>({id:o.id,facts:{summary:'room',details:['counter']}}))});
 const spatial=async()=>{if(++calls===2)process.exit(18);return {output:{tool:'memory_inspect',arguments:{ids:['o0']}},usage:{prompt_tokens:1,completion_tokens:1}};};
 const app=await createLayeredApplication(${JSON.stringify(run)},{perception,spatial,question:spatial},{matcher:{match:async()=>({ok:true,best:null,nearest:null,results:[]})}});app.observe(${JSON.stringify(f.row(0))});await app.finishInput();
 `);
 const child=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:15000});assert.equal(child.status,18,child.stderr);
 const before=JSON.parse(readFileSync(join(run,'space-session','session.json'),'utf8')).id;let calls=0;
 const spatial:V3Request=async r=>{calls++;const batch=(r.data as any).runtimeContext.batch;return response('memory_propose',{segments:[{observationIds:batch.observations.map((o:any)=>o.id),assessment:{location:{status:'new',placeId:null,name:'room',reason:'current facts',sourceIds:['o0']},hypotheses:[],unresolved:[],relations:[]}}]});};
 const app=await createLayeredApplication(run,{perception,spatial,question},{matcher,resume:true});
 try{await app.finishInput();assert.equal(app.progress().spatialVersion,1,JSON.stringify(app.progress()));assert.equal(calls,1);assert.equal(JSON.parse(readFileSync(join(run,'space-session','session.json'),'utf8')).id,before);}finally{await app.close();rmSync(f.root,{recursive:true,force:true});}
});

test('question can inspect raw current images before any fast facts or spatial result; unviewed citations are rejected',async()=>{
 const f=fixture();let fastCalls=0,questionCalls=0;
 const fast:V3Request=async r=>{fastCalls++;return perception(r);};
 const qa:V3Request=async r=>{
  questionCalls++;const context=(r.data as any).runtimeContext;assert.equal(context.spatialVersion,0);
  if(questionCalls===1)return response('memory_answer',{answer:'unsupported draft',sourceIds:['o0']});
  if(questionCalls===2){assert.match(JSON.stringify((r.data as any).runtimeContext.feedback),/not read or inspected/);return response('memory_inspect',{ids:['o0']});}
  assert.equal(r.images.length,3);return response('memory_answer',{answer:'Current raw image shows a room.',sourceIds:['o0'],temporaryLocation:'room, not yet a committed spatial identity'});
 };
 const spatial:V3Request=async()=>response('memory_propose',{segments:[{observationIds:['o0'],assessment:{location:{status:'new',placeId:null,name:'room',reason:'current facts',sourceIds:['o0']},hypotheses:[],unresolved:[],relations:[]}}]});
 const app=await createLayeredApplication(join(f.root,'run'),{perception:fast,spatial,question:qa},{matcher});
 try{app.observe(f.row(0));const answer=await app.ask('What is here?');assert.equal(fastCalls,0);assert.equal(questionCalls,3);assert.equal(answer.spatialVersion,0);assert.deepEqual(answer.sourceIds,['o0']);assert.equal(app.progress().spatialVersion,0);}finally{await app.close();rmSync(f.root,{recursive:true,force:true});}
});

test('question visual recall is pinned and read-only, not a second spatial writer',async()=>{
 const f=fixture();let questionCalls=0,oldId='';
 const spatial:V3Request=async r=>{const batch=(r.data as any).runtimeContext.batch;return response('memory_propose',{segments:[{observationIds:batch.observations.map((o:any)=>o.id),assessment:{location:{status:'new',placeId:null,name:'room',reason:'visible layout',sourceIds:[batch.observations.at(-1).id]},hypotheses:[],unresolved:[],relations:[]}}]});};
 const qa:V3Request=async r=>{
  questionCalls++;const ctx=(r.data as any).runtimeContext;
  if(questionCalls===1)return response('memory_revisit',{ids:['o20']});
  if(questionCalls===2){const messages=(r.data as any).messages;const result=messages.filter((m:any)=>m.role==='toolResult').at(-1);const recalled=JSON.parse(result.content.find((c:any)=>c.type==='text').text);const candidates=recalled.ranges.flatMap((range:any)=>range.candidates);assert.equal(candidates.length,1);assert.equal('bestInliers' in candidates[0],false);oldId=candidates[0].matchedObservationId;return response('memory_inspect',{ids:['o20',oldId]});}
  assert.equal(ctx.spatialVersion,1);assert.equal(r.images.length,6);return response('memory_answer',{answer:'Current view is consistent with the earlier room; temporary comparison only.',sourceIds:['o20',oldId],temporaryLocation:'same room candidate'});
 };
 const app=await createLayeredApplication(join(f.root,'run'),{perception,spatial,question:qa},{matcher});
 try{
  app.observe(f.row(0));await app.finishInput();app.observe(f.row(20));
  const db=new DatabaseSync(join(f.root,'run','memory','spatial.sqlite'),{readOnly:true});const before=(db.prepare('SELECT COUNT(*) AS n FROM events').get() as any).n;
  const answer=await app.ask('Have I returned here?');assert.equal(answer.spatialVersion,1);assert.equal(app.progress().spatialVersion,1);assert.equal((db.prepare('SELECT COUNT(*) AS n FROM events').get() as any).n,before);db.close();
 }finally{await app.close();rmSync(f.root,{recursive:true,force:true});}
});
