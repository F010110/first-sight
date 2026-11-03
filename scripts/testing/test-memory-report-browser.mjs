/** Existing local Chromium CDP only: no browser download, producer or model calls. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const [base='http://127.0.0.1:8896',debug='http://127.0.0.1:9341',out='run/unioncity-memory-visual-small-v1/memory-review/browser-check']=process.argv.slice(2);
await mkdir(out,{recursive:false});
const tab=await (await fetch(debug+'/json/new?about:blank',{method:'PUT'})).json(),socket=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,no)=>{socket.onopen=ok;socket.onerror=no;});let id=0;const pending=new Map(),errors=[],requests=[];
socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(Error(JSON.stringify(m.error)));else p?.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);else if(m.method==='Network.requestWillBeSent')requests.push({url:m.params.request.url,method:m.params.request.method});};
const call=(method,params={})=>new Promise((ok,no)=>{const n=++id;pending.set(n,{resolve:ok,reject:no});socket.send(JSON.stringify({id:n,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=expression=>evaluate(`new Promise((ok,no)=>{let n=0;const check=()=>{if(${expression})return ok(true);if(n++>100)return no(Error('DOM timeout'));setTimeout(check,50);};check();})`);
const capture=async name=>{const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(out,name),Buffer.from(r.data,'base64'));};
try{
 await call('Page.enable');await call('Runtime.enable');await call('Network.enable');await call('Emulation.setDeviceMetricsOverride',{width:1500,height:1100,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:base});
 await wait(`document.getElementById('version-label')?.textContent.includes('v3')`);
 assert.equal(await evaluate(`document.getElementById('timeline').children.length`),4);assert.ok(await evaluate(`document.getElementById('profiles').textContent.includes('没有地点属性写入')`));assert.ok(await evaluate(`document.getElementById('findings').textContent.includes('工具拒绝 2 次')`));await capture('latest-overview.png');
 await evaluate(`document.getElementById('version').value=0;document.getElementById('version').dispatchEvent(new Event('input'))`);assert.ok(await evaluate(`document.getElementById('selected-status').textContent.includes('空Context')`));assert.equal(await evaluate(`document.querySelectorAll('#context-before .message').length`),0);
 await evaluate(`document.getElementById('version').value=2;document.getElementById('version').dispatchEvent(new Event('input'))`);assert.equal(await evaluate(`document.getElementById('call').options.length`),3);assert.equal(await evaluate(`document.querySelectorAll('#session-delta .message.error').length`),2);assert.equal(await evaluate(`document.querySelectorAll('#context-before .message').length`),8);
 await evaluate(`document.getElementById('call').value=0;document.getElementById('call').dispatchEvent(new Event('change'))`);assert.equal(await evaluate(`document.querySelectorAll('#context-before .message').length`),4);
 await evaluate(`document.getElementById('session-delta').scrollIntoView()`);await capture('v2-rejected-actions.png');
 await evaluate(`document.getElementById('version').value=3;document.getElementById('version').dispatchEvent(new Event('input'));document.getElementById('observations').scrollIntoView()`);await wait(`document.querySelector('#observations img')?.complete&&document.querySelector('#observations img')?.naturalWidth>0`);assert.equal(await evaluate(`document.querySelectorAll('#observations img').length`),24);assert.ok(await evaluate(`document.getElementById('observations').textContent.includes('跳过的早窗')`));await capture('v3-skipped-sources.png');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await evaluate('window.scrollTo(0,0)');await capture('mobile.png');assert.ok(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`));
 assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'));assert.ok(requests.every(r=>new URL(r.url).origin===new URL(base).origin));
 const result={passed:true,versionNavigation:true,actualContexts:true,toolFailuresVisible:true,skippedFactsVisible:true,emptyPlaceProfilesVisible:true,originalImagesLoad:true,mobileNoOverflow:true,browserExceptions:errors,modelCalls:0,requests};await writeFile(join(out,'result.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({...result,requests:requests.length}));
}finally{socket.close();await fetch(debug+'/json/close/'+tab.id);}
