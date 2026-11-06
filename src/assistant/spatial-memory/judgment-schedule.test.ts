import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {judgmentSchedule} from './judgment-schedule.js';
import {SpatialMemoryService} from './service.js';
import type {Observation,Assessment,SpatialReasoner} from './contracts.js';

const usageAssessment=(id:string):Assessment=>({location:{status:'new',placeId:null,name:'区域'+id,reason:'首个窗口建立',sourceIds:[id],regionChangeEvidence:['首次建立']},hypotheses:[],unresolved:[],relations:[]});

test('judgment schedule judges every window by default and decimates deterministically otherwise',()=>{
  assert.deepEqual(judgmentSchedule({sinceJudged:null,stride:1}),{judge:true,reason:'first-window'});
  assert.deepEqual(judgmentSchedule({sinceJudged:0,stride:1}),{judge:true,reason:'first-window'});
  assert.deepEqual(judgmentSchedule({sinceJudged:null,stride:2}),{judge:true,reason:'first-window'});
  assert.deepEqual(judgmentSchedule({sinceJudged:1,stride:2}),{judge:false,reason:'scheduled-decimation'});
  assert.deepEqual(judgmentSchedule({sinceJudged:2,stride:2}),{judge:true,reason:'stride-due'});
  assert.deepEqual(judgmentSchedule({sinceJudged:3,stride:3}),{judge:true,reason:'stride-due'});
  assert.deepEqual(judgmentSchedule({sinceJudged:2,stride:3}),{judge:false,reason:'scheduled-decimation'});
  assert.throws(()=>judgmentSchedule({sinceJudged:0,stride:0}),/stride/);
  assert.throws(()=>judgmentSchedule({sinceJudged:-1,stride:2}),/sinceJudged/);
});

test('stride 2 carries every other window as scheduled evidence and the successor sees it',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-stride-')),root=join(dir,'memory');
  await mkdir(join(dir,'sources'));
  const row=async(id:string,atMs:number):Promise<Observation>=>({id,atMs,recordingId:'recording',views:await Promise.all(['front','left','right'].map(async direction=>{const bytes=Buffer.from(id+direction),path=join(dir,'sources',id+'-'+direction+'.png');await writeFile(path,bytes);return {id,direction,path,sha256:createHash('sha256').update(bytes).digest('hex')};}))});
  const judged:string[]=[];let carriedSeen:any=null;
  const reasoner:SpatialReasoner={async judge(input){
    judged.push(input.row.id);
    if(input.window?.skippedBefore?.length){
      carriedSeen=input.window.skippedBefore.map(w=>({reason:w.reason,ids:w.observations.map(o=>o.id),facts:w.observations.map(o=>!!o.facts)}));
      assert.equal(input.window.skippedBefore.length,1,'stride 2 carries exactly one window per judgment');
    }
    const a=usageAssessment(input.row.id);
    await input.commit(a,{inspected:new Set([input.row.id]),delivered:new Set()});
    return a;
  },async close(){}};
  let service:SpatialMemoryService|undefined;
  try{
    service=await SpatialMemoryService.create(root,{async perceive(row){return {summary:'观察'+row.id,details:['布局']};},async perceiveWindow(rows){return rows.map(r=>({id:r.id,facts:{summary:'观察'+r.id,details:['布局']}}));}},{reasoner,windowMs:8000,busyPolicy:'skip-obsolete',maxPending:16,judgmentStride:2});
    for(let i=0;i<12;i++)await service.observe(await row('s'+i,i*2000));
    await service.finishInput();
    const progress=service.progress();
    assert.deepEqual(judged,['s3','s11'],'only the first and third window run a full judgment');
    assert.equal(progress.spatialStates,2);
    assert.equal(progress.skippedWindows,1);
    assert.deepEqual(progress.skippedByReason,{'scheduled-decimation':1});
    assert.equal(progress.coveredObservations,8,'carried observations are not claimed as covered');
    assert.deepEqual(carriedSeen,[{reason:'scheduled-decimation',ids:['s4','s5','s6','s7'],facts:[true,true,true,true]},]);
  }finally{await service?.close().catch(()=>{});await rm(dir,{recursive:true,force:true});}
});

test('stride above one requires window mode with the skip path',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'opencode/spatial-stride-invalid-'));
  try{
    await assert.rejects(SpatialMemoryService.create(join(dir,'a'),{async perceive(row){return {summary:'x',details:[]};}},{judgmentStride:2}),/window mode with skip-obsolete/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
