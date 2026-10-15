// Independent local Chrome acceptance, without the OpenCode desktop browser bridge.
// No provider calls, no real user Chrome profile, no dependency installation.
import { spawn } from 'node:child_process';
import { mkdtemp,readFile,writeFile,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const [url='http://127.0.0.1:3417',outputArg='run/dev-browser-acceptance-v1']=process.argv.slice(2);
const output=resolve(outputArg);await mkdir(output,{recursive:false});
const chrome=process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const tempRoot=process.env.LOCALAPPDATA?join(process.env.LOCALAPPDATA,'Temp','opencode'):tmpdir();await mkdir(tempRoot,{recursive:true});
const profile=await mkdtemp(join(tempRoot,'spatial-dev-chrome-'));
const reserved=createServer();await new Promise(r=>reserved.listen(0,'127.0.0.1',r));const port=reserved.address().port;await new Promise(r=>reserved.close(r));
const processChrome=spawn(chrome,['--headless=new','--no-first-run','--disable-background-networking',`--user-data-dir=${profile}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let socket;
try{
  const pageResponse=await fetch(url);assert.ok(pageResponse.ok,'Developer server must be running before browser acceptance');
  let target;
  for(let i=0;i<60;i++){try{target=await(await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,{method:'PUT'})).json();break;}catch{await pause(100);}}
  assert.ok(target?.webSocketDebuggerUrl,'Chrome did not become ready');socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let nextId=0;const pending=new Map(),errors=[];
  socket.onmessage=event=>{const value=JSON.parse(event.data);if(value.id){const p=pending.get(value.id);if(!p)return;pending.delete(value.id);if(value.error)p.reject(Error(value.error.message));else p.resolve(value.result);}else if(value.method==='Runtime.exceptionThrown')errors.push(value.params.exceptionDetails.text);};
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;const timeout=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));},15000);pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});socket.send(JSON.stringify({id,method,params}));});
  await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});
  const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value;};
  for(let i=0;i<80;i++){try{if(await evaluate(`document.querySelector('#observation')?.options.length>0 && [...document.images].slice(0,3).every(i=>i.complete&&i.naturalWidth>0)`))break;}catch(error){if(!/execution context|context.*destroyed/i.test(error.message))throw error;}await pause(100);}
  assert.equal(await evaluate(`document.querySelector('#paid').checked`),false);
  assert.equal(await evaluate(`[...document.images].slice(0,3).every(i=>i.naturalWidth>0)`),true);
  const count=await evaluate(`document.querySelector('#observation').options.length`);assert.ok(count>0);
  await evaluate(`document.querySelector('#recognize').click()`);
  for(let i=0;i<50;i++){if(await evaluate(`document.querySelector('#error').textContent.length>0`))break;await pause(50);}
  assert.match(await evaluate(`document.querySelector('#error').textContent`),/paid-call/);
  await evaluate(`document.querySelector('#observation').selectedIndex=Math.min(2,document.querySelector('#observation').options.length-1); document.querySelector('#observation').dispatchEvent(new Event('change')); document.querySelector('#retrieveAll').click();`);
  for(let i=0;i<50;i++){if(await evaluate(`document.querySelector('#result').textContent.includes('remainingImages')`))break;await pause(50);}
  const retrieval=JSON.parse(await evaluate(`document.querySelector('#result').textContent`));assert.ok(Array.isArray(retrieval.hits));
  for(let i=0;i<40;i++){if(await evaluate(`[...document.images].every(i=>i.complete)`))break;await pause(50);}
  const screenshot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(join(output,'console.png'),Buffer.from(screenshot.data,'base64'));
  assert.deepEqual(errors,[]);const report={url,datasetObservations:count,historicalHits:retrieval.hits.length,imagesLoaded:true,uncheckedPaidCallDenied:true,consoleErrors:errors,paidModelCalls:0,profile,note:'Independent headless Chrome DOM/click/image test; OpenCode desktop bridge remains disconnected. No manual human interaction claim.'};
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({message:error.message},null,2));throw error;}
finally{socket?.close();processChrome.kill();}
