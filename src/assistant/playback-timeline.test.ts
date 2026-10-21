import {test} from 'node:test';
import assert from 'node:assert/strict';
import {alignQuestions,shortLocation,latestQuestionTimeline} from './playback-timeline.js';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';

test('recorded questions use source time and actual answer delay, matched by task ID',()=>{
 const result=alignQuestions([
  {kind:'campus-frame',atMs:1000,value:{episodeNumber:1,scheduleAtMs:28806000}},
  {kind:'task-created',atMs:1100,value:{id:'q1',text:'环境怎样？'}},
  {kind:'message-delivered',atMs:3100,value:{taskId:'q1',text:'室外通道。'}},
  {kind:'message-delivered',atMs:3200,value:{taskId:'other',text:'不属于这个问题'}}
 ]);
 assert.equal(result[0]?.atMs,28806000);assert.equal(result[0]?.answerAtMs,28808000);assert.equal(result[0]?.answer,'室外通道。');
});
test('position label exposes only a short name, never reason or an invented official place',()=>{
 assert.equal(shortLocation('可见红砖墙及连贯的室外通道布局。','place'),'室外通道');
 assert.equal(shortLocation('可见红砖墙。',null),'位置不确定');assert.equal(shortLocation('无法命名的布局','place'),'未命名地点');
});
test('frontend prefers the latest complete realistic story over a newer regression run',async()=>{
 const root=await mkdtemp(resolve('cam/local/story-timeline-test-'));
 try{
  for(const [name,dataset] of [['2026-01-story','realistic-stories-v1'],['2026-02-regression','original90-regression']]){
   const path=join(root,name!);await mkdir(path);await writeFile(join(path,'report.json'),JSON.stringify({mode:'question-only',completedScript:true,dataset}));
   await writeFile(join(path,'events.jsonl'),[{kind:'campus-frame',atMs:1,value:{episodeNumber:1,scheduleAtMs:28866000}},{kind:'task-created',atMs:2,value:{id:name,text:dataset}},{kind:'message-delivered',atMs:4,value:{taskId:name,text:'实际保存回答'}}].map(event=>JSON.stringify(event)).join('\n'));
  }
  const timeline=await latestQuestionTimeline(root);assert.equal(timeline.dataset,'realistic-stories-v1');assert.equal(timeline.questions[0]?.question,'realistic-stories-v1');assert.equal(timeline.questions[0]?.answer,'实际保存回答');
 }finally{await rm(root,{recursive:true,force:true});}
});
