import {readFile,readdir,realpath,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createHash} from 'node:crypto';

const validId=(id:string)=>/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id);
const verified=new Map<string,string>();
export async function readRealVideo(root:string,id:string){
 if(!validId(id))throw Error('Invalid real video id');
 const base=await realpath(root),folder=await realpath(join(base,id)),rel=relative(base,folder);
 if(rel.startsWith('..')||isAbsolute(rel))throw Error('Video outside archive');
 const m=JSON.parse(await readFile(join(folder,'manifest.json'),'utf8'));
 if(m.schema!=='original-real-video-v1'||typeof m.title!=='string'||typeof m.scope!=='string'||m.cameraCount!==1||!Array.isArray(m.clips)||!m.clips.length||m.clips.length>1000)throw Error('Invalid real video manifest');
 let total=0;
 for(const c of m.clips){
  if(typeof c.file!=='string'||!/^clips\/\d{4}\.mp4$/.test(c.file)||!Number.isSafeInteger(c.durationMs)||c.durationMs<=0||!Number.isSafeInteger(c.bytes)||c.bytes<=0||!/^[a-f0-9]{64}$/.test(c.sha256))throw Error('Invalid video clip');
  total+=c.durationMs;
 }
 if(total!==m.durationMs)throw Error('Video duration mismatch');
 return {id,title:m.title,scope:m.scope,source:m.source,durationMs:total,cameraCount:1,clips:m.clips,folder,previewRecommended:m.previewRecommended===true};
}
export async function listRealVideos(root:string){
 let names;try{names=await readdir(root,{withFileTypes:true});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
 const rows=[];
 for(const name of names){if(!name.isDirectory()||!validId(name.name))continue;
  try{const v=await readRealVideo(root,name.name);rows.push({id:v.id,title:v.title,durationMs:v.durationMs,cameraCount:v.cameraCount,kind:'original-video',previewRecommended:v.previewRecommended});}catch{/* Failed/partial downloads remain private, not ready replays. */}
 }
 return rows.sort((a,b)=>Number(b.previewRecommended)-Number(a.previewRecommended)||a.id.localeCompare(b.id));
}
export async function realVideoReplay(req:IncomingMessage,res:ServerResponse,url:URL,root=resolve(process.env.FIRST_SIGHT_REAL_VIDEO_ROOT??'datasets/long-real-videos-v1')){
 if(req.method!=='GET'||!['/api/replay/real-videos','/api/replay/real-video','/api/replay/real-video-media'].includes(url.pathname))return false;
 const json=(data:unknown)=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
 if(url.pathname==='/api/replay/real-videos'){json({recordings:await listRealVideos(root)});return true;}
 const v=await readRealVideo(root,url.searchParams.get('id')??'');
 if(url.pathname==='/api/replay/real-video'){
  let at=0;json({id:v.id,title:v.title,scope:v.scope,source:v.source,durationMs:v.durationMs,cameraCount:1,kind:'original-video',questions:[],clips:v.clips.map((c:any,index:number)=>{const startMs=at;at+=c.durationMs;return {startMs,durationMs:c.durationMs,url:`/api/replay/real-video-media?id=${encodeURIComponent(v.id)}&clip=${index}`};})});return true;
 }
 const raw=url.searchParams.get('clip')??'';if(!/^\d{1,4}$/.test(raw))throw Error('Invalid clip index');
 const clip=v.clips[Number(raw)];if(!clip)throw Error('Unknown video clip');
 const path=await realpath(join(v.folder,clip.file)),rel=relative(v.folder,path);
 if(rel.startsWith('..')||isAbsolute(rel))throw Error('Clip outside archive');
 const info=await stat(path),size=info.size;if(size!==clip.bytes)throw Error('Video original size changed');
 const binding=`${info.size}:${info.mtimeMs}:${info.ctimeMs}:${clip.sha256}`;
 if(verified.get(path)!==binding){
  const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);
  if(hash.digest('hex')!==clip.sha256)throw Error('Video original hash changed');
  if(verified.size>=1000)verified.clear();verified.set(path,binding);
 }
 res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');
 let start=0,end=size-1,status=200;
 if(req.headers.range){
  const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);start=m?Number(m[1]):-1;end=m?.[2]?Math.min(Number(m[2]),size-1):size-1;
  if(!m||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return true;}
  status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);
 }
 res.writeHead(status,{'Content-Length':end-start+1});createReadStream(path,{start,end}).on('error',()=>res.destroy()).pipe(res);return true;
}
