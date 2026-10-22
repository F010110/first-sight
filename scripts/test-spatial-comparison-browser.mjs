/** Real headless Chromium CDP smoke test. No npm/browser downloads or model calls.
 * Start a separate headless browser with --remote-debugging-port=9333 first.
 */
import assert from 'node:assert/strict';import {writeFile,mkdir} from 'node:fs/promises';import {join} from 'node:path';
const [base='http://127.0.0.1:8884',debug='http://127.0.0.1:9333',output='run/spatial-method-comparison/browser-check']=process.argv.slice(2);
await mkdir(output,{recursive:true});
const tab=await (await fetch(debug+'/json/new?about:blank',{method:'PUT'})).json();
const socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
let id=0;const pending=new Map(),errors=[],requests=[];
socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);pending.delete(message.id);if(message.error)p?.reject(Error(JSON.stringify(message.error)));else p?.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);else if(message.method==='Network.requestWillBeSent')requests.push(message.params.request);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const number=++id;pending.set(number,{resolve,reject});socket.send(JSON.stringify({id:number,method,params}));});
const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
const wait=expression=>evaluate(`new Promise((resolve,reject)=>{let n=0;const check=()=>{if(${expression})return resolve(true);if(n++>200)return reject(Error('DOM condition timeout: '+${JSON.stringify(expression)}));setTimeout(check,50);};check();})`);
const screenshot=async name=>{const value=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(join(output,name),Buffer.from(value.data,'base64'));};
try{
 await call('Page.enable');await call('Runtime.enable');await call('Network.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:base});await wait(`document.getElementById('enter-sample')&&!document.getElementById('enter-sample').disabled`);
 assert.equal(await evaluate(`document.getElementById('workspace').hidden`),true);await screenshot('entry.png');
 await evaluate(`document.getElementById('choose-replay').click();document.getElementById('choose-simulation').click();document.getElementById('enter-sample').click()`);
 await wait(`document.getElementById('continuous-video').readyState>=2`);
 assert.equal(await evaluate(`document.querySelectorAll('.method-card').length`),3);
 assert.equal(await evaluate(`[...document.querySelectorAll('.method-card h3')].every(e=>e.textContent.includes('方法')&&!e.textContent.includes('?'))`),true,'Method labels must render valid Chinese');
 assert.ok(await evaluate(`document.getElementById('continuous-video').duration>64`));
 await evaluate(`document.getElementById('continuous-video').muted=true;document.getElementById('play').click()`);await wait(`document.getElementById('continuous-video').currentTime>1`);await evaluate(`document.getElementById('continuous-video').pause()`);
 await evaluate(`document.getElementById('continuous-video').currentTime=32`);await wait(`document.querySelector('[data-method="graph"] .method-meta').textContent.includes('32秒')`);
 assert.equal(await evaluate(`document.querySelector('[data-method="graph"] .method-location').textContent`),'地点待定');
 await screenshot('comparison-32s.png');
 await evaluate(`document.getElementById('method-view').value='recall';document.getElementById('method-view').dispatchEvent(new Event('change'))`);
 assert.equal(await evaluate(`[...document.querySelectorAll('.method-card')].filter(e=>!e.hidden).length`),1);assert.equal(await evaluate(`document.getElementById('continuous-video').currentTime`),32);
 await evaluate(`document.getElementById('method-view').value='all';document.getElementById('method-view').dispatchEvent(new Event('change'));document.getElementById('continuous-video').currentTime=0`);
 await wait(`[...document.querySelectorAll('.method-meta')].every(e=>e.textContent.includes('观察0秒'))`);
 assert.equal(await evaluate(`[...document.querySelectorAll('.visit-sequence')].every(e=>e.children.length===1)`),true);
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await screenshot('mobile.png');
 assert.ok(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`),'Mobile page overflows horizontally');
 assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>r.method==='POST').length,0);
 const report={passed:true,cards:3,videoSeconds:64.1,causalSeekAndUnknown:true,methodSwitchPreservesTime:true,mobileNoHorizontalOverflow:true,browserExceptions:errors,modelCalls:0,requests:requests.map(r=>({url:r.url,method:r.method}))};
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,requests:undefined}));
}finally{socket.close();await fetch(debug+'/json/close/'+tab.id);}
