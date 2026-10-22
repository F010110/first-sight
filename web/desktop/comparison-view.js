/** Saved observation-time projection. Never select future results or equate UUIDs across methods. */
export function methodAtTime(method,episodeNumber,atMs){
 const past=method.events.filter(e=>e.episodeNumber===episodeNumber&&e.atMs<=atMs);
 const event=past.at(-1)??null;
 const visits=[];
 for(const e of past){const last=visits.at(-1);if(last&&last.placeId===e.placeId){last.endMs=e.atMs;}else visits.push({...e,endMs:e.atMs});}
 return {event,visits,knownPlaces:new Set(past.map(e=>e.placeId).filter(Boolean)).size};
}
export function createComparisonView(data,container){
 const cards=new Map();
 for(const method of data.methods){
  const card=document.createElement('article');card.className='method-card';card.dataset.method=method.id;
  const title=document.createElement('h3');title.textContent=method.label;
  const description=document.createElement('p');description.className='method-description';description.textContent=method.description;
  const name=document.createElement('strong');name.className='method-location';
  const meta=document.createElement('p');meta.className='method-meta';
  const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='区域定义与已访问序列';
  const definition=document.createElement('p');const sequence=document.createElement('ol');sequence.className='visit-sequence';details.append(summary,definition,sequence);
  const audit=document.createElement('details');const auditTitle=document.createElement('summary');auditTitle.textContent='整段运行信息（非准确率）';
  const receipt=document.createElement('p');receipt.textContent=`${method.summary.completed}/${method.summary.planned}观察 · ${method.summary.places}地点 · ${method.summary.unknown}待定 · ${method.summary.calls}请求 · 估算$${method.summary.estimatedUSD.toFixed(3)}。运行：${method.runId}`;audit.append(auditTitle,receipt);
  card.append(title,description,name,meta,details,audit);container.append(card);cards.set(method.id,{card,name,meta,definition,sequence,lastKey:''});
 }
 return {
  render(episodeNumber,atMs,selected='all'){
   let chosen=null;
   for(const method of data.methods){const ui=cards.get(method.id);ui.card.hidden=selected!=='all'&&selected!==method.id;
    const state=methodAtTime(method,episodeNumber,atMs),e=state.event;
    if(method.id===selected)chosen=e;
    const key=e?.observationId??'none';if(ui.lastKey===key)continue;ui.lastKey=key;
    ui.name.textContent=e?.name??'尚未有识别结果';ui.card.classList.toggle('unresolved',!!e&&!e.placeId);
    const seconds=e?(e.atMs-data.sample.sourceScheduleStartMs)/1000:null;
    ui.meta.textContent=e?`${e.placeKey??'无地点归属'} · 观察${seconds.toFixed(0)}秒 · 已访问${state.knownPlaces}个地点`:'等待当前时刻之前的已保存结果';
    ui.definition.textContent=e?.definition??(e?'此观察未确定地点；没有沿用上一地点。':'');
    ui.sequence.replaceChildren();for(const v of state.visits){const item=document.createElement('li');item.textContent=`${((v.atMs-data.sample.sourceScheduleStartMs)/1000).toFixed(0)}—${((v.endMs-data.sample.sourceScheduleStartMs)/1000).toFixed(0)}秒：${v.placeKey??'待定'} ${v.name}`;ui.sequence.append(item);}
   }
   container.classList.toggle('single-method',selected!=='all');return chosen;
  }
 };
}
