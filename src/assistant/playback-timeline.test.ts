import {test} from 'node:test';
import assert from 'node:assert/strict';
import {alignQuestions,shortLocation} from './playback-timeline.js';

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
