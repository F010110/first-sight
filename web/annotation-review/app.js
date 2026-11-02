'use strict';
const $=id=>document.getElementById(id);
const names={approved:'已确认','needs-change':'需修改',uncertain:'无法确认','pending-user-review':'待审核','annotation-complete':'标注已完成'};
let state,index=0,playing=false,playOrigin=0,sourceOrigin=0,dirty=false,saving=false,viewEpoch=0;
const unsavedRevisits=new Set();
const time=ms=>`${Math.floor(ms/60000)}:${(ms/1000%60).toFixed(2).padStart(5,'0')}`;
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const latest=(type,id)=>[...state.reviews].reverse().find(r=>r.targetType===type&&r.targetId===id);
const segmentFor=frame=>state.sample.segments.find(s=>s.id===frame.annotation.segmentId);
const effective=frame=>latest('observation',frame.id)??latest('segment',frame.annotation.segmentId);
function stop(){playing=false;$('play').textContent='▶ 播放';}
function canLeave(){if(!dirty)return true;stop();if(!confirm('当前审核内容尚未保存，确定放弃这些未保存编辑吗？'))return false;dirty=false;return true;}
function go(next){if(saving){$('seek').value=index;return;}if(!canLeave())return;index=Math.max(0,Math.min(state.sample.frames.length-1,next));render();}
async function loadViews(frame){
 const epoch=++viewEpoch,container=document.querySelector('.views');container.style.opacity='.2';
 try{
  const loaded=await Promise.all(['left','front','right'].map(direction=>new Promise((resolve,reject)=>{const image=new Image();image.alt=`${direction} ${frame.id}`;image.id=direction;image.onload=()=>resolve({direction,image});image.onerror=()=>reject(Error('原图无法加载或校验未通过'));image.src=frame.views[direction];})));
  if(epoch!==viewEpoch)return;
  for(const {direction,image} of loaded){$(direction).replaceWith(image);$('open-'+direction).href=frame.views[direction];}
  container.style.opacity='1';
 }catch(error){if(epoch===viewEpoch){$('save-state').textContent=error.message;stop();}}
}
function drawSegments(){
 const root=$('segments');root.replaceChildren();
 for(const s of state.sample.segments){
  const review=latest('segment',s.id);const button=el('button',`${time(s.startMs)}–${time(s.endMs)}  ${review?.correctedLabel||s.title}\n${names[review?.status??s.status]}`,'segment');
  if(index>=s.startIndex&&index<=s.endIndex)button.classList.add('current');if(review)button.classList.add(review.status);
  button.onclick=()=>{stop();go(s.startIndex);};root.append(button);
 }
}
function drawMap(){
 const frame=state.sample.frames[index],layerId=$('layer').value==='auto'?frame.layerId:$('layer').value;
 const layer=state.sample.map.layers.find(l=>l.id===layerId),svg=$('map'),ns='http://www.w3.org/2000/svg';svg.replaceChildren();
 const add=(tag,attributes,text)=>{const node=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attributes))node.setAttribute(k,String(v));if(text!==undefined)node.textContent=text;svg.append(node);return node;};
 add('image',{href:layer.url,width:1100,height:780});
 add('polyline',{points:state.sample.frames.map(f=>f.mapPoint.join(',')).join(' '),fill:'none',stroke:'#94a3b8','stroke-opacity':'.22','stroke-width':2,'stroke-dasharray':'4 5'});
 for(let i=1;i<state.sample.frames.length;i++){
  const a=state.sample.frames[i-1],b=state.sample.frames[i];if(a.layerId!==layerId||b.layerId!==layerId)continue;
  add('line',{x1:a.mapPoint[0],y1:a.mapPoint[1],x2:b.mapPoint[0],y2:b.mapPoint[1],stroke:i<=index?'#5bd6c6':'#4a6f8e','stroke-width':3});
 }
 for(const f of state.sample.frames){if(f.layerId!==layerId)continue;const point=add('circle',{cx:f.mapPoint[0],cy:f.mapPoint[1],r:f.index===index?7:3,fill:f.index<=index?'#5bd6c6':'#9aacc1',class:'point'});const title=document.createElementNS(ns,'title');title.textContent=`${time(f.atMs)} ${segmentFor(f).title}`;point.append(title);point.onclick=()=>{stop();go(f.index);};}
 if($('doors').checked){
  const b=state.sample.map.bounds,scale=Math.min((b.width-60)/(b.maxX-b.minX),(b.height-60)/(b.maxY-b.minY));
  for(const d of state.sample.map.doors){if(d.position[2]<layer.minZ||d.position[2]>=layer.maxZ)continue;const p=add('circle',{cx:30+(d.position[0]-b.minX)*scale,cy:b.height-30-(d.position[1]-b.minY)*scale,r:3,fill:'#f5be62'});const title=document.createElementNS(ns,'title');title.textContent=`静态门实体 ${d.class}；未验证状态/通行`;p.append(title);}
 }
 for(const s of state.sample.segments){if(s.kind!=='室内'||s.placeId==='vertical-unknown')continue;const f=state.sample.frames[s.startIndex];if(f.layerId!==layerId)continue;const t=add('text',{x:f.mapPoint[0]+7,y:f.mapPoint[1]-8,fill:'#fff4cc','font-size':13,'paint-order':'stroke',stroke:'#101a28','stroke-width':4},latest('segment',s.id)?.correctedLabel||s.title);t.style.pointerEvents='none';}
 if(frame.layerId===layerId){add('polygon',{points:'13,0 -7,-7 -3,0 -7,7',fill:'#ffcb6b',stroke:'#1b273a','stroke-width':2,transform:`translate(${frame.mapPoint.join(' ')}) rotate(${-frame.angles[1]})`});}
 $('map-caption').textContent=`${layer.title} · ${layer.surfaces}个BSP表面 · 当前高度Z=${frame.position[2].toFixed(1)} Source单位 · 灰虚线含其他高度投影，非通行证明`;
}
function drawForm(){
 const frame=state.sample.frames[index],segment=segmentFor(frame),scope=$('scope').value;
 const review=latest(scope,scope==='observation'?frame.id:segment.id),own=latest('observation',frame.id),segReview=latest('segment',segment.id);
 $('review-heading').textContent=scope==='observation'?`第${index+1}帧 · ${frame.id}`:`整段 · ${segReview?.correctedLabel||segment.title}`;
 $('review-state').textContent=names[review?.status??(scope==='segment'?segment.status:frame.annotation.status)??'pending-user-review'];
 $('label-correction').value=review?.correctedLabel??'';$('label-correction').placeholder=segReview?.correctedLabel||segment.title;
 $('description').value=own?.correctedDescription??frame.annotation.description;$('description').disabled=scope!=='observation';
 $('note').value=review?.note??'';
 $('inventory').textContent=`段内物品清单（不保证每帧均可见）：${segment.inventory}。段边界在相邻采样帧之间；不等同开门动作发生时刻。`;
 const summary=$('current-summary');summary.replaceChildren();summary.append(el('strong',`${own?.correctedLabel||segReview?.correctedLabel||segment.title} · ${segment.kind} · ${frame.annotation.visibility==='clear'?'画面可辨':frame.annotation.visibility==='limited'?'过渡／局部可辨':'极暗／不可确认'}`),el('div',own?.correctedDescription??frame.annotation.description),el('div',`地点ID：${frame.annotation.placeId}${frame.annotation.facilityId?'；所属场所：'+frame.annotation.facilityId:''}；状态：${names[effective(frame)?.status??frame.annotation.status??'pending-user-review']}`,'muted'));
  if(segReview?.note)summary.append(el('div','段级修订说明：'+segReview.note,'muted'));
 const counts={approved:0,'needs-change':0,uncertain:0,pending:0,complete:0};for(const f of state.sample.frames){const status=effective(f)?.status??(f.annotation.status==='annotation-complete'?'complete':'pending');counts[status]++;}
 $('progress').textContent=state.sample.reviewRequired===false?`${state.sample.frames.length}帧已补齐区域、场所、边界及操作标注，无需再次审核。段级物品清单不是逐帧穷举物体真值。`:`${state.sample.frames.length}帧：已确认${counts.approved} · 需修改${counts['needs-change']} · 无法确认${counts.uncertain} · 待审核${counts.pending} ｜ 保存版本${state.revision}`;
 if(state.sample.reviewRequired===false){$('description').readOnly=true;for(const id of ['scope','label-correction','note'])$(id).closest('label').hidden=true;document.querySelectorAll('.review-card button[data-status]').forEach(b=>b.hidden=true);}
 dirty=false;
}
function render(){const frame=state.sample.frames[index];$('seek').value=index;$('clock').textContent=`${time(frame.atMs)} / ${time(state.sample.durationMs)}`;$('frame-count').textContent=`${index+1} / ${state.sample.frames.length}${frame.sourceAtMs!==undefined?' · 原始源时间 '+time(frame.sourceAtMs):''}`;loadViews(frame);drawMap();drawSegments();drawForm();}
async function saveReview(body){
 if(state.sample.reviewRequired===false){$('save-state').textContent='此版标注已完成，以只读方式查看。';return;}
 if(saving)return;const preserveMainDraft=body.targetType==='revisit'&&dirty;saving=true;stop();document.querySelectorAll('button[data-status],.review-card input,.review-card textarea,.review-card select,.revisit textarea').forEach(b=>b.disabled=true);$('save-state').textContent='正在写入本地审核版本…';
 try{
  const response=await fetch('/api/reviews',{method:'POST',headers:{'Content-Type':'application/json','X-Review-Token':state.reviewToken},body:JSON.stringify({...body,expectedRevision:state.revision})});const result=await response.json();
  if(!response.ok){if(response.status===409){const fresh=await(await fetch('/api/sample')).json();state.reviews=fresh.reviews;state.revision=fresh.revision;}throw Error(result.error);}
  state.reviews.push(result.review);state.revision=result.revision;if(body.targetType==='revisit')unsavedRevisits.delete(body.targetId);if(!preserveMainDraft){dirty=false;drawForm();}drawSegments();drawMap();refreshRevisitStates();$('save-state').textContent=`已保存到本地 · 版本${result.revision}（刷新仍保留）`;
 }catch(error){$('save-state').textContent=`保存未完成：${error.message}。编辑仍保留，请检查后重试。`;}
 finally{saving=false;document.querySelectorAll('button[data-status],.review-card input,.review-card textarea,.review-card select,.revisit textarea').forEach(b=>b.disabled=false);$('description').disabled=$('scope').value!=='observation';}
}
function refreshRevisitStates(){for(const r of state.sample.revisits){const review=latest('revisit',r.id);$('status-'+r.id).textContent=names[review?.status??r.status];}}
function drawRevisits(){
 const root=$('revisits');root.replaceChildren();
 for(const r of state.sample.revisits){
  const placeTitle=state.sample.segments.find(s=>s.placeId===r.placeId)?.title??r.placeId;
  const section=el('article',undefined,'revisit');section.append(el('h3',`${placeTitle} · ${time(r.firstMs)} ↔ ${time(r.returnMs)}`));const status=el('p','待审核','status');status.id='status-'+r.id;section.append(status,el('p',r.basis));
   const compare=el('div',undefined,'compare');for(const [label,i] of (r.kind&&r.kind!=='positive'?[['参考',r.firstIndex],['当前',r.returnIndex]]:[['首次',r.firstIndex],['返回',r.returnIndex]])){
   const f=state.sample.frames[i],box=el('div'),jump=el('button',`${label} ${time(f.atMs)} · 跳转`);jump.onclick=()=>{stop();go(i);$('main').scrollIntoView({behavior:'smooth'});};box.append(jump);
   const images=el('div',undefined,'compare-views');for(const direction of ['left','front','right']){const link=el('a');link.href=f.views[direction];link.target='_blank';link.rel='noopener';const image=el('img');image.src=f.views[direction];image.loading='lazy';image.alt=`${label} ${direction}`;link.append(image);images.append(link);}box.append(images,el('p',f.annotation.description,'muted'));compare.append(box);
   }section.append(compare,el('p',Number.isFinite(r.distanceSourceUnits)?`两个参考视点距离约${r.distanceSourceUnits.toFixed(1)} Source单位；距离不等于房间身份。`:'关系由已确认的位置标签派生，未额外认证路径或通行能力。','muted'));
   const note=el('textarea');note.rows=2;note.maxLength=4000;note.placeholder='这组是否同一地点、应如何调整…';note.value=latest('revisit',r.id)?.note??'';note.oninput=()=>{stop();unsavedRevisits.add(r.id);};section.append(note);const actions=el('div',undefined,'row');const approval=r.expected==='different-place'?'确认不同区域':r.expected==='same-facility-different-region'?'确认同一场所不同区域':'确认同一区域';for(const [value,label] of [['approved',approval],['needs-change','关联需修改'],['uncertain','无法确认']]){const button=el('button',label);button.dataset.status=value;button.onclick=()=>saveReview({targetType:'revisit',targetId:r.id,status:value,note:note.value});actions.append(button);}section.append(actions);root.append(section);
 }refreshRevisitStates();if(state.sample.reviewRequired===false){document.querySelectorAll('.revisit textarea,.revisit button[data-status]').forEach(n=>n.hidden=true);document.querySelector('.revisits-card > p').textContent='地点关联标注已补齐；保留两次视点的三摄和依据供查看，不要求再逐条审核。';}
}
function drawActions(){
 if(!state.sample.actions?.length)return;$('action-panel').hidden=false;
 for(const action of state.sample.actions){const row=el('div',undefined,'row');const jump=el('button',`${time(action.atMs)}（源 ${time(action.sourceAtMs)}）`);jump.onclick=()=>{stop();go(state.sample.frames.reduce((best,f)=>Math.abs(f.atMs-action.atMs)<Math.abs(state.sample.frames[best].atMs-action.atMs)?f.index:best,0));$('main').scrollIntoView({behavior:'smooth'});};
 const targets=[...new Set(action.actualTargets.map(t=>`${t.class} ${t.model??''}`))].join(' / ')||'未观察到可用目标';const binding=action.recordedTargetSelectionBindingApplied||action.adjacentTargetBlocked?'（按原记录绑定目标，非自然选择准确率）':'';row.append(jump,el('span',`E按下已核对 · ${targets} · ${action.targetModelMatched===true?'目标模型吻合':action.targetModelMatched===false?'目标存在差异':'原记录未给出可比目标'}${binding}；不自动认定交互成功`));$('actions').append(row);}
}
function tick(){if(!playing)return;const target=sourceOrigin+(performance.now()-playOrigin)*Number($('speed').value);let next=index;while(next+1<state.sample.frames.length&&state.sample.frames[next+1].atMs<=target)next++;if(next!==index){index=next;render();}if(target>=state.sample.durationMs){stop();return;}requestAnimationFrame(tick);}
async function init(){
 const response=await fetch('/api/sample');if(!response.ok)throw Error('无法载入审核包');state=await response.json();
 if(state.sample.provenance?.memoryEvaluation){const link=el('a','打开空间记忆评测：标注与实际状态对照');link.href='/memory.html';document.body.prepend(link);}
 document.querySelector('h1').textContent=state.sample.title;document.title=state.sample.title;
 if(state.sample.reviewRequired===false){document.querySelector('header p').textContent=`${state.sample.frames.length}组三摄 · 播放时间${time(state.sample.durationMs)} · 原源时间${time(state.sample.sourceDurationMs)} · 已完成标注，无需再次审核`;document.querySelector('.notice').textContent='新版本：原始源时钟保留，播放时长为2倍，约1fps。全部E输入经引擎核对，电梯轿厢/门/灯同步重建；不是原录像恢复，不替换旧原速实时成绩。';document.querySelector('.player > p').textContent='按新播放时钟约1fps切换三摄；每1秒对应原运动约0.5秒。点击图片可看原尺寸，空格播放、方向键逐帧。';document.querySelector('.segment-card h2').textContent=`${state.sample.segments.length}段路线 · 标注已完成`;$('review-heading').textContent='当前帧标注';}
 $('seek').max=state.sample.frames.length-1;
 for(const layer of state.sample.map.layers){const option=el('option',layer.title);option.value=layer.id;$('layer').append(option);}
 for(const text of state.sample.limitations)$('limitations').append(el('li',text));
 $('integrity').textContent=`初始标注包SHA256：${state.datasetSHA256}。${state.sample.provenance?.userConfirmedPositionLabels?'位置标签已由用户确认；评测关系按固定规则派生，没有重新生成视觉细节。':'逐帧描述经助手查看三摄标注；审核记录另存，不覆盖原始包。'}`;
 $('previous').onclick=()=>{stop();go(index-1);};$('next').onclick=()=>{stop();go(index+1);};
 $('seek').oninput=()=>{stop();go(Number($('seek').value));};
 $('play').onclick=()=>{if(saving)return;if(playing){stop();return;}if(!canLeave())return;if(index===state.sample.frames.length-1)go(0);playing=true;playOrigin=performance.now();sourceOrigin=state.sample.frames[index].atMs;$('play').textContent='⏸ 暂停';requestAnimationFrame(tick);};
 $('speed').onchange=()=>{if(playing){playOrigin=performance.now();sourceOrigin=state.sample.frames[index].atMs;}};
 $('layer').onchange=drawMap;$('doors').onchange=drawMap;
 $('scope').onchange=()=>{if(dirty&&!confirm('切换审核范围会放弃未保存编辑，继续吗？')){$('scope').value=$('scope').value==='segment'?'observation':'segment';return;}stop();drawForm();};
 for(const id of ['description','note','label-correction'])$(id).oninput=()=>{dirty=true;stop();};
 document.querySelectorAll('.review-card button[data-status]').forEach(button=>button.onclick=()=>{const frame=state.sample.frames[index],scope=$('scope').value;saveReview({targetType:scope,targetId:scope==='observation'?frame.id:frame.annotation.segmentId,status:button.dataset.status,note:$('note').value,correctedLabel:$('label-correction').value,...scope==='observation'?{correctedDescription:$('description').value}:{}});});
  window.addEventListener('beforeunload',event=>{if(dirty||unsavedRevisits.size){event.preventDefault();event.returnValue='';}});
 window.addEventListener('keydown',event=>{if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)||event.ctrlKey||event.metaKey||event.altKey)return;if(event.code==='Space'){event.preventDefault();$('play').click();}if(event.code==='ArrowLeft'){event.preventDefault();stop();go(index-1);}if(event.code==='ArrowRight'){event.preventDefault();stop();go(index+1);}});
 $('loading').hidden=true;$('main').hidden=false;drawRevisits();drawActions();render();
}
init().catch(error=>{$('loading').textContent=`审核页加载失败：${error.message}`;});
