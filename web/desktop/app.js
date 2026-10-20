const $=id=>document.getElementById(id);
let state=null,lastMessages='',initialized=false,polling=false;
const sources={user:'你',conversation:'非视觉对话',visual:'导入图片 · 非实时现场',historical:'本会话历史记录',system:'系统状态'};
const statuses={queued:'等待中',running:'处理中',completed:'已完成',cancelled:'已取消',failed:'未完成'};
function status(text){$('status').textContent=text;}
async function post(path,value){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const data=await response.json();if(!response.ok)throw Error(data.error??'请求失败');return data;}
function render(view){
 state=view;$('connection').textContent='已连接 · 仅本机';
 $('model-status').textContent=view.modelEnabled?'真实模型已授权：普通对话与视觉能力分别留存调用记录。':'真实模型未启用：控制、图片保存和界面可验证；问答不会生成模拟答案。';
 $('capture-state').textContent='观察：'+({stopped:'已停止',paused:'已暂停',recording:'允许导入，非实时摄像头',error:'故障'}[view.capture]);
 $('observation-state').textContent=view.latestObservation?`最近导入：${new Date(view.latestObservation.atMs).toLocaleTimeString()} · ${view.latestObservation.views}视图 · 拍摄时间未知`:'还没有导入图像。';
 $('processing').textContent=view.processing?`${view.processing}项工作排队／处理 · 可随时取消`:'空闲';
 $('mode').value=view.mode;$('import-button').disabled=view.capture!=='recording';
 $('session').textContent='会话：'+view.sessionId+'。服务重启新建会话，不自动恢复旧Context。';
 $('last-error').textContent=view.lastError?'最近错误：'+view.lastError:'';
 $('send').disabled=view.tasks.some(t=>t.status==='queued'||t.status==='running');
 const key=JSON.stringify(view.messages);
 if(key!==lastMessages){
  lastMessages=key;const box=$('messages');box.replaceChildren();
  if(!view.messages.length){const p=document.createElement('p');p.className='muted';p.textContent='先开始交流，或开始观察后导入图片。控制操作不需要模型。';box.append(p);}
  for(const message of view.messages){
   const item=document.createElement('article');item.className='message '+message.role;
   const label=document.createElement('small');label.textContent=`${sources[message.source]} · ${new Date(message.atMs).toLocaleTimeString()}`;
   const text=document.createElement('div');text.textContent=message.text;item.append(label,text);
   if(message.sourceIds.length){const source=document.createElement('div');source.className='source';source.textContent='引用观察：'+message.sourceIds.join('、');item.append(source);}
   box.append(item);
  }box.scrollTop=box.scrollHeight;
 }
 $('tasks').replaceChildren();
 for(const task of [...view.tasks].reverse().slice(0,6)){const item=document.createElement('div');item.className='task';item.textContent=`${statuses[task.status]}：${task.text}`;const small=document.createElement('small');small.textContent=task.capability+(task.error?' · '+task.error:'');item.append(small);$('tasks').append(item);}
 if(!view.tasks.length)$('tasks').textContent='暂无任务。';
 if(!initialized){
  for(const capability of view.capabilities){
   const li=document.createElement('li');li.textContent=capability.title+'：'+(capability.available?'已接入':capability.reason);$('capabilities').append(li);
   if(['conversation','visual.current','memory.query'].includes(capability.id)){const option=document.createElement('option');option.value=capability.id;option.textContent=capability.title;$('capability').append(option);}
  }initialized=true;
 }
}
async function poll(){if(polling)return;polling=true;try{const response=await fetch('/api/state');if(!response.ok)throw Error('服务不可用');render(await response.json());}catch(error){$('connection').textContent='连接中断 · 状态可能过期';status(error.message);}finally{polling=false;}}
document.querySelectorAll('[data-control]').forEach(button=>button.addEventListener('click',async()=>{try{render(await post('/api/control',{action:button.dataset.control}));status('控制已执行。');}catch(error){status(error.message);}}));
$('mode').addEventListener('change',async()=>{try{render(await post('/api/control',{action:'mode.set',value:$('mode').value}));}catch(error){status(error.message);}});
$('message-form').addEventListener('submit',async event=>{event.preventDefault();try{const text=$('message').value.trim();if(!text)return;const result=await post('/api/messages',{text,capability:$('capability').value});$('message').value='';render(result.state);status(result.taskId?'任务已接收。':'控制已执行。');}catch(error){status(error.message);}});
async function fileBase64(file){if(file.size>1500000)throw Error('单张图片不能超过1.5MB');return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('文件读取失败'));reader.readAsDataURL(file);});}
$('images-form').addEventListener('submit',async event=>{
 event.preventDefault();$('import-button').disabled=true;
 try{
  const views=[];for(const direction of ['front','left','right']){const file=$(direction).files[0];if(file)views.push({direction,base64:await fileBase64(file)});}
  if(!views.length)throw Error('请选择至少一张实际JPG。');
  const result=await post('/api/observations',{views});render(result.state);$('previews').replaceChildren();
  for(const image of result.images){const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=image.url;img.alt='手动导入的'+image.direction+'视图';caption.textContent=image.direction;figure.append(img,caption);$('previews').append(figure);}
  status('原图已保存，观察已排队；不代表模型已完成理解。');
 }catch(error){status(error.message);}finally{if(state)$('import-button').disabled=state.capture!=='recording';}
});
void poll();setInterval(()=>void poll(),1000);
