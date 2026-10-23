import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {readdir,readFile} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
export function recordingPath(root:string,id:string){if(!/^[a-f0-9-]{36}(?:~[0-9]+)?$/.test(id))throw Error('Invalid recording ID');return join(root,id.split('~')[0]!);}
function recordingSpans(directory:string){
 const spans:{start:number;end:number}[]=[];let active=false,manual=false;
 let text='';try{text=readFileSync(join(directory,'live-events.jsonl'),'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 for(const line of text.split('\n').filter(Boolean)){
  const event=JSON.parse(line),v=event.value;let next:boolean=active;
  if(v.kind==='recording'){manual=v.manual;next=v.effective;}
  else if(v.kind==='interaction-started'){next=true;}
  else if(v.kind==='interaction-paused'){next=manual;}
  else if(v.kind==='session-stopped')next=false;
  if(next&&!active)spans.push({start:event.atMs,end:Infinity});
  if(!next&&active)spans.at(-1)!.end=event.atMs;
  active=next;
 }
 return spans;
}
export function readRecording(root:string,id:string){
 const directory=recordingPath(root,id),db=new DatabaseSync(join(directory,'memory.sqlite'),{readOnly:true});
 try{
  let visibleAfterMs=-Infinity;try{const filter=JSON.parse(readFileSync(join(root,'replay-visibility.json'),'utf8'));if(!Number.isFinite(filter.visibleAfterMs))throw Error('Invalid replay visibility');visibleAfterMs=filter.visibleAfterMs;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const rows=(db.prepare('SELECT o.raw,j.raw AS judgment,j.available_ms FROM originals o LEFT JOIN judgments j ON j.id=o.id ORDER BY o.at_ms').all() as {raw:string;judgment:string|null;available_ms:number|null}[]).map(r=>({original:JSON.parse(r.raw),judgment:r.judgment?JSON.parse(r.judgment):null,availableAtMs:r.available_ms}));
  const questions=(db.prepare('SELECT raw FROM questions').all() as {raw:string}[]).map(r=>JSON.parse(r.raw)).sort((a,b)=>a.atMs-b.atMs);
   const start=id.includes('~')?Number(id.split('~')[1]):null;
   const span=start===null?null:recordingSpans(directory).find(s=>s.start===start);
   if(start!==null&&!span)throw Error('Unknown recording segment');
   const visible=(at:number)=>at>visibleAfterMs&&(!span||(at>=span.start&&at<span.end));
   return {id,rows:rows.filter(r=>visible(r.original.atMs)),questions:questions.filter(q=>visible(q.atMs)),startedAtMs:span?.start,stoppedAtMs:span&&Number.isFinite(span.end)?span.end:null};
 }finally{db.close();}
}
export async function listRecordings(root:string){
 const result=[];for(const entry of await readdir(root,{withFileTypes:true})){if(!entry.isDirectory()||!/^[a-f0-9-]{36}$/.test(entry.name))continue;
   try{const spans=recordingSpans(join(root,entry.name));for(const id of spans.length?spans.map(s=>entry.name+'~'+s.start):[entry.name]){const recording=readRecording(root,id);if(!recording.rows.length)continue;result.push({id,frames:recording.rows.length,startMs:recording.rows[0]!.original.atMs,endMs:recording.rows.at(-1)!.original.atMs,questions:recording.questions.length,startedAtMs:recording.startedAtMs,stoppedAtMs:recording.stoppedAtMs});}}catch{/* Not a supported, initialized recording DB. */}
 }return result.sort((a,b)=>b.startMs-a.startMs);
}
export async function recordingImage(root:string,id:string,sourceId:string){
 const recording=readRecording(root,id),row=recording.rows.find(r=>r.original.id===sourceId);if(!row)throw Error('Unknown recorded image');
 const path=resolve(row.original.jpegPath),rel=relative(resolve(recordingPath(root,id),'capture','frames'),path);
 if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Image outside recording');
 return {bytes:await readFile(path),sha256:row.original.jpegSha256};
}
