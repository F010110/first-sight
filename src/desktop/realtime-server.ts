import {createServer,type IncomingMessage} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {RealtimeSession} from '../hardware/realtime-session.js';
async function jsonBody(req:IncomingMessage){
 if(req.headers['content-type']!=='application/json')throw Error('Require application/json');let size=0;const chunks:Buffer[]=[];
 for await(const chunk of req){size+=chunk.length;if(size>5000)throw Error('Body too large');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString());
}
export function realtimeServer(root:string,port=8884,allowPaid=false,autoReceive=false){
 let current:RealtimeSession|null=null,starting:Promise<void>|null=null;const sessions:RealtimeSession[]=[];
 async function ensureReceiver(){if(current)return;if(starting)return starting;starting=(async()=>{const session=new RealtimeSession(root,false);await session.start();current=session;sessions.push(session);})();try{await starting;}finally{starting=null;}}
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  const reply=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  try{
   const actual=(server.address() as {port:number}|null)?.port??port,host=req.headers.host;
   if(![`127.0.0.1:${actual}`,`localhost:${actual}`].includes(host??''))return reply(403,{error:'Loopback host required'});
   if(req.headers.origin&&req.headers.origin!==`http://${host}`||req.method==='POST'&&req.headers.origin!==`http://${host}`)return reply(403,{error:'Same-origin required'});
   const url=new URL(req.url??'/',`http://${host}`);
   if(req.method==='GET'&&url.pathname==='/api/live/state'){if(autoReceive)await ensureReceiver();return reply(200,{available:true,allowPaid,session:current?.state()??null});}
   if(req.method==='POST'&&url.pathname==='/api/live/start'){
    const input=await jsonBody(req);if(Object.keys(input).length)throw Error('启动交互无需相机参数');
    if(!allowPaid)throw Error('服务未启用模型；请使用 npm run realtime 启动');
    if(!process.env.QWEN_API_KEY||!process.env.QWEN_BASE_URL)throw Error('Missing model configuration');
    await ensureReceiver();await current!.startInteraction();return reply(200,current!.state());
   }
   if(req.method==='POST'&&url.pathname==='/api/live/stop'){await jsonBody(req);await current?.stopInteraction();return reply(200,{interactionStopped:true,previewContinues:true});}
   if(req.method==='POST'&&url.pathname==='/api/live/question'){
    const input=await jsonBody(req);if(Object.keys(input).some(k=>k!=='text')||typeof input.text!=='string'||!current)throw Error('Question/session invalid');
    return reply(200,await current.ask(input.text));
   }
   if(req.method==='GET'&&url.pathname==='/api/live/image'){
    const image=current?.image(url.searchParams.get('id')??'');if(!image)return reply(404,{error:'Unknown frame'});
    const bytes=await readFile(image.path);if(createHash('sha256').update(bytes).digest('hex')!==image.sha256)throw Error('Original image changed');
    res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':bytes.length});res.end(bytes);return;
   }
   if(req.method==='GET'&&['/api/videos','/api/playback-timeline','/api/recordings'].includes(url.pathname))return reply(200,url.pathname==='/api/videos'?{episodes:[],memoryReady:false}:url.pathname==='/api/recordings'?[]:{questions:[],positions:[]});
   const files:Record<string,[string,string]>={'/':['index.html','text/html'],'/realtime.html':['realtime.html','text/html'],'/realtime.js':['realtime.js','text/javascript'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css'],'/view-model.js':['view-model.js','text/javascript'],'/comparison-view.js':['comparison-view.js','text/javascript']};
   files['/realtime.css']=['realtime.css','text/css'];
   files['/camera-orientation.css']=['camera-orientation.css','text/css'];
   const file=files[url.pathname];if(req.method!=='GET'||!file)return reply(404,{error:'Not found'});
   res.writeHead(200,{'Content-Type':file[1]+'; charset=utf-8'});res.end(await readFile(resolve('web/desktop',file[0])));
  }catch(error){if(!res.headersSent)reply(400,{error:String(error)});else res.destroy();}
 });
 return {server,async close(){await Promise.all(sessions.map(s=>s.close()));await new Promise<void>(r=>server.close(()=>r()));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const port=Number(process.env.FIRST_SIGHT_REALTIME_PORT??8884);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid realtime port');
 const root=resolve('run/realtime-system');await mkdir(root,{recursive:true});
 const app=realtimeServer(root,port,process.argv.includes('--allow-paid'),true);
 app.server.listen(port,'127.0.0.1',()=>console.log(`实时系统：http://127.0.0.1:${port}/realtime.html；自动网络预览，点击启动交互才调用模型。`));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void app.close().then(()=>process.exit(0)));
}
