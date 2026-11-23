/** Local browser smoke; no model calls or dependencies installed. */
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.tmpdir(),'opencode/realtime-ui-check/node_modules/playwright'));
(async()=>{
 const output=path.resolve(process.argv[2]||'run/hardware/egolife-viewer-check-v1');fs.mkdirSync(output,{recursive:false});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const errors=[],goldRequests=[];
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1100}});
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/egolife/gold'))goldRequests.push(request.url());});
  await page.goto('http://127.0.0.1:8886/egolife.html?task=2&run=v2');
  await page.waitForFunction(()=>document.getElementById('result').textContent.includes('answered'));
  await page.waitForFunction(()=>document.getElementById('video').readyState>=1);
  await page.locator('#video').evaluate(async video=>{await video.play();});
  await page.waitForFunction(()=>document.getElementById('video').currentTime>.15);
  await page.locator('#video').evaluate(video=>video.pause());
  if(goldRequests.length)throw Error('Gold requested before human diagnostic expansion');
  await page.screenshot({path:path.join(output,'question2.png'),fullPage:true});
  await page.locator('#step').selectOption('14');
  await page.waitForFunction(()=>document.getElementById('step-images').querySelectorAll('img').length>0);
  await page.locator('#gold-panel summary').click();
  await page.waitForFunction(()=>document.getElementById('gold').textContent.includes('标准答案：C'));
  await page.screenshot({path:path.join(output,'question2-diagnosis.png'),fullPage:true});
  await page.locator('#task').selectOption('9');
  await page.waitForFunction(()=>document.getElementById('question').textContent.startsWith('Q9'));
  if(await page.locator('#gold-panel').getAttribute('open')!==null)throw Error('Gold panel not reset for new question');
  await page.locator('#run').selectOption('baseline');
  await page.waitForFunction(()=>document.getElementById('result').textContent.includes('abstained'));
  await page.screenshot({path:path.join(output,'baseline-question9.png'),fullPage:true});
  const video=await page.locator('#video').evaluate(video=>({readyState:video.readyState,error:video.error?.message??null,width:video.videoWidth,height:video.videoHeight}));
  if(errors.length||video.error)throw Error(JSON.stringify({errors,video}));
  fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify({base:'http://127.0.0.1:8886',goldHiddenUntilExpanded:true,versionSwitch:true,taskSwitch:true,actualTraceImages:true,video,errors,modelCalls:0},null,2));
  console.log(JSON.stringify({output,video,errors,modelCalls:0}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
