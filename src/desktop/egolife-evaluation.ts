/** Local, read-only HUMAN diagnostics. This handler is never an Agent tool. */
import {readFile,readdir,realpath} from 'node:fs/promises';
import {join,resolve,dirname,basename,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {realVideoReplay,readRealVideo} from './real-video-replay.js';
import {egoLifeTime} from '../evaluation/egolife-first-sight-adapter.js';
import type {NativeReplayInput} from '../evaluation/run-egolife-native.js';

export interface EgoLifeViewerConfig {
 inputRoot:string;baselineRoot:string;goldSource:string;
 runs:Array<{id:string;title:string;root:string}>;
}
const defaults=():EgoLifeViewerConfig=>({inputRoot:resolve('run/egolife-native-rgb-input-v1'),baselineRoot:resolve('run/egolife-native-rgb-results-v1'),goldSource:resolve('datasets/realism-source-survey-20261024-v2/EgoLife/EgoLifeQA/EgoLifeQA_A1_JAKE.json'),runs:[{id:'baseline',title:'原生基线',root:resolve('run/egolife-native-rgb-results-v1')},{id:'v2',title:'自主检索修复v2',root:resolve('run/egolife-native-agentic-qa-v2')},{id:'v3',title:'证据闭环v3',root:resolve('run/egolife-native-agentic-qa-v3')}]});
async function jsonFile(path:string,max=32000000){const raw=await readFile(path);if(raw.length>max)throw Error('Diagnostic file too large');return JSON.parse(raw.toString());}
const imageURL=(id:string)=>'/api/evaluation/egolife/frame?id='+encodeURIComponent(id);
const safeId=(id:string)=>/^[a-zA-Z0-9_-]{1,100}$/.test(id);

export function egoLifeEvaluation(config=defaults()){
 let inputPromise:Promise<NativeReplayInput>|null=null;
 const input=()=>inputPromise??=jsonFile(join(config.baselineRoot,'public-input.json')) as Promise<NativeReplayInput>;
 const runFor=(id:string)=>{const run=config.runs.find(r=>r.id===id);if(!run)throw Error('Unknown evaluation run');return run;};
 const frameInfo=(data:NativeReplayInput,id:string)=>{const row=data.originals.find(r=>r.id===id);if(!row)throw Error('Unknown evaluation frame');return {id:row.id,atMs:row.atMs,url:imageURL(row.id)};};
 return async(req:IncomingMessage,res:ServerResponse,url:URL)=>{
  if(!url.pathname.startsWith('/api/evaluation/egolife'))return false;
  if(req.method!=='GET'){res.writeHead(405,{'Allow':'GET'});res.end();return true;}
  const send=(value:unknown)=>{res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  if(url.pathname==='/api/evaluation/egolife/media'){
   const mapped=new URL('/api/replay/real-video-media',url);mapped.searchParams.set('id',basename(config.inputRoot));mapped.searchParams.set('clip',url.searchParams.get('clip')??'');
   return realVideoReplay(req,res,mapped,dirname(config.inputRoot));
  }
  const data=await input();
  if(url.pathname==='/api/evaluation/egolife'){
   const video=await readRealVideo(dirname(config.inputRoot),basename(config.inputRoot));
   const runs=[];
   for(const run of config.runs){try{const summary=await jsonFile(join(run.root,'summary.json'));let usage=null;try{usage=await jsonFile(join(run.root,'requests/usage.json'));}catch{/* Optional receipts, not fabricated cost. */}runs.push({id:run.id,title:run.title,summary,usage});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
   let offset=0;
   send({title:video.title,scope:video.scope,readOnly:true,modelCallsOnView:0,sourceFirstMs:data.source.firstMs,sourceLastQuestionMs:data.source.lastMs,durationMs:video.durationMs,frames:data.originals.length,tasks:data.tasks,runs,clips:video.clips.map((c:any,index:number)=>{const startMs=offset;offset+=c.durationMs;return {startMs,durationMs:c.durationMs,url:'/api/evaluation/egolife/media?clip='+index};})});return true;
  }
  if(url.pathname==='/api/evaluation/egolife/frame'){
   const id=url.searchParams.get('id')??'';if(!safeId(id))throw Error('Invalid frame ID');
   const row=data.originals.find(r=>r.id===id);if(!row?.pngPath)throw Error('Unknown frame');
   const base=await realpath(join(config.inputRoot,'png')),path=await realpath(row.pngPath),rel=relative(base,path);
   if(rel.startsWith('..')||isAbsolute(rel))throw Error('Frame outside prepared input');
   const bytes=await readFile(path);if(createHash('sha256').update(bytes).digest('hex')!==row.pngSha256)throw Error('Prepared original changed');
   res.writeHead(200,{'Content-Type':'image/png','Content-Length':bytes.length});res.end(bytes);return true;
  }
  const id=url.searchParams.get('id')??'',task=data.tasks.find(t=>t.ID===id);if(!task)throw Error('Unknown official task');
  if(url.pathname==='/api/evaluation/egolife/gold'){
   const rows=await jsonFile(config.goldSource),gold=rows.find((r:any)=>String(r.ID)===id);if(!gold)throw Error('Missing official annotation');
   let targetMs:number|null=null;try{targetMs=egoLifeTime(String(gold.target_time.date).toUpperCase(),gold.target_time.time).cutoffMs;}catch{/* Some official annotations contain ranges, not an instant. */}
   const nearest=targetMs===null?null:[...data.originals].sort((a,b)=>Math.abs(a.atMs-targetMs!)-Math.abs(b.atMs-targetMs!))[0];
   send({diagnosticOnly:true,notAgentInput:true,ID:id,answer:gold.answer,reason:gold.reason,questionChinese:gold.question_chinese,needAudio:gold.need_audio,needName:gold.need_name,targetTime:gold.target_time,targetMs,nearestFrame:nearest?frameInfo(data,nearest.id):null,note:'标注时刻附近的帧不保证独自包含完整证据；仅用于人工诊断。'});return true;
  }
  if(url.pathname==='/api/evaluation/egolife/task'){
   const run=runFor(url.searchParams.get('run')??'v2');
   const results=await jsonFile(join(run.root,'results.json')),result=results.find((r:any)=>r.ID===id);if(!result)throw Error('Task not finished in selected run');
   let trace:any[];
   try{trace=await jsonFile(join(run.root,'qa-trace-audit.json'));}
   catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    trace=[];
    for(const dir of (await readdir(join(run.root,'requests'))).filter(s=>/^\d{4,6}$/.test(s)).sort()){
     const request=await jsonFile(join(run.root,'requests',dir,'input.json'));if(!request.data?.question)continue;
     const response=await jsonFile(join(run.root,'requests',dir,'response.txt'));let action:unknown;
     try{action=JSON.parse(response.choices[0].message.content);}catch{action={kind:'invalid-output'};}
     trace.push({directory:dir,question:request.data.question.split('Question: ')[1]?.split('\n')[0],action,feedback:request.data.feedback,imageIds:request.images.map((i:any)=>i.id),operation:request.data.operation??null});
    }
   }
   const steps=[];
   for(const row of trace.filter(r=>r.question===task.question)){
    if(!/^\d{4,6}$/.test(row.directory))throw Error('Invalid trace receipt');
    const request=await jsonFile(join(run.root,'requests',row.directory,'input.json'));
    steps.push({receipt:row.directory,action:row.action,feedback:row.feedback??null,toolResult:request.data?.toolResult??null,operation:request.data?.operation??null,images:(row.imageIds??[]).map((frameId:string)=>frameInfo(data,frameId))});
   }
   send({task,result:{status:result.status,response:result.response,text:result.rawFirstSightAnswer?.text??result.error??'',evidenceReview:result.rawFirstSightAnswer?.evidenceReview??null},citedFrames:(result.rawFirstSightAnswer?.sourceIds??[]).map((frameId:string)=>frameInfo(data,frameId)),steps,note:'每步图片是该次请求实际交付的图像，不是动作执行后尚未交付的候选。此接口不返回gold。'});return true;
  }
  res.writeHead(404);res.end();return true;
 };
}
