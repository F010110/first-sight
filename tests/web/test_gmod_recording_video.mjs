// Read-only integration test of the existing 8884 player using installed headless Chrome.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const output='run/gmod-motion-review-v1/browser';
await mkdir(output,{recursive:true});
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>['SYSTEMROOT','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA'].includes(key.toUpperCase())));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
  '--user-data-dir=C:/Users/helele/AppData/Local/Temp/opencode/gmod-video-review-browser-v1',
  '--autoplay-policy=no-user-gesture-required','--window-size=1400,1000',
  'http://127.0.0.1:8884/recordings.html?source=simulation&recording=campus-video:7'
],{env,stdio:['ignore','ignore','pipe']});
let ws;
try{
 const endpoint=await new Promise((resolve,reject)=>{
  let text='';const timeout=setTimeout(()=>reject(Error('Chrome startup timeout')),15000);
  chrome.stderr.on('data',chunk=>{text+=chunk;const match=text.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timeout);resolve(Number(match[1]));}});
  chrome.on('error',reject);
 });
 const pages=await (await fetch(`http://127.0.0.1:${endpoint}/json/list`)).json();
 const page=pages.find(p=>p.type==='page'&&p.url.includes('recordings.html'));assert.ok(page);
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 let id=0;const pending=new Map();ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const pair=pending.get(message.id);if(pair){pending.delete(message.id);message.error?pair.reject(Error(JSON.stringify(message.error))):pair.resolve(message.result);}}};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const current=++id;pending.set(current,{resolve,reject});ws.send(JSON.stringify({id:current,method,params}));});
 const result=await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
  const wait=async(fn)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('player readiness timeout');};
  await wait(()=>document.getElementById('recording-select')&&document.getElementById('real-video'));
  const select=document.getElementById('recording-select'),video=document.getElementById('real-video');
  await wait(()=>select.value==='campus-video:7'&&video.readyState>=1);
  const title=select.selectedOptions[0].textContent,scope=document.getElementById('sample-scope').textContent;
  const duration=video.duration;
  await video.play();await new Promise(r=>setTimeout(r,800));const advanced=video.currentTime;video.pause();
  video.currentTime=25;await wait(()=>!video.seeking&&Math.abs(video.currentTime-25)<.3);
  const views=[];
  for(const episode of [8,9,10]){select.value='campus-video:'+episode;select.dispatchEvent(new Event('change'));await wait(()=>video.currentSrc.includes('episode-'+String(episode).padStart(2,'0')+'.mp4')&&video.readyState>=1);views.push({episode,width:video.videoWidth,height:video.videoHeight,duration:video.duration});}
  select.value='campus-video:7';select.dispatchEvent(new Event('change'));await wait(()=>video.currentSrc.includes('episode-07.mp4')&&video.readyState>=2);
  video.currentTime=15;await wait(()=>!video.seeking);
  return {title,scope,duration,advanced,views,source:document.getElementById('replay-source').value};
 })()`});
 if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
 const value=result.result.value;assert.match(value.title,/Garry/);assert.match(value.scope,/非生活任务/);assert.ok(value.advanced>0);assert.ok(value.duration>59&&value.duration<62);assert.equal(value.views.length,3);assert.ok(value.views.every(v=>v.width===640&&v.height===480));
 const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(output+'/player.png',Buffer.from(shot.data,'base64'));
 await writeFile(output+'/result.json',JSON.stringify({passed:true,...value,modelCalls:0},null,2));console.log(JSON.stringify(value,null,2));
 await call('Browser.close');
}finally{ws?.close();chrome.kill();}
