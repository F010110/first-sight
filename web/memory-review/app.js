'use strict';
const $=s=>document.querySelector(s);
const state={data:null,frames:null,index:0,details:new Map(),detail:null,ticket:0,playing:null};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=ms=>{if(ms===null||ms===undefined)return '—';const s=Math.floor(ms/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`};
const tag=(v,cls='')=>`<span class="tag ${cls}">${esc(v)}</span>`;
const verdictTag=v=>v?tag(v,v==='supported'?'ok':v==='contradicted'?'bad':'warn'):tag('无','');
const statusTag=s=>s?tag(s,s==='known'?'ok':s==='unknown'?'warn':''):tag('无','');
const directionLabel=d=>({left:'左摄',front:'前摄',right:'右摄'}[d]||d);
const sortViews=views=>[...(views||[])].sort((a,b)=>{const o={left:0,front:1,right:2};return (o[a.direction]??9)-(o[b.direction]??9)});
const dateText=iso=>{try{return new Date(iso).toLocaleString()}catch{return iso}};

async function load(){
 const [overviewResponse,framesResponse]=await Promise.all([fetch('/api/overview'),fetch('/api/frames')]);
 if(!overviewResponse.ok||!framesResponse.ok)throw Error('无法载入审核数据');
 state.data=await overviewResponse.json();
 state.frames=(await framesResponse.json()).observations;
 renderHeader();render(); 
}

function renderHeader(){
 const d=state.data,r=d.run.receipt,j=d.judge;
 $('#run-meta').innerHTML=`<b>${esc(d.run.id)}</b> · ${r.coveredObservations}/${r.observations} 观察 · ${r.spatialStates} 窗 + ${r.skippedWindows} 跳过 · 约束 <b>${d.constraint?.overall??'—'}/100</b>${d.constraint?.overallTested!=null?`（测试 ${d.constraint.overallTested}）`:''} · 严格裁判 ${j.overall?.overall??'—'}/100 · 分组 ${d.grouped.summary.meanGroupScore??'—'}`;
}

function render(){
 if(!state.frames?.length)return;
 state.index=Math.max(0,Math.min(state.index,state.frames.length-1));
 const frame=state.frames[state.index];
 renderBar(frame);renderViews(frame);
 state.detail=state.details.get(frame.version)??null;
 renderInfo(frame,state.detail);
 if(frame.version&&!state.details.has(frame.version)){
  const ticket=++state.ticket;
  fetch('/api/window/'+frame.version).then(r=>r.ok?r.json():null).then(detail=>{
   if(!detail)return;
   state.details.set(frame.version,detail);
   if(ticket===state.ticket&&state.index===state.frames.findIndex(f=>f.id===frame.id)){state.detail=detail;renderInfo(frame,detail);}
  }).catch(()=>{});
 }
}

function renderBar(frame){
 $('#position').textContent=`观察 ${state.index+1}/${state.frames.length} · ${fmt(frame.atMs)} · ${frame.id}${frame.version?` · 窗 v${frame.version}`:' · 无判断'}${frame.skipped?' · 跳过':''}`;
 const seek=$('#seek');seek.max=String(state.frames.length-1);seek.value=String(state.index);
 $('#play').textContent=state.playing?'⏸ 暂停':'▶ 播放';
}

function renderViews(frame){
 $('#views').innerHTML=sortViews(frame.views).map(v=>`<figure><img loading="eager" src="${esc(v.url)}" data-action="image" data-url="${esc(v.url)}" data-caption="${esc(frame.id)} · ${directionLabel(v.direction)}" alt="${esc(directionLabel(v.direction))}"><figcaption>${esc(directionLabel(v.direction))} · ${esc(frame.id)} · ${fmt(frame.atMs)}</figcaption></figure>`).join('');
}

function renderInfo(frame,detail){
 const ref=frame.reference||{};
 const loc=detail?.assessment?.location??{status:frame.status,placeId:frame.placeId,name:frame.placeName,reason:frame.reason};
 const cmp=detail?.comparison??{identity:{verdict:frame.identity,reason:frame.identityReason},currentReason:{verdict:frame.currentReason,reason:''},windowScope:{verdict:frame.windowScope,reason:''}};
 const ground=detail?.grounding??null;
 const findings=detail?.findings??[];
 const review=latestReview('observation',frame.id);
 const agent=frame.skipped?'<p class="muted">该观察属于跳过窗：没有位置判断，原图与独立事实仍在库中。</p>':`
  <div class="kv"><span class="k">状态</span><span>${statusTag(loc.status)}</span>
   <span class="k">地点</span><span>${esc(loc.name||'—')}</span>
   <span class="k">placeId</span><span class="small"><code>${esc(loc.placeId||'—')}</code></span>
   <span class="k">决定</span><span>${esc(detail?.locationDecision||'—')}</span>
   <span class="k">访问</span><span class="small"><code>${esc(detail?.visitId||'—')}</code></span></div>
  <h3>理由</h3><p class="reason">${esc(loc.reason||'—')}</p>
  ${loc.boundary?`<p class="small">${tag('boundary: '+loc.boundary.regions.join(' ↔ '),'info')}</p>`:''}
  ${loc.sourceIds?.length?`<p class="small muted">来源：${loc.sourceIds.map(esc).join(', ')}</p>`:''}`;
 const judge=frame.skipped?'<p class="muted">该观察没有判断窗，裁判不评。</p>':`
  <div class="kv"><span class="k">identity</span><span>${verdictTag(frame.identity)}</span>
   <span class="k">currentReason</span><span>${verdictTag(frame.currentReason)}</span>
   <span class="k">windowScope</span><span>${verdictTag(frame.windowScope)}</span></div>
  <h3>identity 理由</h3><p class="reason">${esc(cmp.identity?.reason||'—')}</p>
  <h3>currentReason 理由</h3><p class="reason">${esc(cmp.currentReason?.reason||'—')}</p>
  <h3>windowScope 理由</h3><p class="reason">${esc(cmp.windowScope?.reason||'—')}</p>
  ${ground?`<h3>盲取证</h3><div class="kv"><span class="k">窗头</span><span>${esc(ground.start?.occupiedRegion||'—')} · ${esc(ground.start?.nearGroundEvidence||'')}</span><span class="k">窗尾</span><span>${esc(ground.end?.occupiedRegion||'—')} · ${esc(ground.end?.nearGroundEvidence||'')}</span><span class="k">范围</span><span>${esc(ground.windowScope||'—')}</span></div>`:''}
  ${findings.length?`<h3>本窗确认问题</h3>${findings.map(f=>`<div class="finding ${f.verdict==='uncertain'?'warn':''}"><div class="small"><b>${esc(f.dimension)} · ${esc(f.verdict)} · ${esc(f.severity)}</b></div><div class="q small">${esc(f.quote)}</div><div class="small">${esc(f.reason)}</div></div>`).join('')}`:''}`;
 const db=frame.skipped?'<p class="muted">跳过窗没有新的地点/访问写入。</p>':`
  <div class="kv"><span class="k">memoryReceipt</span><span class="small"><code>${esc(JSON.stringify(detail?.memoryReceipt??null))}</code></span>
   <span class="k">地点</span><span>${esc(detail?.place?.name||'—')} <span class="small muted">${esc(detail?.place?.id||'')}</span></span>
   <span class="k">访问</span><span class="small"><code>${esc(detail?.visit?.id||'—')}</code> · start ${esc(detail?.visit?.start_version??'—')}</span></div>
  <h3>地点笔记</h3>${(detail?.notes||[]).map(n=>`<p class="small">· ${esc(n.text)} <span class="muted">(v${esc(n.created_version)})</span></p>`).join('')||'<p class="muted small">无</p>'}
  <h3>资料修订</h3>${(detail?.revisions||[]).map(r=>`<p class="small">v${esc(r.version)} ${esc(r.key)} ${esc(JSON.stringify(r.raw))}</p>`).join('')||'<p class="muted small">无</p>'}`;
 $('#info').innerHTML=`
  <section class="card"><h2>位置数据标注</h2>
   <div class="kv"><span class="k">段</span><span>${esc(ref.segmentId||'—')}</span>
    <span class="k">地点</span><span>${esc(ref.placeId||'—')}</span>
    <span class="k">设施</span><span>${esc(ref.facilityId||'—')}</span>
    <span class="k">可见性</span><span>${esc(ref.visibility||'—')}${ref.boundaryUncertain?tag('边界不确定','warn'):''}</span></div>
   <h3>描述</h3><p class="small">${esc(ref.description||'—')}</p>
  </section>
  <section class="card"><h2>Agent 判定 ${frame.version?tag('窗 v'+frame.version,'info'):''}</h2>${agent}</section>
  <section class="card"><h2>裁判判断</h2>${judge}</section>
  <section class="card"><h2>其他写入库的信息</h2>${db}</section>
  <section class="card full"><h2>人工审核</h2>${reviewForm(frame,review)}</section>`;
}

function latestReview(type,id){return [...(state.data?.reviews||[])].reverse().find(r=>r.targetType===type&&r.targetId===String(id))??null;}

function reviewForm(frame,latest){
 return `<form class="review-form" data-target-type="observation" data-target-id="${esc(frame.id)}">
  <select name="verdict"><option value="agree">同意</option><option value="disagree">不同意</option><option value="unsure">无法确定</option></select>
  <textarea name="note" maxlength="2000" placeholder="审核备注（可选）"></textarea>
  <button type="button" data-action="save-review">保存审核</button>
  <div class="latest">${latest?`最近：<b>${esc(latest.verdict)}</b> ${esc(latest.note||'')} · ${esc(dateText(latest.at))}`:'尚无人工审核记录'}</div>
 </form>`;
}

function drawerHtml(){
 const d=state.data;
 const issues=d.findings.map(f=>{
  const index=state.frames.findIndex(x=>x.version===f.version);
  return `<div class="issue" data-action="jump-index" data-index="${index}">
   <div class="small"><b>v${f.version}</b> · ${esc(f.dimension)} · <span class="${f.verdict==='contradicted'?'tag bad':'tag warn'}">${esc(f.verdict)}</span> · ${esc(f.severity)}</div>
   <div class="q small">${esc(f.quote)}</div><div class="small muted">${esc(f.reason)}</div></div>`;
 }).join('');
 const skipRuns=[];let start=-1;
 state.frames.forEach((f,i)=>{if(f.skipped&&start<0)start=i;if(!f.skipped&&start>=0){skipRuns.push([start,i-1]);start=-1;}});
 if(start>=0)skipRuns.push([start,state.frames.length-1]);
 const skipped=skipRuns.map(([a,b])=>`<div class="issue" data-action="jump-index" data-index="${a}"><div class="small"><b>跳过 ${state.frames[a].id} – ${state.frames[b].id}</b> · ${b-a+1} 观察</div><div class="small muted">${fmt(state.frames[a].atMs)}–${fmt(state.frames[b].atMs)}，没有位置判断</div></div>`).join('');
 return `<h3>裁判确认/存疑 ${d.findings.length}</h3>${issues||'<p class="muted small">无</p>'}<h3>跳过窗 ${skipRuns.length}</h3>${skipped||'<p class="muted small">无</p>'}`;
}

function openDrawer(){$('#drawer').hidden=false;$('#drawer-body').innerHTML=drawerHtml();}
function closeDrawer(){$('#drawer').hidden=true;}

function go(index){
 state.index=Math.max(0,Math.min(state.frames.length-1,index));render();
}
function findNext(predicate,from=state.index+1){
 for(let n=0;n<state.frames.length;n++){
  const i=(from+n)%state.frames.length;
  if(predicate(state.frames[i]))return i;
 }
 return -1;
}
function stopPlay(){if(state.playing){clearInterval(state.playing);state.playing=null;}}
function togglePlay(){
 if(state.playing){stopPlay();renderBar(state.frames[state.index]);return;}
 state.playing=setInterval(()=>{
  if(state.index>=state.frames.length-1){stopPlay();render();return;}
  go(state.index+1);
 },2000);
 renderBar(state.frames[state.index]);
}

async function saveReview(button){
 const form=button.closest('form'),fd=new FormData(form);
 const body={targetType:form.dataset.targetType,targetId:form.dataset.targetId,verdict:fd.get('verdict'),note:String(fd.get('note')||'')};
 const response=await fetch('/api/review',{method:'POST',headers:{'content-type':'application/json','x-review-token':state.data.reviewToken},body:JSON.stringify(body)});
 if(!response.ok){alert((await response.json().catch(()=>({}))).error||'保存失败');return;}
 const result=await response.json();state.data.reviews=result.reviews;
 renderInfo(state.frames[state.index],state.detail);
}

function openModal(url,caption){if(!url)return;$('#modal-image').src=url;$('#modal-caption').textContent=caption||'';$('#modal').hidden=false;}
function closeModal(){$('#modal').hidden=true;$('#modal-image').src='';}

document.addEventListener('error',event=>{const el=event.target;if(el&&el.tagName==='IMG'){el.classList.add('broken');el.alt='原图无法加载';}},true);
document.addEventListener('change',event=>{
 const el=event.target.closest?.('[data-action="seek"]');if(!el)return;
 go(Number(el.value));stopPlay();
});
document.addEventListener('click',async event=>{
 const el=event.target.closest('[data-action]');if(!el)return;
 const action=el.dataset.action;
 if(action==='prev'){event.preventDefault();stopPlay();go(state.index-1);return;}
 if(action==='next'){event.preventDefault();stopPlay();go(state.index+1);return;}
 if(action==='play'){event.preventDefault();togglePlay();return;}
 if(action==='next-issue'){event.preventDefault();stopPlay();const i=findNext(f=>f.identity==='contradicted'||f.currentReason==='contradicted'||f.windowScope==='contradicted');if(i>=0)go(i);return;}
 if(action==='next-skip'){event.preventDefault();stopPlay();const i=findNext(f=>f.skipped);if(i>=0)go(i);return;}
 if(action==='drawer'){event.preventDefault();openDrawer();return;}
 if(action==='close-drawer'){closeDrawer();return;}
 if(action==='jump-index'){event.preventDefault();closeDrawer();stopPlay();go(Number(el.dataset.index));return;}
 if(action==='image'){event.preventDefault();openModal(el.dataset.url,el.dataset.caption);return;}
 if(action==='close-modal'){closeModal();return;}
 if(action==='save-review'){event.preventDefault();await saveReview(el);return;}
});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'){if(!$('#modal').hidden){closeModal();return;}if(!$('#drawer').hidden){closeDrawer();return;}stopPlay();return;}
 if(event.target&&['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName))return;
 if(event.key==='ArrowLeft'){event.preventDefault();stopPlay();go(state.index-1);return;}
 if(event.key==='ArrowRight'){event.preventDefault();stopPlay();go(state.index+1);return;}
 if(event.key===' '){event.preventDefault();togglePlay();return;}
 if(event.key==='j'||event.key==='J'){event.preventDefault();stopPlay();const i=findNext(f=>f.identity==='contradicted'||f.currentReason==='contradicted'||f.windowScope==='contradicted');if(i>=0)go(i);return;}
 if(event.key==='s'||event.key==='S'){event.preventDefault();stopPlay();const i=findNext(f=>f.skipped);if(i>=0)go(i);return;}
});

load().catch(error=>{$('#info').innerHTML=`<p class="card">${esc(String(error))}</p>`;});
