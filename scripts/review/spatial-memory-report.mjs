/** Export saved spatial evidence only. Never imports a producer/provider or migrates SQLite. */
import {readFile,readdir,writeFile,mkdir,realpath,stat} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const json=async path=>JSON.parse(await readFile(path,'utf8'));
const optional=async(path,fallback)=>{try{return await json(path);}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
const inside=(root,path)=>{const rel=relative(root,path);if(rel.startsWith('..')||isAbsolute(rel))throw Error('Report source escapes its archive');return path;};
const parseContent=value=>{try{return JSON.parse(value);}catch{return value;}};

export async function buildSpatialMemoryReport(runArg){
 const run=await realpath(resolve(runArg)),dbPath=join(run,'spatial.sqlite'),before=createHash('sha256').update(await readFile(dbPath)).digest('hex');
 const manifest=await json(join(run,'manifest.json')),receipt=await json(join(run,'complete.json')),timing=await optional(join(run,'task-timing.json'),null);
 const db=new DatabaseSync(dbPath,{readOnly:true});let observations,states,places,visits,profiles,relations,revisions,skips,events,contexts;
 try{
  db.exec('BEGIN'); // One consistent read snapshot, never a producer connection.
  if(db.prepare('SELECT version FROM spatial_schema').get()?.version!==3)throw Error('Viewer expects schema-v3; it never migrates older runs');
  observations=db.prepare('SELECT seq,id,at_ms,raw,facts,error FROM observations ORDER BY seq').all().map(r=>({seq:r.seq,...JSON.parse(r.raw),facts:r.facts?JSON.parse(r.facts):null,error:r.error}));
  states=db.prepare('SELECT raw FROM states ORDER BY version').all().map(r=>JSON.parse(r.raw));
  contexts=new Map(db.prepare('SELECT version,raw FROM checkpoints ORDER BY version').all().map(r=>[r.version,JSON.parse(r.raw)]));
  places=db.prepare('SELECT * FROM places ORDER BY created_version').all();visits=db.prepare('SELECT * FROM visits ORDER BY start_version').all();
  profiles=db.prepare('SELECT place_id,version,key,raw FROM place_profile_revisions ORDER BY version,key').all().map(r=>({...r,raw:JSON.parse(r.raw)}));
  relations=db.prepare('SELECT version,raw FROM relation_assertions ORDER BY version').all().map(r=>({...r,raw:JSON.parse(r.raw)}));
  revisions=db.prepare('SELECT version,observation_id,raw FROM revisions ORDER BY version').all().map(r=>({...r,raw:JSON.parse(r.raw)}));
  skips=db.prepare('SELECT tail_id,at_ms,consumed_version,raw FROM skipped_windows ORDER BY at_ms').all().map(r=>({...r,raw:JSON.parse(r.raw)}));
  events=db.prepare('SELECT seq,at_ms,kind,raw FROM events ORDER BY seq').all().map(r=>({...r,raw:parseContent(r.raw)}));
  db.exec('COMMIT');
 }finally{db.close();}
 for(const row of observations)for(const view of row.views){
  if(!/^[a-f0-9]{64}$/.test(view.sha256))throw Error('Invalid archived image hash');
  const path=inside(run,await realpath(join(run,'originals',view.sha256+'.png'))),bytes=await readFile(path);
  if(createHash('sha256').update(bytes).digest('hex')!==view.sha256)throw Error('Archived image changed');
  view.src='../originals/'+view.sha256+'.png';delete view.path;
 }
 const requests=[];
 for(const lane of ['pi-requests','perception-requests']){
  let names;try{names=await readdir(join(run,lane));}catch(e){if(e.code!=='ENOENT')throw e;continue;}
  for(const name of names.filter(n=>/^\d+$/.test(n)).sort()){
   const folder=join(run,lane,name),input=await optional(join(folder,'input.json'),null);if(!input)continue;
   let response=null;try{const wire=await json(join(folder,'response.txt'));response={output:parseContent(wire.choices?.[0]?.message?.content),usage:wire.usage,finishReason:wire.choices?.[0]?.finish_reason};}catch(e){if(e.code!=='ENOENT')response={error:String(e)};}
   requests.push({lane,slot:name,requestedAtMs:(await stat(join(folder,'input.json'))).mtimeMs,input,response,timing:await optional(join(folder,'timing.json'),null),failure:await optional(join(folder,'failure.json'),null)});
  }
 }
 requests.sort((a,b)=>a.requestedAtMs-b.requestedAtMs);
 const metadata=await optional(join(run,'pi','session.json'),null),entries=[];
 if(metadata){
  const sessionPath=inside(await realpath(join(run,'pi','sessions')),await realpath(resolve(metadata.path)));
  for(const line of (await readFile(sessionPath,'utf8')).split('\n').filter(Boolean)){
   const records=JSON.parse(line);for(const record of Array.isArray(records)?records:[records])if(record.kind==='entry')entries.push(record);
  }
 }
 let checkpoints=[];try{checkpoints=(await readFile(join(run,'pi','pi-checkpoints.jsonl'),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(e){if(e.code!=='ENOENT')throw e;}
 const byEntry=new Map(entries.map(e=>[e.id,e]));
 const branch=tip=>{const path=[],seen=new Set();while(tip){if(seen.has(tip))throw Error('Cyclic saved session');seen.add(tip);const e=byEntry.get(tip);if(!e)throw Error('Checkpoint tip missing from saved session');path.push(e);tip=e.parentId;}return path.reverse();};
 const frames=[];let priorEntryIds=new Set(),previousAvailable=0;
 for(const state of states){
  const checkpoint=checkpoints.find(c=>c.version===state.version),session=checkpoint?branch(checkpoint.tipId):[];
  const sourceFacts=new Map();for(const s of states.filter(s=>s.version<=state.version)){
   for(const skipped of s.window?.skippedBefore??[])for(const o of skipped.observations)sourceFacts.set(o.id,{...o,spatiallyJudged:false});
   for(const o of s.window?.observations??[{id:s.observationId,atMs:s.atMs,facts:s.facts}])sourceFacts.set(o.id,{...o,spatiallyJudged:true});
  }
  const database={places:places.filter(p=>p.created_version<=state.version),visits:visits.filter(v=>v.start_version<=state.version),profiles:profiles.filter(p=>p.version<=state.version),states:states.filter(s=>s.version<=state.version),relations:relations.filter(r=>r.version<=state.version),revisions:revisions.filter(r=>r.version<=state.version),skips:skips.filter(s=>s.consumed_version!==null&&s.consumed_version<=state.version),boundObservations:[...sourceFacts.values()]};
  const previous=frames.at(-1)?.database;
  frames.push({version:state.version,state,checkpoint,structuredCheckpoint:contexts.get(state.version),session,newSessionEntries:session.filter(e=>!priorEntryIds.has(e.id)),requests:requests.filter(r=>r.lane==='pi-requests'&&r.requestedAtMs>previousAvailable&&r.requestedAtMs<=state.availableAtMs),database,delta:{observations:database.boundObservations.filter(o=>!previous?.boundObservations.some(p=>p.id===o.id)),places:database.places.filter(p=>p.created_version===state.version),visits:database.visits.filter(v=>v.start_version===state.version),profiles:database.profiles.filter(p=>p.version===state.version),skips:database.skips.filter(s=>s.consumed_version===state.version)}});
  priorEntryIds=new Set(session.map(e=>e.id));previousAvailable=state.availableAtMs;
 }
 const after=createHash('sha256').update(await readFile(dbPath)).digest('hex');if(before!==after)throw Error('Database changed during report export; wait until the run is finished');
 return {schema:'spatial-memory-visual-report-v1',runName:run.split(/[\\/]/).at(-1),readOnly:true,producerDatabaseSHA256:before,manifest,receipt,timing,observations,requests,frames,events,finalDatabase:{places,visits,profiles,states,relations,revisions,skips},unassignedRequests:requests.filter(r=>r.lane==='pi-requests'&&!frames.some(f=>f.requests.includes(r))),notes:['实际模型输入取自请求input.json，不是用SQLite快照重建。','提交后Context取自真实Pi检查点分支；结构化checkpoint不是完整Agent Context。','数据库版本页只显示已由该版本绑定的来源，不把最终数据库里迟到的事实反推为当时已知。','被跳过窗口只有独立事实，没有位置判断；其事实随后继版本绑定。','导出与浏览不调用模型，不修改生产数据库。']};
}

export function reportHtml(report,template){return template.replace('__MEMORY_DATA__',JSON.stringify(report).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));}
export async function writeSpatialMemoryReport(runArg){
 const report=await buildSpatialMemoryReport(runArg),out=join(resolve(runArg),'memory-review');await mkdir(out,{recursive:false});
 const template=await readFile(join(dirname(fileURLToPath(import.meta.url)),'spatial-memory-report.html'),'utf8');
 await writeFile(join(out,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});await writeFile(join(out,'index.html'),reportHtml(report,template),{flag:'wx'});
 return {out,versions:report.frames.length,observations:report.observations.length,profileRevisions:report.finalDatabase.profiles.length,databaseUnchanged:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(!process.argv[2])throw Error('Usage: spatial-memory-report RUN');console.log(JSON.stringify(await writeSpatialMemoryReport(process.argv[2])));}
