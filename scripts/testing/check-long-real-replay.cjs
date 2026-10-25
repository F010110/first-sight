const {chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const fs=require('node:fs');
const {resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
 const {realtimeServer}=await import(pathToFileURL(resolve('dist/current/desktop/realtime-server.js')).href);
 const app=realtimeServer(resolve('run/realtime-system'),0,false,false);
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
 let browser;
 try{
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[],posts=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')posts.push(r.url());});
  await page.goto(base+'/recordings.html?source=real');
  await page.waitForFunction(()=>document.querySelector('#real-video').readyState>=2);
  if(await page.locator('#skip-pause').isVisible())throw Error('Simulation skip visible on real video');
  const videos=await (await fetch(base+'/api/replay/real-videos')).json(),ego=videos.recordings.filter(v=>v.id.startsWith('egolife-'));if(ego.length!==2)throw Error('Expected two complete EgoLife recordings');
  for(const row of videos.recordings){
   const ute=row.id.startsWith('ute-');if(!ute&&row.durationMs!==1200000)throw Error('Expected 20 minutes');
   await page.locator('#recording-select').selectOption('video:'+row.id);
   await page.waitForFunction(()=>document.querySelector('#real-video').readyState>=2);
   // Seek across the 30s source files, not just within a native video element.
   const seekMs=ute?(row.id.includes('p04')?4800000:7200000):900000;
   await page.locator('#seek').fill(String(seekMs));await page.locator('#seek').dispatchEvent('input');
   await page.waitForFunction(clip=>document.querySelector('#real-video').readyState>=2&&document.querySelector('#real-video').currentSrc.includes('clip='+clip),ute?0:30);
   await page.evaluate(()=>{const v=document.querySelector('#real-video');v.muted=true;return v.play();});
   await page.waitForFunction(seconds=>document.querySelector('#real-video').currentTime>seconds,ute?seekMs/1000:.1);
   await page.evaluate(()=>document.querySelector('#real-video').pause());
   await page.screenshot({path:(fs.mkdirSync('run/hardware/long-real-replay-ui',{recursive:true}),'run/hardware/long-real-replay-ui/'+row.id+'.png')});
  }
  await page.locator('#recording-select').selectOption('video:'+ego[0].id);await page.waitForFunction(()=>document.querySelector('#real-video').readyState>=2);
  await page.locator('#seek').fill('29900');await page.locator('#seek').dispatchEvent('input');
  await page.waitForFunction(()=>document.querySelector('#real-video').readyState>=2&&document.querySelector('#real-video').currentSrc.includes('clip=0'));
  await page.evaluate(()=>{const v=document.querySelector('#real-video');v.muted=true;return v.play();});
  await page.waitForFunction(()=>document.querySelector('#real-video').currentSrc.includes('clip=1')&&document.querySelector('#real-video').currentTime>.1);
  await page.evaluate(()=>document.querySelector('#real-video').pause());
  await page.goto(base+'/recordings.html?source=real&recording=video%3Aute-p04-long');
  await page.waitForFunction(()=>document.querySelector('#real-video').readyState>=2);
  if(await page.locator('#recording-select').inputValue()!=='video:ute-p04-long')throw Error('Direct recording link not applied');
  const state=await (await fetch(base+'/api/live/state')).json();if(state.session!==null||errors.length||posts.length)throw Error(JSON.stringify({errors,posts,session:state.session}));
  const report={recordings:videos.recordings,aggregateSeek:true,originalClipHandoff:true,errors,posts,modelCalls:0,receiverStarted:false};
  fs.writeFileSync('run/hardware/long-real-replay-ui/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser?.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
