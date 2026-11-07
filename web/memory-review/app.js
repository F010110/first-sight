'use strict';
const $=s=>document.querySelector(s);
const state={data:null,tab:'groups',filter:'all',group:null,groupDetail:null,windowDetail:null,view:'group',selectedVersion:null};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=ms=>{if(ms===null||ms===undefined)return '—';const s=Math.floor(ms/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`};
const pct=(n,d)=>d?`${(100*n/d).toFixed(1)}%`:'—';
const scoreClass=v=>v===null||v===undefined?'na':v===100?'s100':v>=75?'s75':v>=50?'s50':'s0';
const scoreChip=v=>`<span class="score ${scoreClass(v)}">${v===null||v===undefined?'—':v}</span>`;
const tag=(v,cls='')=>`<span class="tag ${cls}">${esc(v)}</span>`;
const verdictTag=v=>v?tag(v,v==='supported'?'ok':v==='contradicted'?'bad':'warn'):tag('无','');
const statusTag=s=>s?tag(s,s==='known'?'ok':s==='unknown'?'warn':''):tag('无','');
const dateText=iso=>{try{return new Date(iso).toLocaleString()}catch{return iso}};
const sortViews=views=>[...(views||[])].sort((a,b)=>{const o={left:0,front:1,right:2};return (o[a.direction]??9)-(o[b.direction]??9)});

async function load(){
 const response=await fetch('/api/overview');
 if(!response.ok){$('#detail').innerHTML=`<p class="panel">无法载入：${esc((await response.json().catch(()=>({}))).error||response.status)}</p>`;return;}
 state.data=await response.json();
 renderHeader();renderSummary();renderTabs();renderSidebar();renderDetail();renderTools();
}

function renderHeader(){
 const d=state.data,r=d.run.receipt,j=d.judge;
 $('#run-meta').innerHTML=`<b>${esc(d.run.id)}</b><br>${j.model} · 总分 ${j.overall?.overall??'—'}/100 · 分组 ${d.grouped.summary.meanGroupScore??'—'} · ${d.grouped.coverage.coverageScope}<br>${r.spatialStates} 判断窗 + ${r.skippedWindows} 跳过 / ${r.observations} 观察 · ${r.windowMs/1000}s 窗 · ${r.realtimeEnforced?'强制实时':'回放'}`;
}

function renderSummary(){
 const d=state.data,g=d.grouped.summary,c=d.grouped.coverage,w=g.windowIdentity,e=g.windowEvidence;
 const cards=[
  ['分组均分',g.meanGroupScore??'—',`中位数 ${g.medianGroupScore??'—'} · ${g.scoredGroups}/${g.groups} 组`],
  ['判断覆盖',`${d.run.receipt.coveredObservations}/${d.run.receipt.observations}`,`${c.coverageScope} · 跳过 ${c.skippedObservations} 观察`],
  ['identity 窗口',`${w.supported}/${w.supported+w.uncertain+w.contradicted}`,`${w.contradicted} contradicted · ${w.uncertain} uncertain`],
  ['evidence 窗口',`${e.supported}/${e.supported+e.uncertain+e.contradicted}`,`${e.contradicted} contradicted`],
  ['合并 / 拆分',`${d.grouped.merges.length} / ${d.grouped.splits.length}`,'一个候选地点覆盖多个参考地点'],
  ['重访复用',`${d.grouped.revisits.filter(r=>r.verdict==='reused').length}/${d.grouped.revisits.length}`,'参考重复地点是否复用同一候选 ID'],
  ['裁判总分',`${d.judge.overall?.overall??'—'}`,'Dim: '+Object.entries(d.judge.overall?.dimensions||{}).map(([k,v])=>`${k} ${v}`).join(' · ')],
  ['人工审核',d.reviews.length,`记录在 run/web-review/reviews.jsonl`]
 ];
 $('#summary').innerHTML=cards.map(([k,v,s])=>`<div class="card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`).join('');
}

function renderTabs(){
 document.querySelectorAll('.tabs button[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===state.tab));
}

function renderSidebar(){
 const side=$('#sidebar'),d=state.data;
 if(state.tab==='groups'){
  side.classList.remove('full');
  const filters=[['all','全部'],['low','未满分'],['bad','有矛盾'],['merged','合并'],['revisit','重访'],['skipped','有跳过']];
  const items=d.groups.filter(g=>{
   if(state.filter==='low')return g.identityScore!==null&&g.identityScore<100;
   if(state.filter==='bad')return g.contradictedVersions.length>0;
   if(state.filter==='merged')return g.merged;
   if(state.filter==='revisit')return d.grouped.revisits.some(r=>r.referencePlace===g.placeId);
   if(state.filter==='skipped')return g.skipped>0;
   return true;
  });
  side.innerHTML=`<div class="filters">${filters.map(([k,label])=>`<button data-action="filter" data-filter="${k}" class="${state.filter===k?'active':''}">${label}</button>`).join('')}</div>`+
   items.map(g=>`<div class="item ${state.group===g.segmentId?'selected':''}" data-action="group" data-id="${esc(g.segmentId)}">
    ${scoreChip(g.identityScore)}
    <div class="main"><div class="title">${esc(g.title||g.placeId)}</div>
    <div class="meta">${esc(g.segmentId)} · ${fmt(g.startMs)}–${fmt(g.endMs)} · ${g.windows.length}窗 · ${g.covered}/${g.judged} obs</div>
    <div>${g.contradictedVersions.length?tag(g.contradictedVersions.length+' 矛盾','bad'):''}${g.uncertainVersions.length?tag(g.uncertainVersions.length+' 存疑','warn'):''}${g.merged?tag('merge','info'):''}${g.split?tag('split','warn'):''}${d.grouped.revisits.some(r=>r.referencePlace===g.placeId)?tag('revisit','info'):''}</div></div></div>`).join('');
 }else if(state.tab==='windows'){
  side.classList.remove('full');
  side.innerHTML=`<div class="filters"><span class="muted small">${d.windows.length} 个判断窗</span></div>`+
   d.windows.map(w=>`<div class="item ${state.selectedVersion===w.version?'selected':''}" data-action="window" data-version="${w.version}">
    <div class="score ${w.identity==='contradicted'?'s0':w.identity==='uncertain'?'s50':'s100'}">${w.version}</div>
    <div class="main"><div class="title">${esc(w.placeName||'—')}</div>
    <div class="meta">${fmt(w.startMs)}–${fmt(w.endExclusiveMs)} · ${esc(w.segmentId||'')}</div>
    <div>${verdictTag(w.identity)}${verdictTag(w.currentReason)}</div></div></div>`).join('');
 }else side.classList.add('full');
}

function renderDetail(){
 const el=$('#detail'),d=state.data;
 if(state.tab==='groups'){
  if(state.view==='window'&&state.windowDetail)el.innerHTML=windowHtml(state.windowDetail,true);
  else if(state.groupDetail)el.innerHTML=groupHtml(state.groupDetail);
  else el.innerHTML='<p class="panel muted">从左侧选择一个参考地点组。</p>';
 }else if(state.tab==='windows'){
  el.innerHTML=state.windowDetail?windowHtml(state.windowDetail,false):'<p class="panel muted">从左侧选择一个判断窗。</p>';
 }else if(state.tab==='findings')el.innerHTML=findingsHtml();
 else if(state.tab==='library')el.innerHTML=libraryHtml();
 else if(state.tab==='skipped')el.innerHTML=skippedHtml();
}

function groupHtml(detail){
 const g=detail.group,seg=detail.segment||{},d=state.data;
 const segIndex=d.segments.findIndex(s=>s.id===g.segmentId);
 const revisit=d.grouped.revisits.find(r=>r.referencePlace===g.placeId);
 return `<article class="panel">
  <div class="spread"><div><h1>${esc(g.title||g.placeId)} ${scoreChip(g.identityScore)}</h1>
   <div class="muted">${esc(g.segmentId)} · 参考地点 <code>${esc(g.placeId)}</code> · ${fmt(g.startMs)}–${fmt(g.endMs)} · ${esc(g.kind||'')}</div></div>
   <div class="row">${g.merged?tag('合并','info'):''}${g.split?tag('拆分','warn'):''}${revisit?tag('重访 '+revisit.verdict,revisit.verdict==='reused'?'ok':'bad'):''}</div></div>
  <div class="grid2 mt12">
   <div class="kv"><span class="k">判断窗</span><span>${g.windows.length} 个（覆盖 ${g.covered}/${g.judged} 观察）</span>
    <span class="k">identity / evidence</span><span>${g.identityScore??'—'} / ${g.evidenceScore??'—'}</span>
    <span class="k">候选地点</span><span>${g.agentPlaces.map(p=>esc(p.name)+' ×'+p.windows).join(' · ')||'—'}</span>
    <span class="k">参考类别</span><span>${esc(seg.kind||'')}</span>
    <span class="k">跳过观察</span><span>${g.skipped}</span>
    <span class="k">合并到</span><span>${g.merged?esc(g.mergedWith.join(', ')):'—'}</span></div>
   <div><div class="k muted">参考段说明</div><p>${esc(seg.inventory||'—')}</p><div class="muted small">${esc(seg.boundaryScope||'')}</div><div class="muted small">${esc(seg.annotationAuthority||'')}</div></div>
  </div>
  <h2>被判断的窗</h2>
  <div class="windows">${detail.windows.map(w=>windowCard(w,'assigned')).join('')||'<p class="muted">这个组没有判断窗。</p>'}</div>
  ${detail.crossWindows.length?`<h2>跨组窗</h2><div class="windows">${detail.crossWindows.map(w=>windowCard(w,'cross')).join('')}</div>`:''}
  ${detail.skipped.length?`<h2>跳过的观察</h2><p class="muted">这些观察没有位置判断；原图与事实仍在库中。</p><table><thead><tr><th>观察</th><th>时间</th><th>参考地点</th><th>可见性</th></tr></thead><tbody>${detail.skipped.map(o=>`<tr><td>${esc(o.id)}</td><td class="num">${fmt(o.atMs)}</td><td>${esc(o.detail?.placeId||'')}</td><td>${esc(o.detail?.visibility||'')}</td></tr>`).join('')}</tbody></table>`:''}
  <h2>人工审核</h2>${reviewForm('group',g.segmentId)}
 </article>`;
}

function windowCard(w,kind){
 const cmp=w.comparison||{},cls=w.identity==='contradicted'?'bad':w.identity==='uncertain'?'warn':'';
 return `<div class="window-card ${cls}">
  <div class="window-head"><div><b>v${w.version}</b> · ${fmt(w.startMs)}–${fmt(w.endExclusiveMs)} · ${w.members??''}${kind==='cross'?' <span class="tag info">↗ 跨组</span>':''}</div>
   <div>${verdictTag(w.identity)}${w.currentReason?verdictTag(w.currentReason):''}${w.windowScope?verdictTag(w.windowScope):''}</div></div>
  <div class="small mt6"><b>候选：</b>${esc(w.placeName||'—')} ${statusTag(w.status)} <span class="muted">${esc(w.locationDecision||'')}</span></div>
  <div class="reason small">${esc(w.assessment?.location?.reason||'')}</div>
  ${cmp.identity?.reason?`<div class="small"><span class="muted">identity：</span>${esc(cmp.identity.reason)}</div>`:''}
  ${cmp.currentReason?.reason?`<div class="small"><span class="muted">currentReason：</span>${esc(cmp.currentReason.reason)}</div>`:''}
  <div class="row mt8"><a class="button" href="#" data-action="window" data-version="${w.version}">查看该窗三摄与库信息 →</a>${w.sheetUrl?`<a href="#" data-action="image" data-url="${w.sheetUrl}" data-caption="v${w.version} 裁判接触图">裁判接触图</a>`:''}</div>
 </div>`;
}

function windowHtml(w,fromGroup){
 const cmp=w.comparison||{},ground=w.grounding||{},loc=w.assessment?.location||{};
 const first=w.observations?.[0],last=w.observations?.[w.observations.length-1];
 const views=obs=>obs?`<div class="views">${sortViews(obs.views).map(v=>`<figure><img loading="lazy" src="${esc(v.url)}" data-action="image" data-url="${esc(v.url)}" data-caption="${esc(obs.id)} · ${esc(v.direction)}"><figcaption>${esc(obs.id)} · ${esc(v.direction)}</figcaption></figure>`).join('')}</div>`:'';
 return `<article class="panel">
  <div class="spread"><div><h1>v${w.version} ${verdictTag(w.identity)}</h1>
   <div class="muted">${fmt(w.startMs)}–${fmt(w.endExclusiveMs)} · ${esc(w.segmentId||'')} · 候选 <code>${esc(w.placeId||'—')}</code> · 访问 <code>${esc(w.visitId||'—')}</code></div></div>
   <div class="row">${fromGroup?'<a href="#" data-action="back-group">← 返回组</a>':''}<a href="#" data-action="image" data-url="${esc(w.sheetUrl||'')}" data-caption="v${w.version} 裁判接触图">裁判接触图</a></div></div>
  <div class="tag-row mt8">${statusTag(loc.status)}${tag(loc.name||'—')}${loc.boundary?tag('boundary: '+loc.boundary.regions.join(' ↔ '),'info'):''}</div>
  <div class="reason mt8">${esc(loc.reason||'')}</div>
  <div class="split mt12">
   <div><h3>窗头</h3>${views(first)}<div class="muted small">${esc(first?.facts?.summary||'')}</div></div>
   <div><h3>窗尾</h3>${views(last)}<div class="muted small">${esc(last?.facts?.summary||'')}</div></div>
  </div>
  <h2>裁判逐窗判断</h2>
  <div class="grid2">
   <div class="kv"><span class="k">identity</span><span>${verdictTag(w.identity)}</span><span class="k">identity 理由</span><span>${esc(cmp.identity?.reason||'—')}</span>
    <span class="k">currentReason</span><span>${verdictTag(w.currentReason)}</span><span class="k">currentReason 理由</span><span>${esc(cmp.currentReason?.reason||'—')}</span>
    <span class="k">windowScope</span><span>${verdictTag(w.windowScope)}</span><span class="k">windowScope 理由</span><span>${esc(cmp.windowScope?.reason||'—')}</span></div>
   <div class="kv"><span class="k">盲取证·窗头</span><span>${esc(ground.start?.occupiedRegion||'—')} · ${esc(ground.start?.nearGroundEvidence||'')}</span>
    <span class="k">盲取证·窗尾</span><span>${esc(ground.end?.occupiedRegion||'—')} · ${esc(ground.end?.nearGroundEvidence||'')}</span>
    <span class="k">取证范围</span><span>${esc(ground.windowScope||'—')}</span>
    <span class="k">取证限制</span><span>${esc(ground.limitations||'—')}</span>
    <span class="k">分组</span><span>${w.group?`${esc(w.group.segmentId)} · ${w.group.identityScore??'—'} 分`: '—'}</span></div>
  </div>
  <h2>参考标注（本窗成员）</h2>
  <table><thead><tr><th>观察</th><th>时间</th><th>段</th><th>地点</th><th>可见性</th><th>边界</th></tr></thead><tbody>
   ${(w.observations||[]).map(o=>`<tr><td>${esc(o.id)}</td><td class="num">${fmt(o.atMs)}</td><td>${esc(o.reference?.segmentId||'')}</td><td>${esc(o.reference?.placeId||'')}</td><td>${esc(o.reference?.visibility||'')}</td><td>${o.reference?.boundaryUncertain?'不确定':'—'}</td></tr>`).join('')}
  </tbody></table>
  <h2>库写入</h2>
  <div class="grid2"><div class="kv"><span class="k">memoryReceipt</span><span><code>${esc(JSON.stringify(w.memoryReceipt||null))}</code></span>
    <span class="k">地点</span><span>${esc(w.place?.name||'—')} <code>${esc(w.place?.id||'')}</code></span>
    <span class="k">访问</span><span><code>${esc(w.visit?.id||'')}</code> start ${esc(w.visit?.start_version??'')}</span>
    <span class="k">locationDecision</span><span>${esc(w.locationDecision||'')}</span></div>
   <div><div class="muted small">地点笔记</div>${(w.notes||[]).map(n=>`<div class="small">· ${esc(n.text)} <span class="muted">(v${n.created_version})</span></div>`).join('')||'<div class="muted small">无</div>'}
    <div class="muted small mt6">资料修订</div>${(w.revisions||[]).map(r=>`<div class="small">v${r.version} ${esc(r.key)} ${esc(JSON.stringify(r.raw))}</div>`).join('')||'<div class="muted small">无</div>'}</div></div>
  ${(w.findings||[]).length?`<h2>裁判发现</h2>${w.findings.map(f=>`<div class="window-card bad"><b>${esc(f.dimension)} · ${esc(f.verdict)} · ${esc(f.severity)}</b><div class="reason small">${esc(f.quote)}</div><div class="small">${esc(f.reason)}</div></div>`).join('')}`:''}
  <details class="mt12"><summary class="muted">逐观察事实</summary>${(w.observations||[]).map(o=>`<div class="small mt6"><b>${esc(o.id)} ${fmt(o.atMs)}</b> ${esc(o.facts?.summary||'')}<div class="muted">${esc((o.facts?.details||[]).join('；'))}</div></div>`).join('')}</details>
  <h2>人工审核</h2>${reviewForm('window',w.version)}
 </article>`;
}

function reviewForm(targetType,targetId){
 const latest=[...state.data.reviews].reverse().find(r=>r.targetType===targetType&&r.targetId===String(targetId));
 return `<form class="review" data-target-type="${targetType}" data-target-id="${esc(targetId)}">
  <select name="verdict"><option value="agree">同意</option><option value="disagree">不同意</option><option value="unsure">无法确定</option></select>
  <textarea name="note" maxlength="2000" placeholder="审核备注（可选）"></textarea>
  <button type="button" data-action="save-review">保存审核</button>
  <div class="latest">${latest?`最近：<b>${esc(latest.verdict)}</b> ${esc(latest.note||'')} · ${esc(dateText(latest.at))}`:'尚无人工审核记录'}</div>
 </form>`;
}

function findingsHtml(){
 const fs=state.data.findings;
 return `<article class="panel"><h1>裁判发现 ${fs.length}</h1><p class="muted">这些是逐窗对照的确认/存疑项；点击可跳到窗口。</p>
  ${fs.map(f=>`<div class="window-card ${f.verdict==='contradicted'?'bad':'warn'}">
   <div class="window-head"><div><b>v${f.version}</b> · ${esc(f.dimension)} · ${esc(f.verdict)} · ${esc(f.severity)}</div><a href="#" data-action="window" data-version="${f.version}">查看窗口 →</a></div>
   <div class="reason small">${esc(f.quote)}</div><div class="small">${esc(f.reason)}</div>
   <div class="muted small">来源：${(f.sourceIds||[]).map(esc).join(', ')}</div></div>`).join('')}
 </article>`;
}

function libraryHtml(){
 const d=state.data,p=d.places,v=d.visits,n=d.notes,r=d.revisions;
 const visitCount=id=>v.filter(x=>x.place_id===id).length,noteCount=id=>n.filter(x=>x.place_id===id).length;
 return `<article class="panel"><h1>原始记录</h1>
  <div class="kv"><span class="k">运行</span><span><code>${esc(d.run.path)}</code></span>
   <span class="k">DB hash</span><span><code>${esc(d.run.hashes?.database||'')}</code></span>
   <span class="k">参考</span><span>${esc(d.judge.dir)}</span>
   <span class="k">裁判</span><span>${esc(d.judge.model)} · ${d.judge.overall?.overall??'—'}/100 · ${esc(d.judge.coverageScope)}</span></div>
  <h2>地点 ${p.length}</h2>
  <table><thead><tr><th>名称</th><th>ID</th><th>创建窗</th><th>访问</th><th>笔记</th></tr></thead><tbody>${p.map(x=>`<tr><td>${esc(x.name)}</td><td class="small">${esc(x.id)}</td><td class="num">${esc(x.created_version)}</td><td class="num">${visitCount(x.id)}</td><td class="num">${noteCount(x.id)}</td></tr>`).join('')}</tbody></table>
  <h2>访问 ${v.length}</h2>
  <table><thead><tr><th>ID</th><th>地点</th><th>起始窗</th></tr></thead><tbody>${v.map(x=>`<tr><td class="small">${esc(x.id)}</td><td>${esc(p.find(y=>y.id===x.place_id)?.name||x.place_id)}</td><td class="num">${esc(x.start_version)}</td></tr>`).join('')}</tbody></table>
  <h2>地点笔记 ${n.length}</h2>
  ${n.map(x=>`<div class="window-card"><b>${esc(p.find(y=>y.id===x.place_id)?.name||x.place_id)}</b> · v${esc(x.created_version)}<div>${esc(x.text)}</div><div class="muted small">来源：${(x.sources||[]).map(s=>`${esc(s.source_id)}@v${esc(s.version)}`).join(', ')}</div></div>`).join('')||'<p class="muted">无</p>'}
  <h2>资料修订 ${r.length}</h2>${r.length?`<pre class="small">${esc(JSON.stringify(r,null,2))}</pre>`:'<p class="muted">无</p>'}
 </article>`;
}

function skippedHtml(){
 const s=state.data.skipped;
 return `<article class="panel"><h1>跳过观察 ${s.length}</h1><p class="muted">这些观察在强制实时下被跳过：没有位置判断，原图与独立事实仍在库中。它们不算 0 分，是覆盖缺口。</p>
  <table><thead><tr><th>观察</th><th>时间</th><th>段</th><th>地点</th><th>可见性</th><th>边界</th></tr></thead><tbody>${s.map(o=>`<tr><td>${esc(o.id)}</td><td class="num">${fmt(o.atMs)}</td><td>${esc(o.reference?.segmentId||'')}</td><td>${esc(o.reference?.placeId||'')}</td><td>${esc(o.reference?.visibility||'')}</td><td>${o.reference?.boundaryUncertain?'不确定':'—'}</td></tr>`).join('')}</tbody></table>
 </article>`;
}

function renderTools(){
 $('#tools').innerHTML=`<h3>网页端口</h3><table><thead><tr><th>工具</th><th>端口</th><th>命令</th><th>模型调用</th></tr></thead><tbody>${state.data.tools.map(t=>`<tr><td>${esc(t.name)}</td><td class="num"><a href="http://127.0.0.1:${t.port}/" target="_blank" rel="noopener">${t.port}</a></td><td><code>${esc(t.command)}</code></td><td>${t.models?'是':'否'}</td></tr>`).join('')}</tbody></table>`;
}

async function selectGroup(id){
 state.view='group';state.group=id;state.tab='groups';renderTabs();
 const response=await fetch('/api/group/'+encodeURIComponent(id));
 if(!response.ok){$('#detail').innerHTML=`<p class="panel">${esc((await response.json()).error)}</p>`;return;}
 state.groupDetail=await response.json();state.windowDetail=null;
 const g=state.groupDetail.group;
 state.selectedVersion=g.contradictedVersions[0]??g.windows[0]?.version??g.crossWindows[0]?.version??null;
 renderSidebar();renderDetail();
}
async function selectWindow(version){
 state.tab=state.tab==='groups'?'groups':state.tab;
 const response=await fetch('/api/window/'+version);
 if(!response.ok){$('#detail').innerHTML=`<p class="panel">${esc((await response.json()).error)}</p>`;return;}
 state.windowDetail=await response.json();state.view='window';state.selectedVersion=version;
 state.group=state.windowDetail.group?.segmentId??state.group;
 renderSidebar();renderDetail();
}
function openModal(url,caption){
 if(!url)return;
 $('#modal-image').src=url;$('#modal-caption').textContent=caption||'';$('#modal').hidden=false;
}
function closeModal(){$('#modal').hidden=true;$('#modal-image').src='';}

async function saveReview(button){
 const form=button.closest('form'),fd=new FormData(form);
 const body={targetType:form.dataset.targetType,targetId:form.dataset.targetId,verdict:fd.get('verdict'),note:String(fd.get('note')||'')};
 const response=await fetch('/api/review',{method:'POST',headers:{'content-type':'application/json','x-review-token':state.data.reviewToken},body:JSON.stringify(body)});
 if(!response.ok){alert((await response.json().catch(()=>({}))).error||'保存失败');return;}
 const result=await response.json();state.data.reviews=result.reviews;renderSummary();renderDetail();
}

document.addEventListener('click',async event=>{
 const el=event.target.closest('[data-action]');if(!el)return;
 const action=el.dataset.action;
 if(action==='tab'){event.preventDefault();state.tab=el.dataset.tab;if(state.tab==='groups'&&!state.group)state.group=state.data.groups[0]?.segmentId??null;if(state.tab==='groups'&&state.group&&!state.groupDetail)await selectGroup(state.group);else{renderTabs();renderSidebar();renderDetail();}return;}
 if(action==='filter'){event.preventDefault();state.filter=el.dataset.filter;renderSidebar();return;}
 if(action==='group'){event.preventDefault();await selectGroup(el.dataset.id);return;}
 if(action==='window'){event.preventDefault();await selectWindow(Number(el.dataset.version));return;}
 if(action==='back-group'){event.preventDefault();if(state.group)await selectGroup(state.group);return;}
 if(action==='image'){event.preventDefault();openModal(el.dataset.url,el.dataset.caption);return;}
 if(action==='close-modal'){closeModal();return;}
 if(action==='save-review'){event.preventDefault();await saveReview(el);return;}
});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'){closeModal();return;}
 if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
 if(state.tab==='groups'){
  const list=state.data.groups;let i=list.findIndex(g=>g.segmentId===state.group);
  i=Math.max(0,Math.min(list.length-1,i+(event.key==='ArrowRight'?1:-1)));selectGroup(list[i].segmentId);
 }else if(state.tab==='windows'||state.view==='window'){
  const list=state.data.windows;let i=list.findIndex(w=>w.version===state.selectedVersion);
  i=Math.max(0,Math.min(list.length-1,i+(event.key==='ArrowRight'?1:-1)));selectWindow(list[i].version);
 }
});

load().catch(error=>{$('#detail').innerHTML=`<p class="panel">${esc(String(error))}</p>`;});
