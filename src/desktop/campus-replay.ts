import type {IncomingMessage,ServerResponse} from 'node:http';
import {readFile,stat,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {loadSpatialMethodComparison} from './spatial-method-comparison.js';

/** Legacy saved campus results, same port, read-only. No runtime/provider created. */
export async function campusReplay(req:IncomingMessage,res:ServerResponse,url:URL){
 const routes=['/api/videos','/api/playback-timeline','/api/method-comparison','/api/recordings'];
 if(req.method!=='GET'||!routes.includes(url.pathname)&&!url.pathname.startsWith('/video/'))return false;
 const reply=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
 const videoRoot=resolve(process.env.FIRST_SIGHT_CAMPUS_VIDEO??'run/spatial-preview-video/campus-episode6-first64s-v1');
 if(url.pathname==='/api/recordings'){reply(200,[]);return true;}
 const comparisonPath=resolve(process.env.FIRST_SIGHT_COMPARISON_MANIFEST??'run/spatial-method-comparison/three-methods-v1.json');
 if(url.pathname==='/api/method-comparison'||url.pathname==='/api/playback-timeline'){
  let comparison;try{comparison=await loadSpatialMethodComparison(comparisonPath);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(url.pathname==='/api/method-comparison')reply(comparison?200:404,comparison??{error:'No saved comparison configured'});
  else reply(200,{questions:[],positions:[],dataset:'saved-campus-comparison'});
  return true;
 }
 let manifest;try{manifest=JSON.parse(await readFile(join(videoRoot,'complete.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;reply(url.pathname==='/api/videos'?200:404,url.pathname==='/api/videos'?{episodes:[],memoryReady:false}:{error:'Video unavailable'});return true;}
 if(url.pathname==='/api/videos'){reply(200,{fps:manifest.fps,memoryReady:false,episodes:manifest.episodes.map((e:any)=>({...e,src:'/video/'+e.src}))});return true;}
 const name=url.pathname.slice(7);
 if(!/^episode-\d+\.mp4$/.test(name)||!manifest.episodes.some((e:any)=>e.src===name)){reply(404,{error:'Unknown saved video'});return true;}
 const base=await realpath(videoRoot),path=await realpath(join(base,name)),rel=relative(base,path);
 if(rel.startsWith('..')||isAbsolute(rel))throw Error('Video outside archive');
 const size=(await stat(path)).size;res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Type','video/mp4');
 const range=req.headers.range;
 if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range),start=match?Number(match[1]):-1,end=match?.[2]?Math.min(Number(match[2]),size-1):size-1;
  if(!match||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return true;}
  res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});createReadStream(path,{start,end}).on('error',()=>res.destroy()).pipe(res);return true;
 }
 res.writeHead(200,{'Content-Length':size});createReadStream(path).on('error',()=>res.destroy()).pipe(res);return true;
}
