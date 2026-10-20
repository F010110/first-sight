import {createServer,type IncomingMessage} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {AssistantRuntime} from '../assistant/runtime.js';
import {FileJournal} from '../assistant/journal.js';
import {assistantCapabilities} from '../assistant/capabilities.js';
import {QwenPlanner} from '../assistant/qwen-planner.js';
import {SpatialCapability} from '../assistant/spatial-capability.js';

/** Parse JPEG dimensions, without trusting browser-provided MIME/dimensions. */
export function jpegSize(bytes:Buffer){
 if(bytes.length<12||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw Error('Require a complete JPEG');
 let offset=2;
 while(offset+4<bytes.length){
  if(bytes[offset++]!==255)throw Error('Malformed JPEG marker');
  while(bytes[offset]===255)offset++;
  const marker=bytes[offset++]!;
  if(marker===218||marker===217)break;
  if(marker===1||marker>=208&&marker<=215)continue;
  if(offset+2>bytes.length)break;
  const size=bytes.readUInt16BE(offset);if(size<2||offset+size>bytes.length)throw Error('Malformed JPEG segment');
  if([192,193,194].includes(marker)){
   if(size<8)throw Error('Invalid JPEG dimensions');
   const height=bytes.readUInt16BE(offset+3),width=bytes.readUInt16BE(offset+5);
   if(!width||!height||width>4096||height>4096||width*height>12000000)throw Error('JPEG dimensions exceed limit');
   return {width,height};
  }
  offset+=size;
 }
 throw Error('JPEG dimensions missing');
}
async function body(req:IncomingMessage){
 if(req.headers['content-type']!=='application/json')throw Error('Require application/json');
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>7000000)throw Error('Request body exceeds limit');chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString());
}
export function desktopServer(runtime:AssistantRuntime,journal:FileJournal,root:string,port:number){
 const web=resolve('web/desktop');
 const images=new Map<string,{path:string;id:string;direction:string}>();
 let importing=false;
 return createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  try{
   const host=req.headers.host;
   if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host??''))return json(403,{error:'Loopback host required'});
   if(req.headers.origin&&req.headers.origin!==`http://${host}`)return json(403,{error:'Cross-origin requests rejected'});
   const url=new URL(req.url??'/','http://'+host);
   if(req.method==='GET'&&url.pathname==='/api/state')return json(200,runtime.view());
   if(req.method==='GET'&&url.pathname==='/api/events'){
    // Audit remains a developer view, not a trusted semantic memory source.
    try{res.writeHead(200,{'Content-Type':'application/x-ndjson'});res.end(await readFile(join(root,'events.jsonl')));}catch{json(404,{error:'No audit yet'});}return;
   }
   if(req.method==='GET'&&url.pathname.startsWith('/image/')){
    const item=images.get(url.pathname.slice(7));if(!item)return json(404,{error:'Unknown image'});
    res.writeHead(200,{'Content-Type':'image/jpeg'});res.end(await readFile(item.path));return;
   }
   if(req.method==='POST'&&url.pathname==='/api/control'){
    const input=await body(req);if(typeof input.action!=='string'||input.value!==undefined&&typeof input.value!=='string')throw Error('Invalid control');
    await runtime.control(input.action,input.value);await journal.snapshot(runtime.view());return json(200,runtime.view());
   }
   if(req.method==='POST'&&url.pathname==='/api/messages'){
    const input=await body(req);if(typeof input.text!=='string'||input.capability!==undefined&&typeof input.capability!=='string')throw Error('Invalid message');
    const taskId=await runtime.submit(input.text,input.capability??'auto');return json(202,{taskId,state:runtime.view()});
   }
   if(req.method==='POST'&&url.pathname==='/api/observations'){
    if(importing)throw Error('Another import is in progress');importing=true;
    try{
     if(runtime.view().capture!=='recording')throw Error('请先开始观察。');
     const input=await body(req);
     if(!Array.isArray(input.views)||input.views.length<1||input.views.length>3)throw Error('Require 1..3 actual JPEG views');
     const directions=['front','left','right'],used=new Set<string>(),hashes=new Set<string>();
     const decoded:Array<{direction:string;bytes:Buffer;sha256:string;width:number;height:number}>=[];
     for(const view of input.views){
      if(!view||!directions.includes(view.direction)||used.has(view.direction)||typeof view.base64!=='string'||view.base64.length>2100000||view.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(view.base64))throw Error('Invalid/duplicate view');
      const bytes=Buffer.from(view.base64,'base64');if(bytes.length>1500000)throw Error('Each JPEG must be <=1.5MB');
      const dimensions=jpegSize(bytes),sha256=createHash('sha256').update(bytes).digest('hex');
      if(hashes.has(sha256))throw Error('不要复制同一图片冒充不同视图。');
      used.add(view.direction);hashes.add(sha256);decoded.push({direction:view.direction,bytes,sha256,...dimensions});
     }
     decoded.sort((a,b)=>directions.indexOf(a.direction)-directions.indexOf(b.direction));
     const id=randomUUID(),directory=join(root,'originals',id);await mkdir(directory,{recursive:true});
     const receipts=[];
     for(const view of decoded){
      const path=join(directory,view.direction+'.jpg');await writeFile(path,view.bytes,{flag:'wx'});
      receipts.push({direction:view.direction,path,sha256:view.sha256,width:view.width,height:view.height});
     }
     const atMs=Date.now();
     await journal.append('original-image-receipt',{id,atMs,source:'manual-import',captureTimeKnown:false,synchronizedViewsVerified:false,validation:'JPEG headers/dimensions checked; not full pixel decode',views:receipts});
     await runtime.observe({id,atMs,recordingId:runtime.view().sessionId,sourceAtMs:atMs,frames:receipts.map(v=>v.path)});
     for(const view of receipts){const key=id+'-'+view.direction;images.set(key,{path:view.path,id,direction:view.direction});}
     await journal.snapshot(runtime.view());
     return json(202,{id,atMs,images:receipts.map(v=>({direction:v.direction,url:'/image/'+id+'-'+v.direction})),state:runtime.view()});
    }finally{importing=false;}
   }
   const files:Record<string,{name:string;type:string}>={'/':{name:'index.html',type:'text/html; charset=utf-8'},'/app.js':{name:'app.js',type:'text/javascript; charset=utf-8'},'/style.css':{name:'style.css',type:'text/css; charset=utf-8'}};
   const file=files[url.pathname];if(req.method==='GET'&&file){res.writeHead(200,{'Content-Type':file.type});res.end(await readFile(join(web,file.name)));return;}
   json(404,{error:'Not found'});
  }catch(error){if(!res.headersSent)json(400,{error:String(error).replace(/^Error: /,'')});else res.end();}
 });
}

