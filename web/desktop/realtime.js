const $=id=>document.getElementById(id);let latestId='',busy=false,asking=false;
async function api(path,value){const r=await fetch(path,value===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const data=await r.json();if(!r.ok)throw Error(data.error??'请求失败');return data;}
const time=at=>new Date(at).toLocaleTimeString();
function list(id,rows){const box=$(id);box.replaceChildren();for(const row of rows){const item=document.createElement('article');item.className='message';const small=document.createElement('small');small.textContent=row.time;const text=document.createElement('div');text.textContent=row.text;item.append(small,text);box.append(item);}}
async function poll(){if(busy)return;busy=true;try{
 const data=await api('/api/live/state'),s=data.session;$('enable-model').disabled=!data.allowPaid||!!s?.running;$('confirm-budget').disabled=!data.allowPaid||!!s?.running;
 $('live-start').disabled=!!s?.running||!!s?.settling;$('live-stop').disabled=!s?.running;
 $('live-ask').disabled=!s?.paid||!!s.questionBusy||asking;
 if(!s){$('live-status').textContent=data.allowPaid?'已连接 · 尚未采集':'仅相机模式；服务未开启付费模型权限';return;}
 $('live-status').textContent=!s.running?'会话已停止／结束':s.processing?'空间建模中 · 画面继续采集':s.inputState==='fresh-input'?'新鲜画面已接入':'当前状态待确认';
 $('live-error').textContent=s.inputError??s.modelError??'';
 if(s.latest&&s.latest.id!==latestId){latestId=s.latest.id;$('live-image').src=s.latest.url;$('live-image').hidden=false;}
 $('image-time').textContent=s.latest?`主机采样 ${time(s.latest.atMs)} · ${s.inputState==='fresh-input'?'新鲜画面':'历史画面，不代表当前'}`:'等待原图';
 $('input-health').textContent=s.ageMs===null?'暂无输入':`图像年龄 ${(s.ageMs/1000).toFixed(1)}秒 · 左右视图缺失`;
 $('live-location').textContent=s.currentLocation??'待确认';
 $('last-location').textContent=s.historicalLocation?`最后已提交记忆：${s.historicalLocation.name}（画面 ${time(s.historicalLocation.atMs)}，结果 ${time(s.historicalLocation.availableAtMs)}）；不是当前地点保证。`:'尚无已提交的空间判断';
 $('live-progress').textContent=`已归档 ${s.frames}/${s.captureLimit} 张 · ${s.paid?'方法2：最近2＋视觉2＋访问序列，无图关系':'仅采图，模型未启用'}`;
 list('live-places',s.places.map(p=>({time:`${p.members}条原图观察`,text:p.name+'：'+p.definition})));
 list('live-questions',s.questions.map(q=>({time:time(q.atMs),text:q.question})));
 list('live-answers',s.questions.map(q=>({time:q.answeredAtMs?`提问 ${time(q.atMs)}／返回 ${time(q.answeredAtMs)} · 来源 ${q.sourceIds?.length??0}条`:'处理中',text:q.answer?(q.answer+'\n'+(q.note??'')):'用户问题Agent正在检索／查看原图…'})));
 for(const [index,q] of s.questions.entries()){if(!q.sourceIds?.length)continue;const links=document.createElement('div');links.className='evidence-links';for(const [n,id] of q.sourceIds.entries()){const a=document.createElement('a');a.href='/api/live/image?id='+encodeURIComponent(id);a.target='_blank';a.rel='noopener';a.textContent=`查看证据原图 ${n+1}`;links.append(a);}$('live-answers').children[index]?.append(links);}
 }catch(error){$('live-status').textContent='本地实时服务未连接';$('live-error').textContent=error.message;$('live-location').textContent='待确认';$('image-time').textContent='连接已断开 · 最后收到的历史画面';$('input-health').textContent='当前输入待确认';$('live-ask').disabled=true;}finally{busy=false;}}
$('live-start').addEventListener('click',async()=>{try{const enabled=$('enable-model').checked;if(enabled&&!$('confirm-budget').checked)throw Error('请明确确认本次模型预算');$('live-start').disabled=true;await api('/api/live/start',{modelEnabled:enabled,confirmPaid:enabled&&$('confirm-budget').checked,budgetUSD:enabled?.75:0});latestId='';await poll();}catch(e){$('live-error').textContent=e.message;$('live-start').disabled=false;}});
$('live-stop').addEventListener('click',async()=>{try{await api('/api/live/stop',{});await poll();}catch(e){$('live-error').textContent=e.message;}});
$('live-question-form').addEventListener('submit',async e=>{e.preventDefault();const text=$('live-question').value.trim();if(!text||asking)return;asking=true;$('live-ask').disabled=true;try{$('live-question').value='';await api('/api/live/question',{text});}catch(error){$('live-error').textContent=error.message;}finally{asking=false;await poll();}});
setInterval(()=>void poll(),500);void poll();
