import {createServer,type IncomingMessage} from 'node:http';
import {mkdir,readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {AssistantRuntime} from '../assistant/runtime.js';
import {FileJournal} from '../assistant/journal.js';
import {assistantCapabilities} from '../assistant/capabilities.js';
import {QwenPlanner} from '../assistant/qwen-planner.js';
import {CampusSource} from '../assistant/campus-source.js';
import {PreparedMemory} from '../assistant/prepared-memory.js';
import {QuestionAgent,QuestionMemoryService} from '../assistant/question-agent.js';
import type {ObservationService} from '../assistant/contracts.js';
import {latestQuestionTimeline} from '../assistant/playback-timeline.js';

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
export function desktopServer(runtime:AssistantRuntime,journal:FileJournal,root:string,port:number,preparedMemoryReady=false,positions:Array<{atMs:number;episodeNumber:number;name:string}>=[]){
 const web=resolve('web/desktop');
 const images=new Map<string,{path:string;id:string;direction:string;mime?:string;sha256?:string}>();
 let importing=false;
 const episode=resolve(process.env.FIRST_SIGHT_SIM_EPISODE??'run/sim/hardware-vga-nominal160-v2');
 let replayRunning=false,replayBusy=false,replayIndex=0,replayError:string|null=null;
 let replayImages:Array<{direction:string;url:string}>=[];
 let frameNames:string[]=[];
 let campus:CampusSource|null=null,inputKind:'optics'|'campus'|null=null;
 const videoRoot=resolve(process.env.FIRST_SIGHT_CAMPUS_VIDEO??'run/campus-continuous-native10-v1');
 const videoManifest=async()=>{try{return JSON.parse(await readFile(join(videoRoot,'complete.json'),'utf8'));}catch{try{return JSON.parse(await readFile(join(videoRoot,'progress.json'),'utf8'));}catch{return {episodes:[],fps:10};}}};
 let sceneSource:CampusSource|null=null,lastSceneId='',lastSceneSchedule=-Infinity;
 let campusOriginHost=0,pauseAt=0;
 const replayState=()=>({running:replayRunning,index:replayIndex,total:campus?.length??frameNames.length,error:replayError,images:replayImages,source:campus?'campus-original-timeline':'simulator-recording',intervalMs:2000,loop:false,nextFrameInMs:campus&&replayIndex<campus.length?Math.max(0,campus.time(replayIndex)-campus.time(0)-(Date.now()-campusOriginHost)):null,note:campus?'原校园三视图PNG；保留源时间差和记录空缺，画面输入不等待VLM。':'光学小样本回放，繁忙时等待；非真实性能测试。'});
 const tick=async()=>{
  await runtime.expireWatches();
  if(!replayRunning||replayBusy)return;
  if(runtime.view().capture!=='recording'){pauseAt=Date.now();replayRunning=false;return;}
  // Backpressure, not unbounded frame accumulation or silent skipping.
  if(!campus&&runtime.view().processing)return;
  if(campus&&Date.now()-campusOriginHost<campus.time(replayIndex)-campus.time(0))return;
  replayBusy=true;
  try{
   if(campus){
    const row=await campus.read(replayIndex),id=row.id,directory=join(root,'originals',randomUUID());await mkdir(directory,{recursive:true});
    const views=[];
    for(const view of row.views){const path=join(directory,view.direction+'.png');await writeFile(path,view.bytes,{flag:'wx'});views.push({direction:view.direction,path,sha256:view.sha256,mime:view.mime});}
    const atMs=campusOriginHost+row.atMs-campus.time(0);
    await journal.append('campus-frame',{id,atMs,sourceObservationId:row.id,sourceAtMs:row.sourceAtMs,scheduleAtMs:row.atMs,episodeNumber:row.episodeNumber,manifestSha256:campus.manifestSha256,views});
    if(!replayRunning||runtime.view().capture!=='recording')return;
    await runtime.observe({id,atMs,sourceAtMs:row.sourceAtMs,recordingId:runtime.view().sessionId,frames:views.map(v=>v.path)},'simulator-replay');
    replayImages=views.map(v=>{const key=id+'-'+v.direction;images.set(key,{path:v.path,id,direction:v.direction,mime:v.mime});return {direction:v.direction,url:'/image/'+key};});
    replayIndex++;if(replayIndex>=campus.length)replayRunning=false;
    return;
   }
   const name=frameNames[replayIndex];if(!name){replayRunning=false;return;}
   const id=randomUUID(),directory=join(root,'originals',id);await mkdir(directory,{recursive:true});
   const views=[];
   for(const [direction,folder] of [['front','frames'],['left','left'],['right','right']]){
    let bytes:Buffer;
    try{bytes=await readFile(join(episode,folder!,name));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&direction!=='front')continue;throw error;}
    const dimensions=jpegSize(bytes),path=join(directory,direction+'.jpg');await writeFile(path,bytes,{flag:'wx'});
    views.push({direction:direction!,path,sha256:createHash('sha256').update(bytes).digest('hex'),...dimensions});
   }
   const atMs=Date.now();
   await journal.append('simulator-frame',{id,atMs,sourceEpisode:episode,sourceFrame:name,sourceIndex:replayIndex,clock:'host-replay-time-not-exposure',views});
   if(!replayRunning||runtime.view().capture!=='recording')return;
   await runtime.observe({id,atMs,recordingId:runtime.view().sessionId,sourceAtMs:atMs,frames:views.map(v=>v.path)},'simulator-replay');
   replayImages=views.map(v=>{const key=id+'-'+v.direction;images.set(key,{path:v.path,id,direction:v.direction});return {direction:v.direction,url:'/image/'+key};});
   replayIndex++;if(replayIndex>=frameNames.length)replayRunning=false;
  }catch(error){replayError=String(error);replayRunning=false;await journal.append('replay-failed',{error:String(error)});}finally{replayBusy=false;}
 };
 const timer=setInterval(()=>void tick(),2000);timer.unref();
 const server=createServer(async(req,res)=>{
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
   if(req.method==='GET'&&url.pathname==='/api/playback-timeline')return json(200,{...await latestQuestionTimeline(resolve('run/campus-assistant-pilot')),positions});
   if(req.method==='GET'&&url.pathname==='/api/videos'){
    const manifest=await videoManifest();return json(200,{fps:manifest.fps,memoryReady:preparedMemoryReady,episodes:manifest.episodes.map((episode:Record<string,unknown>)=>({...episode,src:'/video/'+episode.src}))});
   }
   if(req.method==='GET'&&url.pathname.startsWith('/video/')){
    const name=url.pathname.slice(7),manifest=await videoManifest();
    if(!/^episode-\d+\.mp4$/.test(name)||!manifest.episodes.some((episode:{src:string})=>episode.src===name))return json(404,{error:'Video not ready'});
    const path=join(videoRoot,name),size=(await stat(path)).size;
    res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Type','video/mp4');
    const range=req.headers.range;
    if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}
     const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),size-1):size-1;if(start>=size||end<start){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}
     res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});createReadStream(path,{start,end}).on('error',()=>res.destroy()).pipe(res);return;
    }
    res.writeHead(200,{'Content-Length':size});createReadStream(path).on('error',()=>res.destroy()).pipe(res);return;
   }
   if(req.method==='POST'&&url.pathname==='/api/scene'){
    if(!preparedMemoryReady)throw Error('独立空间记忆尚未准备好；视频可看，问答需等待建模完成后重启服务。');
    const input=await body(req);if(!Number.isInteger(input.episodeNumber)||!Number.isFinite(input.sourceSeconds)||input.sourceSeconds<0)throw Error('Invalid scene time');
    sceneSource??=await CampusSource.load(resolve(process.env.FIRST_SIGHT_CAMPUS_REPLAY??'run/inspect-repair-full90-v1/model-replay/observations.jsonl'));
    const row=await sceneSource.read(sceneSource.indexAt(input.episodeNumber,input.sourceSeconds*1000));
    if(row.atMs<lastSceneSchedule){await runtime.control('conversation.reset');lastSceneId='';}
    if(row.id!==lastSceneId||input.force===true){
     await runtime.control('capture.start');
     await runtime.observe({id:row.id,atMs:Math.max(Date.now(),(runtime.view().latestObservation?.atMs??0)+1),sourceAtMs:row.sourceAtMs,recordingId:runtime.view().sessionId,frames:row.views.map(view=>view.path)},'simulator-replay');lastSceneId=row.id;lastSceneSchedule=row.atMs;
     await journal.append('question-scene-selected',{id:row.id,scheduleAtMs:row.atMs,episodeNumber:row.episodeNumber,sourceAtMs:row.sourceAtMs,displayTimeSeconds:input.sourceSeconds});
    }
    return json(200,{id:row.id,sourceAtMs:row.sourceAtMs,spatialModelCalls:0});
   }
   if(req.method==='GET'&&url.pathname==='/api/recordings'){
    const runsRoot=resolve('run/campus-assistant-pilot');let entries:string[]=[];
    try{entries=await readdir(runsRoot);}catch{}
    const completed=[];
    for(const name of entries.filter(n=>/^[\w.-]+$/.test(n)).sort().reverse())try{const report=JSON.parse(await readFile(join(runsRoot,name,'report.json'),'utf8'));completed.push({id:name,completedScript:report.completedScript,grade:report.grade});}catch{}
    return json(200,completed);
   }
   if(req.method==='GET'&&url.pathname==='/api/recording'){
    const name=url.searchParams.get('run')??'';if(!/^[\w.-]+$/.test(name)||name==='.'||name==='..')throw Error('Invalid recorded run');
    const directory=resolve('run/campus-assistant-pilot',name);
    const report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
    const events=(await readFile(join(directory,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    const timeline=[];
    for(const event of events){
     if(!['campus-frame','task-created','message-delivered','vlm-language','watch-created','watch-check','watch-notified','watch-failed','watch-expired','control','task-settled'].includes(event.kind))continue;
     if(event.kind==='campus-frame'){
      const frame=event.value;
      const views=frame.views.map((v:{path:string;direction:string;sha256:string})=>{const key='recorded-'+name+'-'+frame.id+'-'+v.direction;images.set(key,{path:v.path,id:frame.id,direction:v.direction,mime:'image/png',sha256:v.sha256});return {direction:v.direction,url:'/image/'+key};});
      timeline.push({atMs:event.atMs,kind:event.kind,value:{id:frame.id,sourceAtMs:frame.sourceAtMs,scheduleAtMs:frame.scheduleAtMs,episodeNumber:frame.episodeNumber,views}});
     }else timeline.push(event);
    }
    return json(200,{id:name,report,timeline,note:'已完成运行的原始交付顺序回放；不会重新调用模型。含失败，不保证语义正确。'});
   }
   if(req.method==='GET'&&url.pathname==='/api/simulator')return json(200,replayState());
   if(req.method==='GET'&&url.pathname==='/api/vlm'){
    let rows:unknown[]=[];try{rows=(await readFile(join(root,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(e=>e.kind==='vlm-language').slice(-20);}catch{}
    return json(200,rows);
   }
   if(req.method==='POST'&&url.pathname==='/api/simulator'){
    const input=await body(req);
    if(input.action==='start'){
     if(importing||replayBusy)throw Error('图像输入正在处理，请稍后重试');
     const kind=input.source==='campus'?'campus':'optics';
     if(inputKind&&inputKind!==kind)throw Error('不能在同一会话混换轨迹，请新建服务会话');
     if(replayRunning)return json(200,replayState());
     if(kind==='campus'){
      campus??=await CampusSource.load(resolve(process.env.FIRST_SIGHT_CAMPUS_REPLAY??'run/inspect-repair-full90-v1/model-replay/observations.jsonl'));
      if(replayIndex>=campus.length)throw Error('校园轨迹已结束，请新建会话');
      if(!campusOriginHost)campusOriginHost=Date.now();else if(pauseAt)campusOriginHost+=Date.now()-pauseAt;
      pauseAt=0;inputKind='campus';await runtime.control('capture.start');replayError=null;replayRunning=true;void tick();return json(200,replayState());
     }
     frameNames=(await readdir(join(episode,'frames'))).filter(n=>/^\d+\.jpg$/.test(n)).sort();
     if(!frameNames.length)throw Error('No simulator frames');
     if(replayIndex>=frameNames.length)throw Error('本轨迹播放完毕，请重启服务创建新会话，避免重复轨迹伪造连续记忆。');
     inputKind='optics';await runtime.control('capture.start');replayError=null;replayRunning=true;void tick();
    }else if(input.action==='pause'){if(replayRunning)pauseAt=Date.now();replayRunning=false;await runtime.control('capture.pause');}
    else throw Error('Invalid simulator action');
    return json(200,replayState());
   }
   if(req.method==='GET'&&url.pathname==='/api/events'){
    // Audit remains a developer view, not a trusted semantic memory source.
    try{res.writeHead(200,{'Content-Type':'application/x-ndjson'});res.end(await readFile(join(root,'events.jsonl')));}catch{json(404,{error:'No audit yet'});}return;
   }
   if(req.method==='GET'&&url.pathname.startsWith('/image/')){
    const item=images.get(url.pathname.slice(7));if(!item)return json(404,{error:'Unknown image'});
    const bytes=await readFile(item.path);if(item.sha256&&createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Recorded image hash mismatch');
    res.writeHead(200,{'Content-Type':item.mime??'image/jpeg'});res.end(bytes);return;
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
    if(replayRunning||replayBusy)throw Error('请先暂停模拟回放再导入图片');
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
   files['/recording.js']={name:'recording.js',type:'text/javascript; charset=utf-8'};
   files['/view-model.js']={name:'view-model.js',type:'text/javascript; charset=utf-8'};
   files['/comparison-view.js']={name:'comparison-view.js',type:'text/javascript; charset=utf-8'};
   const file=files[url.pathname];if(req.method==='GET'&&file){res.writeHead(200,{'Content-Type':file.type});res.end(await readFile(join(web,file.name)));return;}
   json(404,{error:'Not found'});
  }catch(error){if(!res.headersSent)json(400,{error:String(error).replace(/^Error: /,'')});else res.end();}
 });
 server.once('close',()=>clearInterval(timer));
 return server;
}

async function main(){
 const enabled=process.argv.includes('--confirm-paid');
 if(process.argv.slice(2).some(a=>a!=='--confirm-paid'))throw Error('Only --confirm-paid is supported');
 if(enabled&&(!process.env.QWEN_API_KEY||!process.env.QWEN_BASE_URL))throw Error('Missing Qwen configuration');
 const port=Number(process.env.FIRST_SIGHT_DESKTOP_PORT??8880);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid desktop port');
 const root=resolve('run/assistant-desktop',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(root,{recursive:true});
 const journal=new FileJournal(root);
 let preparedRoot=process.env.FIRST_SIGHT_PREPARED_MEMORY;
 if(!preparedRoot){try{for(const name of (await readdir(resolve('run/campus-spatial-memory'))).sort().reverse()){const candidate=resolve('run/campus-spatial-memory',name);try{await readFile(join(candidate,'complete.json'));preparedRoot=candidate;break;}catch{}}}catch{}}
 const prepared=preparedRoot?await PreparedMemory.open(resolve(preparedRoot)):null;
 const unavailable=()=>{throw Error('请先运行独立空间建模，完成后重启服务；问答不会自动重新建模。');};
 const memory:ObservationService=prepared?new QuestionMemoryService(prepared,new QuestionAgent(prepared,join(root,'question-requests'),enabled)):{async observe(){unavailable();},async question(){return unavailable();},discardPending(){},close(){}};
 const capabilities=assistantCapabilities(memory,enabled).map(capability=>!prepared&&['visual.current','memory.query','task.watch','task.find'].includes(capability.id)?{...capability,available:false,reason:'独立空间记忆尚未准备好，问答不触发空间建模。'}:capability);
 const runtime=new AssistantRuntime(new QwenPlanner(join(root,'dialogue-requests'),enabled),memory,journal,capabilities,enabled);
 await journal.append('session-created',{state:runtime.view(),root,preparedRoot:preparedRoot??null,modelEnabled:enabled,spatialModelCalls:0,questionBudgetUSD:.25,dialogueMaxCalls:64});
 const server=desktopServer(runtime,journal,root,port,!!prepared,prepared?.positionTimeline()??[]);
 server.listen(port,'127.0.0.1',()=>console.log(`First Sight 桌面助手：http://127.0.0.1:${port}\n模型：${enabled?'仅问答模型已授权；本进程不运行空间建模':'未启用；可看连续视频和已有回放'}\n独立空间记忆：${preparedRoot??'尚未准备好'}\n本地记录：${root}`));
 const shutdown=()=>{server.close();void runtime.close().then(()=>journal.snapshot(runtime.view())).then(()=>process.exit(0));};
 process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
