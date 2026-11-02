'use strict';
const $=id=>document.getElementById(id);
let state,index=0,epoch=0;
const cache=new Map();
async function show(next){
 const selected=Math.max(0,Math.min(state.sample.frames.length-1,next)),ticket=++epoch;
 const id=state.sample.frames[selected].id;
 index=selected;$('seek').value=index;
 $('position').textContent=`${index+1} / ${state.sample.frames.length}`;
 $('prev').disabled=index===0;$('next').disabled=index===state.sample.frames.length-1;
 const frame=state.sample.frames[selected];
 $('images').replaceChildren(...['front','left','right'].map((direction,i)=>{const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');image.src=frame.views[direction];image.alt=['前摄','左摄','右摄'][i];caption.textContent=image.alt;figure.append(image,caption);return figure;}));
 for(const field of ['location','reference-details','model-location','description'])$(field).textContent='载入中…';
 $('reference-scope').textContent='';
 try{
  if(!cache.has(id)){const response=await fetch('/api/memory?id='+encodeURIComponent(id));if(!response.ok)throw Error('无法读取记忆状态');cache.set(id,await response.json());}
  if(ticket!==epoch)return;
  const item=cache.get(id),annotation=item.reference?.annotation,update=item.candidate?.update;
  // Position annotations are not a model-produced localization judgment.
   $('location').textContent=annotation?.description||'暂无地点标注';
   $('reference-details').textContent=annotation?.referenceAnnotation?.description||'暂无额外细节标注';
   if(annotation?.referenceAnnotation?.scope)$('reference-scope').textContent='细节来自人工查看的邻近关键帧，不保证当前帧中所有物体均可见。';
   // This replay stores descriptions, not a separate final localization output.
   // Never substitute oracle labels or judge opinions for the agent's decision.
   $('model-location').textContent='未输出独立的最终位置判断';
  $('description').textContent=update?.summary||update?.observations?.join('\n')||'模型未输出地点描述';
 }catch(error){if(ticket===epoch){$('location').textContent='读取失败';$('description').textContent=error.message;}}
}
$('prev').onclick=()=>show(index-1);$('next').onclick=()=>show(index+1);
$('seek').oninput=()=>show(Number($('seek').value));
(async()=>{const response=await fetch('/api/sample');if(!response.ok)throw Error('无法读取观察列表');state=await response.json();if(!state.sample?.provenance?.memoryEvaluation)throw Error('此数据包未附带空间记忆');$('seek').max=state.sample.frames.length-1;await show(0);})().catch(error=>{$('location').textContent='读取失败';$('description').textContent=error.message;});
