/** Real read-only replay APIs on an ephemeral port; no receiver or model calls. */
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
   await page.goto(base+'/');await page.getByRole('link',{name:'回放 / 模拟'}).click();
   await page.locator('#recording-select').selectOption('render-smoke-v3');
  await page.waitForFunction(()=>document.querySelectorAll('#multi-view img').length===3);
  await page.waitForFunction(()=>[...document.querySelectorAll('#multi-view img')].every(i=>i.complete&&i.naturalWidth===640));
  const geometry=await page.evaluate(()=>{const front=document.querySelector('figure[data-view=front]').getBoundingClientRect(),left=document.querySelector('figure[data-view=left]').getBoundingClientRect(),evidence=document.querySelector('.evidence').getBoundingClientRect();return {frontWidth:front.width,leftWidth:left.width,evidenceWidth:evidence.width};});
  if(geometry.frontWidth<geometry.leftWidth*2||geometry.evidenceWidth>300)throw Error('Unexpected replay geometry '+JSON.stringify(geometry));
  await page.getByRole('button',{name:'播放',exact:true}).click();await page.getByRole('button',{name:'暂停',exact:true}).click();
  await page.locator('#seek').fill('10');await page.locator('#seek').dispatchEvent('input');
  await page.waitForFunction(()=>document.querySelector('#frame-time').textContent.includes('5.0秒'));
  await page.locator('#view-mode').selectOption('left');await page.waitForFunction(()=>document.querySelector('#frame').complete&&document.querySelector('#frame').naturalWidth===640);
  await page.locator('#play').click();await page.waitForFunction(()=>Number(document.querySelector('#seek').value)>10);await page.locator('#play').click();
  await page.locator('#view-mode').selectOption('all');await page.waitForFunction(()=>[...document.querySelectorAll('#multi-view img')].every(i=>i.complete&&i.naturalWidth===640));
  const sizes=[];fs.mkdirSync('run/hardware/unified-replay-ui',{recursive:true});
  for(const [width,height] of [[1366,768],[1280,720],[1920,1080]]){
   await page.setViewportSize({width,height});const layout=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}));
   if(layout.scrollWidth>width||layout.scrollHeight>height)throw Error('Replay overflow: '+JSON.stringify(layout));sizes.push(layout);
   await page.screenshot({path:`run/hardware/unified-replay-ui/simulation-${width}.png`});
  }
  await page.locator('#recording-select').selectOption('revisit-24h-v1');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('349张'));
  await page.locator('#seek').fill('10');await page.locator('#seek').dispatchEvent('input');
  await page.waitForFunction(()=>!document.querySelector('#skip-pause').disabled);
  await page.locator('#skip-pause').click();await page.waitForFunction(()=>document.querySelector('#skip-notice').textContent.includes('已跳过'));
  if(Number(await page.locator('#seek').inputValue())<=10)throw Error('Skip did not advance');
  await page.locator('#seek').fill('348');await page.locator('#seek').dispatchEvent('input');
  await page.waitForFunction(()=>document.querySelector('#player-time').textContent.includes('24:00:00'));
  await page.locator('#replay-source').selectOption('real');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('只读')||document.querySelector('#status').textContent.includes('单摄真实原片')||document.querySelector('#status').textContent==='暂无可用记录');
  if(await page.locator('#skip-pause').isVisible())throw Error('Simulation control leaked into real replay');
  await page.screenshot({path:'run/hardware/unified-replay-ui/real.png'});
   await page.locator('#replay-source').selectOption('simulation');await page.waitForFunction(()=>[...document.querySelector('#recording-select').options].some(o=>o.value==='campus-video:6'));
   await page.locator('#recording-select').selectOption('campus-video:6');
   await page.waitForFunction(()=>document.querySelector('#real-video').readyState>=2);
   if(await page.locator('#campus-link').count()||await page.locator('#prototype-link').count())throw Error('Multiple simulation entrances returned');
  const state=await (await fetch(base+'/api/live/state')).json();if(state.session!==null)throw Error('Read-only replay started receiver');
  if(errors.length||posts.length)throw Error(JSON.stringify({errors,posts}));
  const report={base,sizes,errors,posts,realReadOnlyAPIs:true,receiverStarted:false,modelCalls:0};fs.writeFileSync('run/hardware/unified-replay-ui/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser?.close();await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
