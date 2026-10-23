import {projectRecording,projectAtTime,formatSampleTime} from './view-model.js';
import {createComparisonView} from './comparison-view.js';
const $=id=>document.getElementById(id);
let mode='recording',recording=null,index=0,timer=null,liveRunning=false,polling=false,selection=0;
let imageKey='',questionKey='',answerKey='';
let videos=[],memoryReady=false,videoEpisode=null;
let playbackTimeline={questions:[],positions:[]};
let comparisonData=null,comparisonView=null;
const video=$('continuous-video');
let tailTimer=null,tailElapsed=0;
function stopTail(){if(tailTimer!==null)clearInterval(tailTimer);tailTimer=null;tailElapsed=0;}
const say=text=>{$('status').textContent=text;};
async function get(path){const response=await fetch(path);const value=await response.json();if(!response.ok)throw Error(value.error??'连接失败');return value;}
async function post(path,value){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const data=await response.json();if(!response.ok)throw Error(data.error??'请求失败');return data;}
function images(views=[]){
 const ordered=['left','front','right'].flatMap(direction=>views.filter(v=>v.direction===direction));
 const key=JSON.stringify(ordered);if(key===imageKey)return;imageKey=key;$('views').replaceChildren();
 if(!ordered.length){const p=document.createElement('p');p.className='empty';p.textContent='等待画面';$('views').append(p);}
 for(const view of ordered){const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');image.src=view.url;image.alt=({left:'左侧视图',front:'前方视图',right:'右侧视图'})[view.direction]??'当前视图';caption.textContent=image.alt;figure.append(image,caption);$('views').append(figure);}
}
function messages(id,rows,empty){
 const key=JSON.stringify(rows);if(id==='questions'&&key===questionKey||id==='answers'&&key===answerKey)return;
 if(id==='questions')questionKey=key;else answerKey=key;
 const box=$(id);box.replaceChildren();
 if(!rows.length){const p=document.createElement('p');p.className='empty';p.textContent=empty;box.append(p);}
  for(const row of rows){const item=document.createElement('article');item.className='message';const time=document.createElement('small');time.textContent=row.sampleTime?formatSampleTime(row.atMs):new Date(row.atMs).toLocaleTimeString();const text=document.createElement('div');text.textContent=row.text;item.append(time,text);box.append(item);}box.scrollTop=box.scrollHeight;
}
function stop(){if(timer!==null)clearTimeout(timer);timer=null;$('play').textContent='播放';}
function renderVideoTime(seconds=video.currentTime){
 if(!videoEpisode)return;
 const atMs=videoEpisode.sourceScheduleStartMs+seconds*1000+tailElapsed;
 const view=projectAtTime(playbackTimeline,videoEpisode.episodeNumber,atMs);
  $('sample-time').textContent=formatSampleTime(videoEpisode.sourceScheduleStartMs+seconds*1000);$('location-name').textContent=view.location;
  if(comparisonView){const selected=$('method-view').value;const event=comparisonView.render(videoEpisode.episodeNumber,atMs,selected);$('location-name').textContent=selected==='all'?'见下方三方法对比':event?.name??'尚未有识别结果';}
 messages('questions',view.question?[{id:view.question.id,text:view.question.question,atMs:view.question.atMs,sampleTime:true}]:[],'等待下一个问题');
 messages('answers',view.answer!==null?[{id:view.question.id,text:view.answer,atMs:view.question.answerAtMs,sampleTime:true}]:[],view.question?'用户问题Agent正在回答…':'等待助手回答');
}
function renderRecording(){
 if(!recording)return;
  const view=projectRecording(recording.timeline,index);images(view.frame?.views??[]);messages('questions',view.questions,'暂无问题');messages('answers',view.answers,'等待助手回答');
  if(view.frame?.scheduleAtMs!==undefined){$('sample-time').textContent=formatSampleTime(view.frame.scheduleAtMs);$('location-name').textContent=projectAtTime(playbackTimeline,view.frame.episodeNumber,view.frame.scheduleAtMs).location;}
 $('position').value=String(index);$('progress').textContent=`${index+1} / ${recording.timeline.length} · 校园回放`;
 say(index===recording.timeline.length-1?'回放结束': '回放 · 语音内容以文字显示');
}
function advance(){
 if(!recording||index>=recording.timeline.length-1){stop();return;}
 const delay=Math.max(0,recording.timeline[index+1].atMs-recording.timeline[index].atMs);
 timer=setTimeout(()=>{index++;renderRecording();advance();},delay);
}
async function selectSource(){
 const previousMode=mode;
 const version=++selection;stop();stopTail();video.pause();recording=null;images();messages('questions',[],'暂无问题');messages('answers',[],'等待助手回答');
 const id=$('source').value;mode=id==='live'?'live':id.startsWith('video:')?'video':'recording';
 if(previousMode==='live'&&mode!=='live'&&liveRunning){try{await post('/api/simulator',{action:'pause'});liveRunning=false;}catch(error){mode='live';$('source').value='live';say('未能暂停当前输入：'+error.message);return;}if(version!==selection)return;}
  video.hidden=mode!=='video';$('views').hidden=mode==='video';
   $('next-question').hidden=mode!=='video'||!!comparisonView;
  $('question-form').hidden=mode!=='live';$('sample-time').textContent='--:--:--';$('location-name').textContent='尚未判断';
 const canAsk=mode==='live'||mode==='video'&&memoryReady;
 $('question').disabled=!canAsk;$('send').disabled=!canAsk;$('question').placeholder=mode==='recording'?'回放中显示当时的用户问题':mode==='video'&&!memoryReady?'空间记忆准备中，完成后即可独立问答':'输入你想问的问题…';$('position').disabled=mode==='live';
  if(mode==='video'){videoEpisode=videos.find(row=>row.episodeNumber===Number(id.slice(6)));video.src=videoEpisode.src;$('position').max=String(Math.round(videoEpisode.durationSeconds*10));$('position').value='0';$('progress').textContent='原生10fps · 问题与回答按样本时间展示';say('时间轴回放 · 不重新调用模型');renderVideoTime(0);return;}
 if(mode==='live'){await poll();return;}
 say('正在载入回放…');
 try{const value=await get('/api/recording?run='+encodeURIComponent(id));if(version!==selection)return;recording=value;index=0;$('position').max=String(Math.max(0,value.timeline.length-1));renderRecording();}catch(error){if(version===selection)say(error.message);}
}
async function poll(){
  if(!['live','video'].includes(mode)||polling)return;polling=true;const version=selection;
   if(mode==='video'){polling=false;return;}
 try{const [state,sim]=await Promise.all([get('/api/state'),get('/api/simulator')]);if(mode!=='live'||version!==selection)return;
  liveRunning=sim.running;images(sim.images);messages('questions',state.messages.filter(m=>m.role==='user'),'暂无问题');messages('answers',state.messages.filter(m=>m.role==='assistant'),'等待助手回答');
  $('play').textContent=sim.running?'暂停':'播放';$('progress').textContent=`${sim.index} / ${sim.total} · 校园录制输入`;
  say(sim.error?'画面输入已停止':state.processing?'助手正在处理…':!state.modelEnabled?'当前会话未启用模型；可观看已有回放':'已连接');
 }catch(error){if(version===selection)say(error.message);}finally{polling=false;}
}
$('source').addEventListener('change',()=>void selectSource());
$('method-view').addEventListener('change',()=>renderVideoTime());
$('choose-replay').addEventListener('click',()=>{$('replay-kinds').hidden=false;$('kind-title').focus();});
$('choose-realtime').addEventListener('click',()=>{window.location.href='http://127.0.0.1:8884/realtime.html';});
$('choose-real-recordings').addEventListener('click',()=>{window.location.href='http://127.0.0.1:8884/recordings.html';});
$('choose-simulation').addEventListener('click',()=>{$('sample-picker').hidden=false;$('sample-title').focus();});
$('enter-sample').addEventListener('click',async()=>{$('entry').hidden=true;$('workspace').hidden=false;await selectSource();$('scene-title').focus();});
$('back-to-samples').addEventListener('click',()=>{video.pause();stop();stopTail();$('workspace').hidden=true;$('entry').hidden=false;$('sample-title').focus();});
$('play').addEventListener('click',async()=>{
  if(mode==='video'){try{if(video.paused)await video.play();else video.pause();}catch(error){say(error.message);}return;}
 if(mode==='recording'){if(timer!==null){stop();return;}if(!recording)return;if(index>=recording.timeline.length-1){index=0;renderRecording();}$('play').textContent='暂停';advance();return;}
 try{await post('/api/simulator',liveRunning?{action:'pause'}:{action:'start',source:'campus'});await poll();}catch(error){say(error.message);}
});
$('position').addEventListener('input',()=>{if(mode==='video'){stopTail();video.currentTime=Number($('position').value)/10;return;}stop();index=Number($('position').value);renderRecording();});
$('next-question').addEventListener('click',async()=>{
 stopTail();
 const now=videoEpisode.sourceScheduleStartMs+video.currentTime*1000;
 let question=playbackTimeline.questions.find(q=>q.episodeNumber===videoEpisode.episodeNumber&&q.atMs>now+500);
 if(!question){question=playbackTimeline.questions.find(q=>q.episodeNumber>videoEpisode.episodeNumber);if(!question){say('已到最后一个问题');return;}$('source').value='video:'+question.episodeNumber;await selectSource();await new Promise(resolve=>video.addEventListener('loadedmetadata',resolve,{once:true}));}
 video.currentTime=Math.max(0,(question.atMs-videoEpisode.sourceScheduleStartMs)/1000-0.5);renderVideoTime(video.currentTime);try{await video.play();}catch(error){say(error.message);}
});
async function syncScene(force=false){if(!videoEpisode)return;await post('/api/scene',{episodeNumber:videoEpisode.episodeNumber,sourceSeconds:video.currentTime,force});}
video.addEventListener('play',()=>{$('play').textContent='暂停';});video.addEventListener('pause',()=>{$('play').textContent='播放';});
video.addEventListener('timeupdate',()=>{if(mode==='video'){$('position').value=String(Math.round(video.currentTime*10));$('progress').textContent=`${video.currentTime.toFixed(1)} / ${videoEpisode.durationSeconds.toFixed(1)}秒 · 原生10fps`;renderVideoTime();}});
video.addEventListener('seeked',()=>{if(mode==='video')renderVideoTime();});
video.addEventListener('play',()=>stopTail());
video.addEventListener('ended',()=>{
 if(mode!=='video')return;
 const end=videoEpisode.sourceScheduleStartMs+video.currentTime*1000;
 const last=playbackTimeline.questions.filter(q=>q.episodeNumber===videoEpisode.episodeNumber).at(-1);
 if(!last||last.answerAtMs===null||last.answerAtMs<=end){say('本段录制结束');return;}
 const started=performance.now();stopTail();
 tailTimer=setInterval(()=>{
  tailElapsed=Math.min(last.answerAtMs-end,performance.now()-started);renderVideoTime();
  say('本段画面已结束 · 保留最后画面等待已记录的回答');$('progress').textContent=`画面结束 · 等待返回 ${(tailElapsed/1000).toFixed(1)}秒`;
  if(end+tailElapsed>=last.answerAtMs){clearInterval(tailTimer);tailTimer=null;say('本段画面与回答回放结束');}
 },100);
});
$('question-form').addEventListener('submit',async event=>{event.preventDefault();if(!['live','video'].includes(mode))return;const text=$('question').value.trim();if(!text)return;$('send').disabled=true;try{if(mode==='video')await syncScene(true);await post('/api/messages',{text,capability:'auto'});$('question').value='';await poll();}catch(error){say(error.message);}finally{$('send').disabled=mode==='recording'||mode==='video'&&!memoryReady;}});
async function init(){
    try{const [runs,display,timed,comparison]=await Promise.all([get('/api/recordings'),get('/api/videos'),get('/api/playback-timeline'),fetch('/api/method-comparison').then(async response=>{if(response.status===404)return null;if(!response.ok)throw Error('方法对比加载失败');return response.json();})]);playbackTimeline=timed;videos=display.episodes;memoryReady=display.memoryReady;comparisonData=comparison;
    if(comparisonData){comparisonView=createComparisonView(comparisonData,$('comparison-cards'));$('method-comparison').hidden=false;for(const method of comparisonData.methods){const option=document.createElement('option');option.value=method.id;option.textContent=method.label+(method.id===comparisonData.defaultMethod?'（当前固定方法）':'');$('method-view').append(option);}$('method-view').value=comparisonData.defaultMethod??'all';for(const seconds of comparisonData.sample.checkpoints??[14,30,32,48,56,62]){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=seconds+'秒';button.addEventListener('click',()=>{stopTail();video.currentTime=seconds;renderVideoTime(seconds);});$('comparison-jumps').append(button);}document.querySelector('.dialogue').hidden=true;$('next-question').hidden=true;}
    for(const row of videos){const count=timed.questions.filter(q=>q.episodeNumber===row.episodeNumber).length;const option=document.createElement('option');option.value='video:'+row.episodeNumber;option.textContent=`校园第${row.episodeNumber}段 · ${timed.dataset==='realistic-stories-v1'&&count?`真实情境 ${count}问`:'连续画面'}`;$('source').append(option);}for(const [i,run] of runs.entries()){const option=document.createElement('option');option.value=run.id;option.textContent=i===0?'最新校园试跑':`校园试跑 ${runs.length-i}`;$('source').append(option);}if(videos.length)$('source').value='video:'+(timed.questions[0]?.episodeNumber??videos[0].episodeNumber);else if(runs.length)$('source').value=runs[0].id;
    $('sample-description').textContent=comparisonData?'第6段前64秒 · 墙边、球场与建筑外侧通道 · 三种方法同步对比':videos.length?`校园录制 · ${videos.length}段连续回放`:runs.length?'校园历史回放':'尚无可用回放';$('enter-sample').disabled=!videos.length&&!runs.length;say('请选择回放来源与样本');}catch(error){say(error.message);$('sample-description').textContent='加载失败：'+error.message;}
}
void init();setInterval(()=>void poll(),1000);
