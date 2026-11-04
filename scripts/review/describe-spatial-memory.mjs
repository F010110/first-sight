/** Text-only inspection of the normalized memory library; no producer/model imports. */
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

export async function describeSpatialMemory(runArg){
 const run=resolve(runArg),path=join(run,'spatial.sqlite'),hash=async()=>createHash('sha256').update(await readFile(path)).digest('hex'),before=await hash();
 const db=new DatabaseSync(path,{readOnly:true});let places,skipped,receipts,revisionCount;
 try{
  db.exec('BEGIN');if(db.prepare('SELECT version FROM spatial_schema').get()?.version!==4)throw Error('Expected schema-v4; no database migration is allowed');
  places=db.prepare('SELECT * FROM places ORDER BY created_version,id').all().map(place=>{
   const visits=db.prepare('SELECT * FROM visits WHERE place_id=? ORDER BY start_version,id').all(place.id).map(visit=>({id:visit.id,startVersion:visit.start_version,
    windows:db.prepare('SELECT s.raw FROM place_records r JOIN states s ON s.version=r.version WHERE r.place_id=? AND r.visit_id=? ORDER BY r.at_ms,r.version').all(place.id,visit.id).map(r=>JSON.parse(r.raw))}));
   const notes=db.prepare('SELECT id,text,created_version FROM place_notes WHERE place_id=? ORDER BY created_version,id').all(place.id).map(note=>({...note,sources:db.prepare('SELECT version,source_id FROM place_note_sources WHERE note_id=? ORDER BY version,source_id').all(note.id)}));
    const nameRevisions=db.prepare("SELECT version,raw FROM place_profile_revisions WHERE place_id=? AND key='__place_name' ORDER BY version").all(place.id).map(r=>({version:r.version,...JSON.parse(r.raw)}));
    return {id:place.id,name:nameRevisions.at(-1)?.value??place.name,originalName:place.name,nameRevisions,createdVersion:place.created_version,visits,notes};
  });
  skipped=db.prepare('SELECT raw,consumed_version FROM skipped_windows ORDER BY at_ms').all().map(r=>({window:JSON.parse(r.raw),deliveredAtVersion:r.consumed_version}));
  receipts=db.prepare('SELECT raw FROM states ORDER BY version').all().map(r=>JSON.parse(r.raw).memoryReceipt);
  revisionCount=db.prepare('SELECT COUNT(*) AS n FROM revisions').get().n;db.exec('COMMIT');
 }finally{db.close();}
 const complete=JSON.parse(await readFile(join(run,'complete.json'),'utf8')),calls=[];
 for(const name of (await readdir(join(run,'pi-requests'))).filter(n=>/^\d+$/.test(n)).sort()){
  const dir=join(run,'pi-requests',name);try{const input=JSON.parse(await readFile(join(dir,'input.json'),'utf8')),response=JSON.parse(await readFile(join(dir,'response.txt'),'utf8')),timing=JSON.parse(await readFile(join(dir,'timing.json'),'utf8'));let output;try{output=JSON.parse(response.choices?.[0]?.message?.content);}catch{output={unparsed:response.choices?.[0]?.message?.content};}calls.push({slot:name,observationId:input.data.current.id,role:input.data.role,messageCount:input.data.messages?.length??0,totalMs:timing.totalMs,output});}catch(error){if(error.code!=='ENOENT')throw error;calls.push({slot:name,incompleteArtifacts:true});}
 }
 if(await hash()!==before)throw Error('Source database changed while reading');
 const result={schema:'spatial-memory-text-report-v1',readOnly:true,databaseSHA256:before,organization:'place-visits-windows-sources-v1',membershipProjection:'original-version-membership',revisionCount,complete,places,skipped,receipts,calls};
 const lines=['# 空间记忆库：程序自动组织的实际内容','',`- 输入 ${complete.observations}/${complete.planned}；空间判断 ${complete.spatialStates}；跳过窗口 ${complete.skippedWindows}；总耗时 ${(complete.elapsedMs/1000).toFixed(3)}秒。`,`- Context策略：${complete.contextPolicy}，本轮没有修改其实现或压缩配置。`,`- 这里展示原始提交归属；历史归属修订 ${revisionCount} 条。指定版本的有效修订投影由 memory_place 提供。`,''];
 for(const place of places){lines.push(`## 地点：${place.name}`,`ID：${place.id}`,'','### Agent添加的地点内容');if(!place.notes.length)lines.push('- 无：本轮未写笔记。');for(const note of place.notes)lines.push(`- ${note.text}（v${note.created_version}建立；来源 ${note.sources.map(s=>s.source_id+'@v'+s.version).join('、')}）`);for(const [i,visit] of place.visits.entries()){lines.push('',`### 访问${i+1}：${visit.id}`);for(const state of visit.windows){lines.push('',`#### v${state.version} / ${state.observationId}`,`- 判断：${state.locationDecision??state.assessment.location.status}；${state.assessment.location.reason}`,`- add实际回执：${JSON.stringify(state.memoryReceipt)}`);for(const o of state.window?.observations??[{id:state.observationId,facts:state.facts}])lines.push(`- ${o.id}：${o.facts?.summary??'事实缺失'}；${o.facts?.details.join('；')??''}`);}}}
 lines.push('','## 跳过窗口（没有自动归入任何地点）');if(!skipped.length)lines.push('- 无。');for(const s of skipped)lines.push(`- ${s.window.observations.map(o=>o.id).join('、')}；事实交付版本 ${s.deliveredAtVersion??'尚未交付'}。`);
 lines.push('','## 模型调用');for(const c of calls)lines.push(`- ${c.slot} ${c.observationId??''}：${c.output?.tool??c.role??'不完整'}，${c.messageCount??0}条输入消息，${((c.totalMs??0)/1000).toFixed(3)}秒，输出notes ${c.output?.arguments?.notes?.length??0}条。`);
 return {result,markdown:lines.join('\n')+'\n'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const run=process.argv[2];if(!run)throw Error('Usage: describe-spatial-memory RUN');const {result,markdown}=await describeSpatialMemory(run);await writeFile(join(run,'memory-summary.json'),JSON.stringify(result,null,2),{flag:'wx'});await writeFile(join(run,'memory-summary.md'),markdown,{flag:'wx'});console.log(JSON.stringify({places:result.places.length,visits:result.places.reduce((n,p)=>n+p.visits.length,0),notes:result.places.reduce((n,p)=>n+p.notes.length,0),readOnly:true,databaseSHA256:result.databaseSHA256}));}
