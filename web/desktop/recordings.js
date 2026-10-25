const $=id=>document.getElementById(id);
let recording=null,index=0,timer=null,loading=0,refreshing=0;
let videoClip=0;
const initialRecording=new URLSearchParams(location.search).get('recording')??'';
const isVideo=()=>recording?.kind==='original-video';
const source=()=> $('replay-source').value;
const elapsed=ms=>ms<60000?`${(ms/1000).toFixed(1)}秒`:`${Math.floor(ms/3600000)}小时${Math.floor(ms/60000)%60}分${Math.floor(ms/1000)%60}秒`;
const stamp=ms=>recording?.clock==='synthetic'?`样本 ${elapsed(ms)}`:new Date(ms).toLocaleString();
const wallStamp=ms=>new Date(ms).toLocaleString();
async function get(url){const r=await fetch(url);const data=await r.json();if(!r.ok)throw Error(data.error??'读取失败');return data;}
function playing(value){$('play').textContent=value?'❚❚':'▶';$('play').setAttribute('aria-label',value?'暂停':'播放');$('play').title=value?'暂停（空格）':'播放（空格）';}
function stop(){clearTimeout(timer);timer=null;playing(false);}
const timecode=ms=>{const s=Math.floor(ms/1000);return s>=3600?`${Math.floor(s/3600)}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
function skipTarget(){
 const frames=recording?.frames??[];if(source()!=='simulation'||index>=frames.length-1||frames[index+1].atMs-frames[index].atMs<30000)return null;
 let target=index+1;
 while(target<frames.length-1&&frames[target+1].atMs-frames[target].atMs>=30000)target++;
 return target;
}
function clear(message='正在读取…'){
 $('real-video').pause();$('real-video').removeAttribute('src');$('real-video').load();$('real-video').hidden=true;$('play').hidden=false;$('fullscreen').hidden=false;
 stop();recording=null;index=0;$('frame').hidden=true;$('frame').removeAttribute('src');$('multi-view').hidden=true;$('multi-view').replaceChildren();$('empty').hidden=false;$('empty').textContent=message;
 $('play').disabled=true;$('seek').disabled=true;$('seek').value='0';$('places').replaceChildren();$('questions').replaceChildren();
  for(const id of ['frame-time','gap','sample-scope','skip-notice'])$(id).textContent='';$('location').textContent='尚无记录';$('skip-pause').disabled=true;$('player-time').textContent='0:00 / 0:00';
}
function openVideoClip(n,offset=0,resume=false){
 if(!isVideo()||!recording.clips[n])return;videoClip=n;
 const video=$('real-video');video.src=recording.clips[n].url;video.currentTime=offset/1000;video.playbackRate=Number($('speed').value);
 if(resume)void video.play().catch(()=>{$('status').textContent='点击视频播放继续';});
}
function renderVideoTime(){
 if(!isVideo())return;
 const at=recording.clips[videoClip].startMs+$('real-video').currentTime*1000;
 $('seek').value=String(Math.round(at));$('player-time').textContent=`${timecode(at)} / ${timecode(recording.durationMs)}`;
  $('frame-time').textContent=`${source()==='simulation'?'模拟视频':'原片'}累计 ${elapsed(at)} · 第${videoClip+1}/${recording.clips.length}段`;
}
$('real-video').ontimeupdate=renderVideoTime;
$('real-video').onended=()=>{if(isVideo()&&videoClip<recording.clips.length-1)openVideoClip(videoClip+1,0,true);};
$('real-video').onerror=()=>{if(isVideo())$('status').textContent='原片加载失败，请刷新重试；不补造缺失片段';};
function entry(box,label,text){const el=document.createElement('div');el.className='entry';const small=document.createElement('small');small.textContent=label;const body=document.createElement('div');body.textContent=text;el.append(small,body);box.append(el);}
function render(){
 const frames=recording?.frames??[],frame=frames[Math.min(index,frames.length-1)];if(!frame)return;
 const questions=recording.questions??[],asOf=index===frames.length?Math.max(frame.atMs,...frames.map(f=>f.availableAtMs??0),...questions.map(q=>q.answeredAtMs??q.atMs)):frame.atMs;
 const views=frame.views??[{view:'front',url:frame.url}],all=source()==='simulation'&&$('view-mode').value==='all';
 $('multi-view').hidden=!all;$('frame').hidden=all;$('empty').hidden=true;
  if(all){for(const box of [...$('multi-view').children])if(!views.some(v=>v.view===box.dataset.view))box.remove();for(const view of views){let box=[...$('multi-view').children].find(el=>el.dataset.view===view.view);if(!box){box=document.createElement('figure');box.dataset.view=view.view;const img=document.createElement('img'),label=document.createElement('figcaption'),link=document.createElement('a');img.alt=({front:'前方',left:'左侧',right:'右侧'})[view.view]+'独立原图';link.target='_blank';link.rel='noopener';link.append(img);label.textContent=({front:'前方',left:'左侧',right:'右侧'})[view.view];box.append(link,label);$('multi-view').append(box);}box.querySelector('a').href=view.url;box.querySelector('img').src=view.url;}}
 else{const selected=views.find(v=>v.view===(source()==='simulation'?$('view-mode').value:'front'))??views.find(v=>v.view==='front');$('frame').src=selected.url;}
  $('seek').value=String(index);$('frame-time').textContent=`${stamp(frame.atMs)} · ${Math.min(index+1,frames.length)}/${frames.length} 帧`;
  $('player-time').textContent=`${timecode(frame.atMs-frames[0].atMs)} / ${timecode(frames.at(-1).atMs-frames[0].atMs)}`;
  $('skip-pause').disabled=skipTarget()===null;
 if(index===frames.length)$('frame-time').textContent=`记录结束 · 结果截至 ${stamp(asOf)}（保留最后画面，非此时新拍摄）`;
 const available=frames.filter(f=>f.judgment&&f.availableAtMs!==null&&f.availableAtMs<=asOf).sort((a,b)=>a.availableAtMs-b.availableAtMs),last=available.at(-1),j=last?.judgment,place=j?.groups?.find(g=>g.id===j.placeId);
 $('location').textContent=last?`最近已产生的判断：${place?.scope.name??'地点待定'} · 判断时间 ${stamp(last.availableAtMs)}（原画面 ${stamp(last.atMs)}）`:source()==='simulation'?'此样本尚无模型判断；当前只核查独立渲染画面，不展示位姿真值。':'此时尚无空间判断（纯记录不运行模型）';
 const gap=index&&index<frames.length?frame.atMs-frames[index-1].atMs:0;$('gap').textContent=frame.gapBefore||gap>2500?`采样或记录间隔：${gap?`${(gap/1000).toFixed(1)}秒`:'开始记录'}；不代表连续观察。`:'';
 $('places').replaceChildren();for(const g of j?.groups??[])entry($('places'),`${g.members.length}条观察`,g.scope.name+'：'+g.scope.definition);
 $('questions').replaceChildren();for(const q of questions.filter(q=>q.atMs<=asOf)){entry($('questions'),stamp(q.atMs)+' · 用户',q.question);if(q.answeredAtMs<=asOf){entry($('questions'),stamp(q.answeredAtMs)+' · 助手',q.answer??'回答失败');for(const [n,id] of (q.sourceIds??[]).entries()){const original=frames.find(f=>f.id===id);if(original){const a=document.createElement('a');a.href=original.url;a.target='_blank';a.rel='noopener';a.textContent=`原图 ${n+1} `;$('questions').append(a);}}}else entry($('questions'),'助手','此时回答尚未产生');}
}
function next(){if(!recording||index>=recording.frames.length){stop();return;}const gap=index===recording.frames.length-1?1000:recording.frames[index+1].atMs-recording.frames[index].atMs;timer=setTimeout(()=>{index++;render();next();},Math.max(20,gap/Number($('speed').value)));}
async function load(id){
  const token=++loading,kind=source();clear();if(!id)return;
   try{const originalVideo=kind==='real'&&id.startsWith('video:');let value;
    if(kind==='simulation'&&id.startsWith('campus-video:')){const data=await get('/api/videos'),episode=data.episodes.find(e=>String(e.episodeNumber)===id.slice(13));if(!episode)throw Error('历史模拟视频不可用');const durationMs=Math.round(episode.durationSeconds*1000);value={kind:'original-video',durationMs,scope:'TartanGround AbandonedSchool · 历史模拟显示视频，仅此片段实际时长；非完整校园生活、非真实录像；无模型调用。',clips:[{url:episode.src,startMs:0,durationMs}]};}
    else value=await get((kind==='simulation'?'/api/replay/simulation':originalVideo?'/api/replay/real-video':'/api/live/recording')+'?id='+encodeURIComponent(originalVideo?id.slice(6):id));if(token!==loading||source()!==kind)return;
   if(value.kind==='original-video'){
    recording=value;$('real-video').hidden=false;$('empty').hidden=true;$('play').hidden=true;$('fullscreen').hidden=true;
    $('seek').max=String(value.durationMs);$('seek').disabled=false;$('sample-scope').textContent=value.scope;
     $('status').textContent=`${elapsed(value.durationMs)} · ${kind==='simulation'?'历史模拟视频':'单摄真实原片'} · 无模型调用`;
     $('skip-pause').hidden=true;
     $('location').textContent='仅播放已保存画面；没有模型判断或问答结果，不展示位姿、答案及未来证据。';
    openVideoClip(0);renderVideoTime();return;
   }
   recording=value;$('skip-pause').hidden=kind!=='simulation';$('seek').max=String(value.frames.length);$('seek').disabled=!value.frames.length;$('play').disabled=!value.frames.length;
  $('status').textContent=`${value.frames.length}张观察 · ${value.questions.length}个问题 · 只读`;$('sample-scope').textContent=kind==='simulation'?value.scope:'真实相机记录 · 以记录开关分段，断联不另拆段';
  if(value.frames.length)render();else clear('本记录没有画面');
 }catch(e){if(token!==loading||source()!==kind)return;clear('读取失败');$('status').textContent=e.message;}
}
async function refresh(){
 const token=++refreshing,kind=source(),current=$('recording-select').value||initialRecording;++loading;clear();$('recording-select').replaceChildren();$('status').textContent='读取列表中…';
   try{const [data,videos,campus]=await Promise.all([get(kind==='simulation'?'/api/replay/simulations':'/api/live/recordings'),kind==='real'?get('/api/replay/real-videos'):Promise.resolve({recordings:[]}),kind==='simulation'?get('/api/videos'):Promise.resolve({episodes:[]})]);if(token!==refreshing||source()!==kind)return;
    for(const e of campus.episodes){const option=document.createElement('option');option.value='campus-video:'+e.episodeNumber;option.textContent=`TartanGround 废弃学校 · 轨迹${e.episodeNumber} · ${elapsed(Math.round(e.durationSeconds*1000))} · 历史显示片段`;$('recording-select').append(option);}
   for(const v of videos.recordings){const option=document.createElement('option');option.value='video:'+v.id;option.textContent=`${v.title} · ${elapsed(v.durationMs)} · 单摄原片`;$('recording-select').append(option);}
  for(const r of data.recordings){const option=document.createElement('option');option.value=r.id;option.textContent=kind==='simulation'?`${r.title} · ${r.frames}帧 · 跨度${elapsed(r.durationMs)}`:`开启 ${wallStamp(r.startedAtMs??r.startMs)} · ${r.stoppedAtMs?'关闭 '+wallStamp(r.stoppedAtMs):'未记录关闭'} · ${r.frames}张`;$('recording-select').append(option);}
    if(!data.recordings.length&&!videos.recordings.length&&!campus.episodes.length){clear(kind==='simulation'?'暂无完成的模拟样本；生成失败或尚未完成的包不会冒充可用样本':'暂无已记录画面或完成下载的真实原片');$('status').textContent='暂无可用记录';return;}
   if([...$('recording-select').options].some(r=>r.value===current))$('recording-select').value=current;await load($('recording-select').value);
 }catch(e){if(token!==refreshing||source()!==kind)return;clear('列表读取失败');$('status').textContent=e.message;}
}
function changeSource(){const simulation=source()==='simulation';$('view-mode').hidden=!simulation;$('skip-pause').hidden=!simulation;history.replaceState(null,'','/recordings.html?source='+source());void refresh();}
$('replay-source').value=new URLSearchParams(location.search).get('source')==='simulation'?'simulation':'real';
$('replay-source').onchange=changeSource;$('refresh').onclick=()=>void refresh();$('recording-select').onchange=()=>void load($('recording-select').value);
$('seek').oninput=()=>{if(isVideo()){const at=Number($('seek').value),n=Math.max(0,recording.clips.findLastIndex(c=>c.startMs<=at)),resume=!$('real-video').paused;if(n!==videoClip)openVideoClip(n,Math.min(at-recording.clips[n].startMs,recording.clips[n].durationMs-1),resume);else $('real-video').currentTime=(at-recording.clips[n].startMs)/1000;renderVideoTime();return;}stop();$('skip-notice').textContent='';index=Number($('seek').value);render();};$('play').onclick=()=>{if(isVideo()){if($('real-video').paused)void $('real-video').play().catch(()=>{});else $('real-video').pause();return;}if(!recording||!recording.frames.length)return;if(timer){stop();return;}if(index>=recording.frames.length-1)index=0;render();playing(true);next();};$('speed').onchange=()=>{if(isVideo()){$('real-video').playbackRate=Number($('speed').value);return;}if(timer){stop();playing(true);next();}};$('view-mode').onchange=render;
$('skip-pause').onclick=()=>{const target=skipTarget();if(target===null)return;const resume=timer!==null,from=recording.frames[index].atMs;stop();index=target;render();$('skip-notice').textContent=`已跳过 ${elapsed(recording.frames[index].atMs-from)} 的稀疏采样段（非连续录像；未判断人物活动）。`;if(resume){playing(true);next();}};
document.querySelector('.player').addEventListener('keydown',event=>{if(event.code==='Space'&&['DIV','IMG'].includes(event.target.tagName)){event.preventDefault();$('play').click();}});
$('fullscreen').onclick=()=>{if(document.fullscreenElement)void document.exitFullscreen();else void document.querySelector('.player').requestFullscreen().catch(()=>{});};changeSource();
