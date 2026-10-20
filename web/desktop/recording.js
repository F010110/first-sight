const $=id=>document.getElementById(id);
let recording=null,index=0,timer=null;
function stop(){if(timer!==null)clearTimeout(timer);timer=null;}
function render(){
 if(!recording)return;
 const events=recording.timeline.slice(0,index+1),frame=[...events].reverse().find(e=>e.kind==='campus-frame');
 $('record-position').value=String(index);$('record-status').textContent=`事件${index+1}/${recording.timeline.length} · ${recording.timeline[index]?.kind??''} · 脚本${recording.report.completedScript?'完成':'中断'}，非独立语义评分`;
 $('record-images').replaceChildren();
 if(frame)for(const view of frame.value.views){const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=view.url;img.alt='校园原图 '+view.direction;caption.textContent=`第${frame.value.episodeNumber}段 ${frame.value.sourceAtMs/1000}秒 · ${view.direction}`;figure.append(img,caption);$('record-images').append(figure);}
 $('record-text').replaceChildren();
 for(const event of events.filter(e=>['task-created','message-delivered','vlm-language','watch-notified','watch-failed','control'].includes(e.kind)).slice(-16)){
  const item=document.createElement('article');item.className='message';const label=document.createElement('small');label.textContent=`${new Date(event.atMs).toLocaleTimeString()} · ${event.kind}`;
  const text=document.createElement('div');text.textContent=event.kind==='task-created'?'用户：'+event.value.text:event.kind==='message-delivered'?'助手交付：'+event.value.text:event.kind==='vlm-language'?'原始VLM输出（未核验）：'+JSON.stringify(event.value.output):JSON.stringify(event.value);item.append(label,text);$('record-text').append(item);
 }
}
async function refresh(){try{const rows=await (await fetch('/api/recordings')).json();$('recorded-run').replaceChildren();for(const row of rows){const option=document.createElement('option');option.value=row.id;option.textContent=row.id+' · '+(row.completedScript?'脚本完成':'中断');$('recorded-run').append(option);}if(!rows.length)$('record-status').textContent='暂无已完成试跑。运行中的包在生成report后出现。';}catch(error){$('record-status').textContent=error.message;}}
$('record-refresh').addEventListener('click',()=>void refresh());
$('record-load').addEventListener('click',async()=>{stop();try{const response=await fetch('/api/recording?run='+encodeURIComponent($('recorded-run').value));const value=await response.json();if(!response.ok)throw Error(value.error);recording=value;index=0;$('record-position').max=String(Math.max(0,value.timeline.length-1));render();}catch(error){$('record-status').textContent=error.message;}});
$('record-position').addEventListener('input',()=>{stop();index=Number($('record-position').value);render();});
$('record-step').addEventListener('click',()=>{stop();if(recording){index=Math.min(index+1,recording.timeline.length-1);render();}});
function advance(){if(!recording||index>=recording.timeline.length-1){stop();return;}const delay=Math.max(0,recording.timeline[index+1].atMs-recording.timeline[index].atMs);timer=setTimeout(()=>{index++;render();advance();},delay);}
$('record-play').addEventListener('click',()=>{if(timer!==null)stop();else advance();});
void refresh();
