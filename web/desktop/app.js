import {projectRecording} from './view-model.js';
const $=id=>document.getElementById(id);
let mode='recording',recording=null,index=0,timer=null,liveRunning=false,polling=false,selection=0;
let imageKey='',questionKey='',answerKey='';
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
 for(const row of rows){const item=document.createElement('article');item.className='message';const time=document.createElement('small');time.textContent=new Date(row.atMs).toLocaleTimeString();const text=document.createElement('div');text.textContent=row.text;item.append(time,text);box.append(item);}box.scrollTop=box.scrollHeight;
}
function stop(){if(timer!==null)clearTimeout(timer);timer=null;$('play').textContent='播放';}
function renderRecording(){
 if(!recording)return;
 const view=projectRecording(recording.timeline,index);images(view.frame?.views??[]);messages('questions',view.questions,'暂无问题');messages('answers',view.answers,'等待助手回答');
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
 const version=++selection;stop();recording=null;images();messages('questions',[],'暂无问题');messages('answers',[],'等待助手回答');
 const id=$('source').value;mode=id==='live'?'live':'recording';
 if(previousMode==='live'&&mode==='recording'&&liveRunning){try{await post('/api/simulator',{action:'pause'});liveRunning=false;}catch(error){mode='live';$('source').value='live';say('未能暂停当前输入：'+error.message);return;}if(version!==selection)return;}
 $('question').disabled=mode!=='live';$('send').disabled=mode!=='live';$('question').placeholder=mode==='live'?'输入你想问的问题…':'回放中显示当时的用户问题';$('position').disabled=mode==='live';
 if(mode==='live'){await poll();return;}
 say('正在载入回放…');
 try{const value=await get('/api/recording?run='+encodeURIComponent(id));if(version!==selection)return;recording=value;index=0;$('position').max=String(Math.max(0,value.timeline.length-1));renderRecording();}catch(error){if(version===selection)say(error.message);}
}
async function poll(){
 if(mode!=='live'||polling)return;polling=true;const version=selection;
 try{const [state,sim]=await Promise.all([get('/api/state'),get('/api/simulator')]);if(mode!=='live'||version!==selection)return;
  liveRunning=sim.running;images(sim.images);messages('questions',state.messages.filter(m=>m.role==='user'),'暂无问题');messages('answers',state.messages.filter(m=>m.role==='assistant'),'等待助手回答');
  $('play').textContent=sim.running?'暂停':'播放';$('progress').textContent=`${sim.index} / ${sim.total} · 校园录制输入`;
  say(sim.error?'画面输入已停止':state.processing?'助手正在处理…':!state.modelEnabled?'当前会话未启用模型；可观看已有回放':'已连接');
 }catch(error){if(version===selection)say(error.message);}finally{polling=false;}
}
$('source').addEventListener('change',()=>void selectSource());
$('play').addEventListener('click',async()=>{
 if(mode==='recording'){if(timer!==null){stop();return;}if(!recording)return;if(index>=recording.timeline.length-1){index=0;renderRecording();}$('play').textContent='暂停';advance();return;}
 try{await post('/api/simulator',liveRunning?{action:'pause'}:{action:'start',source:'campus'});await poll();}catch(error){say(error.message);}
});
$('position').addEventListener('input',()=>{stop();index=Number($('position').value);renderRecording();});
$('question-form').addEventListener('submit',async event=>{event.preventDefault();if(mode!=='live')return;const text=$('question').value.trim();if(!text)return;$('send').disabled=true;try{await post('/api/messages',{text,capability:'auto'});$('question').value='';await poll();}catch(error){say(error.message);}finally{$('send').disabled=mode!=='live';}});
async function init(){
 try{const runs=await get('/api/recordings');for(const [i,run] of runs.entries()){const option=document.createElement('option');option.value=run.id;option.textContent=i===0?'最新校园试跑':`校园试跑 ${runs.length-i}`;$('source').append(option);}if(runs.length)$('source').value=runs[0].id;else $('source').value='live';await selectSource();}catch(error){say(error.message);}
}
void init();setInterval(()=>void poll(),1000);
