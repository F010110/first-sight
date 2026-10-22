import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {cameraObservation} from './camera-input.js';
import {LiveFramePolicy} from './live-frame-policy.js';
import {RealtimeMemory,type LiveOriginal} from './realtime-memory.js';
import {RealtimeMethod2} from './realtime-method2.js';
import {spatialJsonVlm} from '../agent/spatial-json-vlm.js';
import {answerRealtimeQuestion} from './realtime-question.js';
function prepare(python:string,row:LiveOriginal,path:string):Promise<LiveOriginal>{return new Promise((resolve,reject)=>{
 const child=spawn(python,['cam/prepare_live_image.py'],{stdio:['pipe','pipe','pipe']});let output='',error='';
 const timer=setTimeout(()=>{child.kill();reject(Error('Image preparation timed out'));},10000);
 child.stdout!.on('data',c=>{output+=c;if(output.length>20000){child.kill();reject(Error('Image metadata too large'));}});child.stderr!.on('data',c=>{error=(error+c).slice(-1000);});
 child.on('error',reject);child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error('Image preparation failed: '+error));try{const value=JSON.parse(output);resolve({...row,pngPath:value.path,pngSha256:value.sha256,features:value.features});}catch(e){reject(e);}});
 child.stdin!.end(JSON.stringify({source:row.jpegPath,destination:path,sha256:row.jpegSha256}));
});}
/** One bounded real-camera session; acquisition, modeling and question lanes are independent. */
export class RealtimeSession{
 readonly id=randomUUID();readonly root:string;readonly captureRoot:string;
 private memory!:RealtimeMemory;private capture:ChildProcess|null=null;private gate=new LiveFramePolicy<LiveOriginal>();
 private method!:RealtimeMethod2;private questionRequest!:ReturnType<typeof spatialJsonVlm>;
 private originals:LiveOriginal[]=[];private consumed=0;private timer:ReturnType<typeof setInterval>|null=null;
 private reading=false;private working=false;private questionBusy=false;private running=false;private closed=false;private captureEnded=false;
 private modelError:string|null=null;private inputError:string|null=null;private lastModeled=-Infinity;private latestResult:any=null;
 private questions:any[]=[];private journalTail:string[]=[];
 private disposed=false;
 constructor(parent:string,readonly paid:boolean,private python=resolve('cam/.venv/Scripts/python.exe')){this.root=join(parent,this.id);this.captureRoot=join(this.root,'capture');}
 async start(){
  await mkdir(this.root,{recursive:false});this.memory=new RealtimeMemory(join(this.root,'memory.sqlite'));
  this.method=new RealtimeMethod2(spatialJsonVlm(join(this.root,'spatial-requests'),256,.5));this.questionRequest=spatialJsonVlm(join(this.root,'question-requests'),64,.25);
  await writeFile(join(this.root,'plan.json'),JSON.stringify({schema:'realtime-system-v1',sessionId:this.id,paid:this.paid,budget:{spatialUSD:.5,questionUSD:.25},method:'method2-single-view/recent2-visual2-sequence6/no-graph',source:'real-camera',views:['front'],missingViews:['left','right'],maxFrames:60,intervalMs:2000,freshnessMs:2500,queueCapacity:1,originals:'JPEG kept; PNG preserves decoded pixels, never duplicated views',httpRiskAcceptedByUser:true},null,2));
  this.running=true;
  this.capture=spawn(this.python,['-X','utf8','cam/portal_stream.py',this.captureRoot,'--count','60','--interval','2','--keep-alive','--jpeg-quality','16','--confirm-http-credentials'],{stdio:['ignore','pipe','pipe']});
  this.capture.stdout!.on('data',chunk=>{this.journalTail.push(...String(chunk).trim().split('\n'));this.journalTail=this.journalTail.slice(-8);});
  this.capture.stderr!.on('data',()=>{this.inputError='采集异常；查看本地stopped记录，未自动重试账号。';});
  this.capture.on('error',e=>{this.inputError=e.message;this.captureEnded=true;});
  this.capture.on('close',code=>{this.captureEnded=true;if(code!==0&&!this.closed)this.inputError='采集已中断，保留原图与失败记录。';void this.tick();});
  this.timer=setInterval(()=>void this.tick(),200);this.timer.unref();
 }
 private async audit(value:unknown){await appendFile(join(this.root,'live-events.jsonl'),JSON.stringify({atMs:Date.now(),value})+'\n');}
 private async tick(){
  if(this.reading||this.closed)return;this.reading=true;
  try{
   let text='';try{text=await readFile(join(this.captureRoot,'observations.jsonl'),'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   const lines=text.slice(0,text.lastIndexOf('\n')+1).split('\n').filter(Boolean);
   if(lines.length<this.consumed||lines.length>60)throw Error('Capture receipt sequence truncated or too long');
   for(;this.consumed<lines.length;this.consumed++){
    const raw=JSON.parse(lines[this.consumed]!);if(raw.sequence!==this.consumed)throw Error('Capture sequence mismatch');
    const observation=await cameraObservation(raw,this.captureRoot);
    if(!Number.isFinite(raw.requestWallTimeMs)||raw.requestWallTimeMs>Date.now()+1000)throw Error('Capture wall clock invalid');
    const row:LiveOriginal={id:observation.id,atMs:raw.requestWallTimeMs,requestWallTimeMs:raw.requestWallTimeMs,receivedAtMs:raw.requestWallTimeMs+raw.receivedAtMs-raw.atMs,jpegPath:observation.frames[0]!,jpegSha256:raw.sha256};
    this.memory.archive(row);this.originals.push(row);
    const ready=await prepare(this.python,row,join(this.root,'model-originals',String(this.consumed)+'.png'));
    this.memory.prepared(ready);this.originals[this.originals.length-1]=ready;
    const superseded=this.gate.offer(ready);await this.audit({kind:'input',id:row.id,superseded,originalRetained:true});
   }
   if(this.paid&&!this.working&&!this.modelError&&this.running)void this.work();
  }catch(error){this.inputError=String(error);this.running=false;this.capture?.kill();await this.audit({kind:'input-failed',error:String(error)});}
  finally{this.reading=false;}
 }
 private async work(){
  const decision=this.gate.take(Date.now());if(!decision.frame){if(decision.reason!=='no-pending-frame')await this.audit(decision);return;}
  this.working=true;const row=decision.frame;
  try{
   for(const missed of this.originals.filter(r=>r.atMs>this.lastModeled&&r.atMs<row.atMs))this.method.interrupt(missed);
   const result=await this.method.observe(row);const availableAtMs=Date.now();
   // Commit causal historical judgment even if slow. Publication is separately gated.
   this.memory.commit(row.id,result,availableAtMs);this.lastModeled=row.atMs;this.latestResult={id:row.id,atMs:row.atMs,availableAtMs,result};
   await this.audit({kind:'spatial-committed',id:row.id,placeId:result.placeId,currentEligible:this.running&&!this.captureEnded&&this.gate.mayPublishCurrent(row,Date.now())});
  }catch(error){this.modelError=String(error);await this.audit({kind:'spatial-failed',id:row.id,error:this.modelError});}
  finally{this.working=false;}
 }
 state(){
  const latest=this.originals.at(-1),health=this.gate.status(Date.now());
  const fresh=this.running&&!this.captureEnded&&health.state==='fresh-input';
  const recognized=!this.modelError&&fresh&&latest?.id===this.latestResult?.id&&this.gate.mayPublishCurrent(latest!,Date.now());
  const group=this.latestResult?.result.groups.find((g:any)=>g.id===this.latestResult.result.placeId);
  return {sessionId:this.id,running:this.running&&!this.captureEnded,settling:this.working||this.questionBusy||this.reading,paid:this.paid,processing:this.working,questionBusy:this.questionBusy,inputError:this.inputError,modelError:this.modelError,
   inputState:fresh?'fresh-input':'current-state-unconfirmed',ageMs:health.ageMs,frames:this.originals.length,missingViews:['left','right'],
   latest:latest?{id:latest.id,atMs:latest.atMs,url:'/api/live/image?id='+encodeURIComponent(latest.id)}:null,
   currentLocation:recognized?(group?.scope.name??'地点待定'):null,
   historicalLocation:this.latestResult?{atMs:this.latestResult.atMs,name:group?.scope.name??'地点待定',availableAtMs:this.latestResult.availableAtMs}:null,
   places:this.method.snapshot().map(g=>({id:g.id,name:g.scope.name,definition:g.scope.definition,members:g.members.length})),questions:this.questions,
   budget:{spatialUSD:.5,questionUSD:.25},captureLimit:60};
 }
 image(id:string){const row=this.originals.find(r=>r.id===id);return row?{path:row.jpegPath,sha256:row.jpegSha256}:null;}
 async ask(text:string){
  if(!this.paid)throw Error('请先显式启用预算内模型会话');if(this.questionBusy)throw Error('上一问题尚未完成');
  if(!text.trim()||text.length>2000)throw Error('问题长度无效');if(!this.originals.length)throw Error('尚未收到相机原图');
  this.questionBusy=true;const id=randomUUID(),asOfMs=Date.now(),snapshot=this.memory.snapshot(asOfMs),entry:any={id,question:text,atMs:asOfMs,status:'answering'};this.questions.push(entry);
  try{const result=await answerRealtimeQuestion(snapshot,text,this.questionRequest,this.running&&!this.captureEnded);Object.assign(entry,{status:'answered',answer:result.text,sourceIds:result.sourceIds,abstained:result.abstained,answeredAtMs:Date.now(),asOfMs,frameAtMs:snapshot.rows.at(-1)?.original.atMs,note:'基于提问时已记录画面／记忆，不保证回答送达时仍是当前情况'});}
  catch(error){Object.assign(entry,{status:'failed',answer:'本次回答失败：'+String(error),answeredAtMs:Date.now()});}
  finally{this.memory.question(id,entry);this.questionBusy=false;}
  return structuredClone(entry);
 }
 async stop(){this.running=false;this.closed=true;this.capture?.kill();if(this.timer)clearInterval(this.timer);await this.audit({kind:'session-stopped',inflightHistoricalOnly:this.working,note:'Device radio auto-expires at its 180s bound'});}
 async close(){if(this.disposed)return;await this.stop();while(this.working||this.questionBusy||this.reading)await new Promise(r=>setTimeout(r,100));this.memory.close();this.disposed=true;}
}