async function main(){
 const enabled=process.argv.includes('--confirm-paid');
 if(process.argv.slice(2).some(a=>a!=='--confirm-paid'))throw Error('Only --confirm-paid is supported');
 if(enabled&&(!process.env.QWEN_API_KEY||!process.env.QWEN_BASE_URL))throw Error('Missing Qwen configuration');
 const port=Number(process.env.FIRST_SIGHT_DESKTOP_PORT??8880);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid desktop port');
 const root=resolve('run/assistant-desktop',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(root,{recursive:true});
 const journal=new FileJournal(root),memory=await SpatialCapability.create(join(root,'spatial'),enabled);
 const runtime=new AssistantRuntime(new QwenPlanner(join(root,'dialogue-requests'),enabled),memory,journal,assistantCapabilities(memory,enabled),enabled);
 await journal.append('session-created',{state:runtime.view(),root,restartPolicy:'New session, no automatic Context restore',modelEnabled:enabled,spatialBudgetUSD:1,dialogueMaxCalls:64});
 const server=desktopServer(runtime,journal,root,port);
 server.listen(port,'127.0.0.1',()=>console.log(`First Sight 桌面助手：http://127.0.0.1:${port}\n模型：${enabled?'已授权付费（对话64请求上限；空间256请求／估算USD1上限）':'未启用；不生成假回答'}\n本地记录：${root}`));
 const shutdown=()=>{server.close();void runtime.close().then(()=>journal.snapshot(runtime.view())).then(()=>process.exit(0));};
 process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
