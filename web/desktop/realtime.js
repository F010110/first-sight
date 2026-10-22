const $=id=>document.getElementById(id);
let latestId='',busy=false,asking=false,changing=false,questionKey='',placeKey='',actionError='';
async function api(path,value){const r=await fetch(path,value===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const data=await r.json();if(!r.ok)throw Error(data.error??'请求失败');return data;}
const time=at=>new Date(at).toLocaleTimeString();
function list(id,rows){const box=$(id);box.replaceChildren();for(const row of rows){const item=document.createElement('article');item.className='message';const small=document.createElement('small');small.textContent=row.time;const text=document.createElement('div');text.textContent=row.text;item.append(small,text);box.append(item);}}
function render(data){
 const s=data.session;
 $('live-start').disabled=!data.allowPaid||changing||!!s?.paid;
 $('live-stop').disabled=changing||!s?.paid;
 $('live-ask').disabled=!s?.paid||!s?.frames||!!s?.questionBusy||asking;
 if(!s){$('live-status').textContent='正在启动网络接收服务…';return;}
 const fresh=s.inputState==='fresh-input';
 $('live-status').textContent=!s.running?'接收服务已停止':!s.frames?'等待Wi-Fi相机信号':s.paid?(s.processing?'交互已启动 · 空间建模中':'交互已启动 · 等待下一张新鲜画面'):'实时预览 · 交互未启动';
 $('live-error').textContent=actionError||s.inputError||s.modelError||(!data.allowPaid?'模型服务未启用，请用 npm run realtime 启动':'');
 if(s.latest&&s.latest.id!==latestId){latestId=s.latest.id;$('live-image').src=s.latest.url;$('live-image').hidden=false;}
 $('image-time').textContent=s.latest?`主机采样 ${time(s.latest.atMs)} · ${fresh?'实时画面':'最后收到的画面，非当前'}`:'等待Wi-Fi相机信号 · 相机需要接通电源';
 $('input-health').textContent=s.ageMs===null?'尚无图像 · 自动重连中':`图像年龄 ${(s.ageMs/1000).toFixed(1)}秒 · ${fresh?'信号正常':'信号延迟或中断，自动重连中'}`;
 $('live-location').textContent=s.currentLocation??'待确认';
 $('last-location').textContent=s.historicalLocation?`最后已提交记忆：${s.historicalLocation.name}（画面 ${time(s.historicalLocation.atMs)}，结果 ${time(s.historicalLocation.availableAtMs)}）；不是当前地点保证。`:'尚无已提交的空间判断';
 $('live-progress').textContent=`已归档 ${s.frames} 张 · ${s.paid?'方法2空间记忆持续运行':'仅预览，点击“启动交互”开启空间记忆'} · 左右视图缺失`;
 const pk=JSON.stringify(s.places);if(pk!==placeKey){placeKey=pk;list('live-places',s.places.map(p=>({time:`${p.members}条原图观察`,text:p.name+'：'+p.definition})));}
 const qk=JSON.stringify(s.questions);if(qk!==questionKey){questionKey=qk;
  list('live-questions',s.questions.map(q=>({time:time(q.atMs),text:q.question})));
  list('live-answers',s.questions.map(q=>({time:q.answeredAtMs?`提问 ${time(q.atMs)}／返回 ${time(q.answeredAtMs)} · 来源 ${q.sourceIds?.length??0}条`:'处理中',text:q.answer?(q.answer+'\n'+(q.note??'')):'用户问题Agent正在检索／查看原图…'})));
  for(const [index,q] of s.questions.entries()){if(!q.sourceIds?.length)continue;const links=document.createElement('div');links.className='evidence-links';for(const [n,id] of q.sourceIds.entries()){const a=document.createElement('a');a.href='/api/live/image?id='+encodeURIComponent(id);a.target='_blank';a.rel='noopener';a.textContent=`查看证据原图 ${n+1}`;links.append(a);}$('live-answers').children[index]?.append(links);}
 }
}
async function poll(){if(busy)return;busy=true;try{render(await api('/api/live/state'));}catch(error){$('live-status').textContent='本地实时服务未连接';$('live-error').textContent=error.message;$('live-location').textContent='待确认';$('image-time').textContent='连接已断开 · 最后收到的历史画面';$('input-health').textContent='等待接收服务恢复';$('live-ask').disabled=true;}finally{busy=false;}}
async function interaction(start){if(changing)return;changing=true;actionError='';$('live-start').disabled=true;$('live-stop').disabled=true;try{await api(start?'/api/live/start':'/api/live/stop',{});}catch(e){actionError=e.message;}finally{changing=false;await poll();}}
$('live-start').addEventListener('click',()=>void interaction(true));
$('live-stop').addEventListener('click',()=>void interaction(false));
$('live-question-form').addEventListener('submit',async e=>{e.preventDefault();const text=$('live-question').value.trim();if(!text||asking)return;asking=true;actionError='';$('live-ask').disabled=true;try{$('live-question').value='';await api('/api/live/question',{text});}catch(error){actionError=error.message;if(!$('live-question').value)$('live-question').value=text;}finally{asking=false;await poll();}});
setInterval(()=>void poll(),500);void poll();
