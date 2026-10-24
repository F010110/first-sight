const {chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
   const page=await browser.newPage();let paid=false,manual=false,starts=0,stops=0,recordChanges=0;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/live/**',async route=>{const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/start')){paid=true;starts++;}if(path.endsWith('/stop')){paid=false;stops++;}
    if(path.endsWith('/recording')){manual=route.request().postDataJSON().enabled;recordChanges++;}
    await route.fulfill({json:path.endsWith('/state')?{allowPaid:true,session:{running:true,paid,recording:paid||manual,frames:0,questions:[],places:[],inputState:'current-state-unconfirmed',ageMs:null}}:{ok:true}});
  });
  await page.goto('http://127.0.0.1:8884/realtime.html');
  await page.getByRole('switch',{name:'系统启动'}).click();
  await page.waitForFunction(()=>document.querySelector('#system-toggle').getAttribute('aria-checked')==='true');
   await page.getByRole('switch',{name:'系统启动'}).click();
   await page.waitForFunction(()=>document.querySelector('#system-toggle').getAttribute('aria-checked')==='false');
   await page.getByRole('switch',{name:'记录画面'}).click();
   await page.waitForFunction(()=>document.querySelector('#record-toggle').getAttribute('aria-checked')==='true');
   await page.getByRole('switch',{name:'记录画面'}).click();
   await page.waitForFunction(()=>document.querySelector('#record-toggle').getAttribute('aria-checked')==='false');
  fs.mkdirSync('run/hardware/compact-live-ui',{recursive:true});const sizes=[];
  for(const [width,height] of [[1366,768],[1280,720],[1920,1080]]){
   await page.setViewportSize({width,height});
   const layout=await page.evaluate(()=>({height:innerHeight,scroll:document.documentElement.scrollHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
   if(layout.scroll>height||layout.scrollWidth>width)throw Error(JSON.stringify(layout));sizes.push(layout);
   await page.screenshot({path:`run/hardware/compact-live-ui/${width}.png`});
  }
   const report={starts,stops,recordChanges,errors,sizes,mockedAPI:true,modelCalls:0};fs.writeFileSync('run/hardware/compact-live-ui/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(errors.length||starts!==1||stops!==1||recordChanges!==2)process.exitCode=1;
 }finally{await browser.close();}
})();
