const $=id=>document.getElementById(id);
let catalog=null,detail=null,clip=-1,token=0,mediaToken=0;
const clock=ms=>{const day=Math.floor(ms/86400000)+1,t=Math.floor(ms/1000)%86400;return `DAY${day} ${String(Math.floor(t/3600)).padStart(2,'0')}:${String(Math.floor(t/60)%60).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;};
async function get(url){const response=await fetch(url);if(!response.ok)throw Error(`读取失败 HTTP${response.status}`);return response.json();}
function option(select,value,text){const el=document.createElement('option');el.value=value;el.textContent=text;select.append(el);}
function seekSource(sourceMs,resume=false){
 if(!catalog)return;
 const offset=Math.max(0,Math.min(catalog.durationMs-1,sourceMs-catalog.sourceFirstMs)),next=Math.max(0,catalog.clips.findLastIndex(c=>c.startMs<=offset)),video=$('video'),local=(offset-catalog.clips[next].startMs)/1000;
 if(next!==clip){clip=next;const currentToken=++mediaToken;video.src=catalog.clips[next].url;video.onloadedmetadata=()=>{if(currentToken!==mediaToken)return;video.currentTime=Math.min(local,Math.max(0,video.duration-.01));video.playbackRate=Number($('speed').value);if(resume)void video.play().catch(()=>{});};video.load();}
 else{video.currentTime=local;if(resume)void video.play().catch(()=>{});}
}
function gallery(box,frames){
 box.replaceChildren();if(!frames.length){box.textContent='没有引用／交付图片';return;}
 for(const frame of frames){const figure=document.createElement('figure'),link=document.createElement('a'),img=document.createElement('img'),caption=document.createElement('figcaption'),button=document.createElement('button');link.href=frame.url;link.target='_blank';link.rel='noopener';img.src=frame.url;img.loading='lazy';img.alt=frame.id+' '+clock(frame.atMs);caption.textContent=frame.id+' · '+clock(frame.atMs);button.textContent='在原片中查看';button.onclick=()=>seekSource(frame.atMs);link.append(img);figure.append(link,caption,button);box.append(figure);}
}
function renderStep(){const step=detail?.steps[Number($('step').value)];if(!step){$('action').textContent='没有保存调用步骤';$('feedback').textContent='';$('step-images').replaceChildren();return;}$('action').textContent=JSON.stringify(step.action,null,2);$('feedback').textContent=JSON.stringify({feedback:step.feedback,toolResult:step.toolResult,operation:step.operation},null,2);gallery($('step-images'),step.images);}
async function loadTask(){
 const mine=++token;$('gold-panel').open=false;$('gold').replaceChildren();detail=null;$('step').replaceChildren();$('step-images').replaceChildren();$('citations').replaceChildren();$('result').textContent='正在读取该题结果…';
 try{
  const value=await get(`/api/evaluation/egolife/task?id=${encodeURIComponent($('task').value)}&run=${encodeURIComponent($('run').value)}`);if(mine!==token)return;detail=value;
  $('question').textContent=`Q${value.task.ID} · ${value.task.question}`;$('question-clock').textContent='发问：'+clock(value.task.cutoffMs);$('choices').replaceChildren();for(const [key,text] of Object.entries(value.task.choices)){const item=document.createElement('li');item.textContent=`${key}. ${text}`;$('choices').append(item);}
  $('result').textContent=`模型：${value.result.response} · ${value.result.status} · ${value.result.text}`;gallery($('citations'),value.citedFrames);
  value.steps.forEach((step,index)=>option($('step'),String(index),`${index+1}. ${step.operation==='verify-history-evidence'?'独立证据审查':step.action.kind??'模型输出'} · ${step.images.length}张图`));renderStep();
  const run=catalog.runs.find(r=>r.id===$('run').value);$('score').textContent=run?`${run.summary.correct}/${run.summary.total} · ${((run.summary.accuracy??0)*100).toFixed(0)}% · 估计$${Number(run.usage?.estimatedUSD??0).toFixed(4)}`:'';
  seekSource(value.task.cutoffMs);history.replaceState(null,'',`/egolife.html?task=${encodeURIComponent(value.task.ID)}&run=${encodeURIComponent($('run').value)}`);
 }catch(error){if(mine===token)$('result').textContent=error.message;}
}
async function refresh(){
 const previousTask=$('task').value||new URLSearchParams(location.search).get('task')||'1',previousRun=$('run').value||new URLSearchParams(location.search).get('run')||'v2';
 try{catalog=await get('/api/evaluation/egolife');$('task').replaceChildren();$('run').replaceChildren();for(const task of catalog.tasks)option($('task'),task.ID,`Q${task.ID} · ${task.question}`);for(const run of catalog.runs)option($('run'),run.id,`${run.title} · ${run.summary.correct}/${run.summary.total}`);if(!catalog.runs.length)throw Error('没有已完成的评测结果');
  if(catalog.tasks.some(t=>t.ID===previousTask))$('task').value=previousTask;if(catalog.runs.some(r=>r.id===previousRun))$('run').value=previousRun;
  $('status').textContent=`${catalog.clips.length}段真实原片 · ${catalog.frames}帧评测输入 · ${catalog.tasks.length}道官方题 · 浏览不计费`;$('scope').textContent=catalog.scope;$('seek').max=String(catalog.durationMs);await loadTask();
 }catch(error){$('status').textContent='无法加载：'+error.message;}
}
$('gold-panel').ontoggle=async()=>{
 if(!$('gold-panel').open||!detail)return;const id=detail.task.ID,mine=token;$('gold').textContent='正在读取官方诊断标注…';
 try{const gold=await get('/api/evaluation/egolife/gold?id='+encodeURIComponent(id));if(mine!==token)return;const text=document.createElement('p');text.textContent=`标准答案：${gold.answer} · ${detail.result.response===gold.answer?'选项匹配':'不匹配'}\n${gold.questionChinese??''}\n理由：${gold.reason}\n需要音频：${gold.needAudio?'是':'否'}；需要名字：${gold.needName?'是':'否'}。${gold.note}`;$('gold').replaceChildren(text);if(gold.targetMs!==null){const button=document.createElement('button');button.textContent='跳到官方标注时刻 '+clock(gold.targetMs);button.onclick=()=>seekSource(gold.targetMs);$('gold').append(button);}if(gold.nearestFrame){const box=document.createElement('div');box.className='images';gallery(box,[gold.nearestFrame]);$('gold').append(box);}}
 catch(error){if(mine===token)$('gold').textContent=error.message;}
};
$('video').ontimeupdate=()=>{if(clip<0||!catalog)return;const at=catalog.clips[clip].startMs+$('video').currentTime*1000;$('seek').value=String(at);$('time').textContent=`${clock(catalog.sourceFirstMs+at)} · 第${clip+1}/${catalog.clips.length}段`;};
$('video').onended=()=>{if(catalog&&clip<catalog.clips.length-1)seekSource(catalog.sourceFirstMs+catalog.clips[clip+1].startMs,true);};
$('video').onerror=()=>{$('time').textContent='原片加载失败；采样原图仍可检查，不会补造视频。';};
$('seek').oninput=()=>seekSource(catalog.sourceFirstMs+Number($('seek').value));$('speed').onchange=()=>{$('video').playbackRate=Number($('speed').value);};
$('task').onchange=loadTask;$('run').onchange=loadTask;$('step').onchange=renderStep;$('refresh').onclick=refresh;
$('question-time').onclick=()=>{if(detail)seekSource(detail.task.cutoffMs);};$('before-time').onclick=()=>{if(detail)seekSource(detail.task.cutoffMs-30000);};
void refresh();
