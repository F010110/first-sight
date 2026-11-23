import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {egoLifeEvaluation,type EgoLifeViewerConfig} from './egolife-evaluation.js';

/** Separate loopback-only viewer: no capture, mutation or model endpoints at all. */
export function egoLifeViewerServer(config?:EgoLifeViewerConfig){
 const evaluation=egoLifeEvaluation(config);
 const assets:Record<string,[string,string]>={'/egolife.html':['egolife.html','text/html'],'/egolife.js':['egolife.js','text/javascript'],'/egolife.css':['egolife.css','text/css'],'/style.css':['style.css','text/css']};
 return createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self'; media-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const port=(res.socket?.localPort??0),host=req.headers.host;
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host??'')||req.headers.origin&&req.headers.origin!==`http://${host}`){res.writeHead(403);res.end();return;}
  if(req.method!=='GET'){res.writeHead(405,{'Allow':'GET'});res.end();return;}
  try{
   const url=new URL(req.url??'/',`http://${host}`);
   if(url.pathname==='/'||url.pathname==='/recordings.html'){res.writeHead(302,{Location:'/egolife.html'});res.end();return;}
   if(await evaluation(req,res,url))return;
   const file=assets[url.pathname];if(!file){res.writeHead(404);res.end();return;}
   const bytes=await readFile(resolve('web/desktop',file[0]));res.writeHead(200,{'Content-Type':file[1]+'; charset=utf-8'});res.end(bytes);
  }catch{if(!res.headersSent){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Evaluation artifact unavailable, invalid or changed'}));}else res.destroy();}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const port=Number(process.env.FIRST_SIGHT_EGOLIFE_VIEWER_PORT??8886);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid viewer port');
 const server=egoLifeViewerServer();server.listen(port,'127.0.0.1',()=>console.log(`EgoLife只读评测：http://127.0.0.1:${port}/egolife.html · 无模型调用，不影响8884`));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
}
