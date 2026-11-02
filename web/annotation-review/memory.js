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
 $('location').textContent='载入中…';$('description').textContent='载入中…';
 try{
  if(!cache.has(id)){const response=await fetch('/api/memory?id='+encodeURIComponent(id));if(!response.ok)throw Error('无法读取记忆状态');cache.set(id,await response.json());}
  if(ticket!==epoch)return;
  const item=cache.get(id),annotation=item.reference?.annotation,update=item.candidate?.update;
  // Position annotations are not a model-produced localization judgment.
  $('location').textContent=annotation?.description||'暂无地点标注';
  $('description').textContent=update?.summary||update?.observations?.join('\n')||'模型未输出地点描述';
 }catch(error){if(ticket===epoch){$('location').textContent='读取失败';$('description').textContent=error.message;}}
}
$('prev').onclick=()=>show(index-1);$('next').onclick=()=>show(index+1);
$('seek').oninput=()=>show(Number($('seek').value));
(async()=>{const response=await fetch('/api/sample');if(!response.ok)throw Error('无法读取观察列表');state=await response.json();if(!state.sample?.provenance?.memoryEvaluation)throw Error('此数据包未附带空间记忆');$('seek').max=state.sample.frames.length-1;await show(0);})().catch(error=>{$('location').textContent='读取失败';$('description').textContent=error.message;});
