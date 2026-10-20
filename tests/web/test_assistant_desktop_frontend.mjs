import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {projectRecording} from '../../web/desktop/view-model.js';

test('simple frontend has only view, question and spoken-text sections',async()=>{
 const html=await readFile(new URL('../../web/desktop/index.html',import.meta.url),'utf8');
 assert.equal((html.match(/<section\b/g)??[]).length,3);
 for(const title of ['当前视图','用户问题','VLM语音输出'])assert.ok(html.includes(title));
 for(const hidden of ['原始JSON','任务与能力边界','开发诊断','/recording.js'])assert.equal(html.includes(hidden),false);
});
test('playback shows only delivered speech, never raw VLM reasoning or future frames',()=>{
 const events=[
  {kind:'task-created',atMs:1,value:{id:'q',text:'这是哪里？'}},
  {kind:'campus-frame',value:{id:'first',views:[]}},
  {kind:'vlm-language',value:{output:{assessments:[{reason:'不应显示'}]}}},
  {kind:'message-delivered',value:{id:'a',atMs:4,text:'这里是室外。'}},
  {kind:'campus-frame',value:{id:'future',views:[]}}
 ];
 const waiting=projectRecording(events,2);assert.equal(waiting.frame.id,'first');assert.equal(waiting.answers.length,0);assert.equal(waiting.questions[0].text,'这是哪里？');
 const answered=projectRecording(events,3);assert.equal(answered.answers[0].text,'这里是室外。');assert.equal(answered.frame.id,'first');assert.equal(JSON.stringify(answered).includes('不应显示'),false);
});
