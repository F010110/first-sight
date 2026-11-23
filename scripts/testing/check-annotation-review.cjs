/** Real headless-browser check on an isolated review copy; no real user reviews changed. */
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.tmpdir(),'opencode/realtime-ui-check/node_modules/playwright'));
(async()=>{
 const [inputArg,outArg]=process.argv.slice(2);if(!inputArg||!outArg)throw Error('Usage: check-annotation-review BUNDLE NEW-OUTPUT');
 const input=path.resolve(inputArg),output=path.resolve(outArg);await fs.mkdir(output,{recursive:false});const copy=path.join(output,'isolated-bundle');await fs.mkdir(copy);
 for(const name of ['sample.json','bindings.json','integrity.json','map-platform.png','map-concourse.png','map-street.png','map-upper.png'])await fs.copyFile(path.join(input,name),path.join(copy,name));
 const {createAnnotationReviewServer}=await import(pathToFileURL(path.resolve('dist/current/desktop/annotation-review-server.js')).href);
 const server=await createAnnotationReviewServer(copy);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1100}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>document.getElementById('front').naturalWidth===640&&document.getElementById('frame-count').textContent.includes('1 / 192'));
  assert.equal(await page.locator('#segments button').count(),42);assert.equal(await page.locator('.revisit').count(),3);
  await page.screenshot({path:path.join(output,'overview.png'),fullPage:true});
  await page.locator('#seek').evaluate(e=>{e.value='17';e.dispatchEvent(new Event('input'));});await page.waitForFunction(()=>document.getElementById('front').src.includes('observation-000035'));
  await page.locator('#description').fill('浏览器隔离测试：保留原图，只修改审核层。');await page.locator('#note').fill('仅测试，不写入真实审核包');
  await page.locator('.review-card button[data-status="approved"]').click();await page.waitForFunction(()=>document.getElementById('save-state').textContent.includes('版本1'));
  await page.reload();await page.waitForFunction(()=>document.getElementById('front').naturalWidth===640);await page.locator('#seek').evaluate(e=>{e.value='17';e.dispatchEvent(new Event('input'));});
  assert.match(await page.locator('#description').inputValue(),/浏览器隔离测试/);assert.match(await page.locator('#review-state').textContent(),/已确认/);
  await page.locator('#scope').selectOption('segment');await page.locator('#label-correction').fill('隔离测试：CAFÉ区域命名修订');await page.locator('.review-card button[data-status="approved"]').click();await page.waitForFunction(()=>document.getElementById('save-state').textContent.includes('版本2'));
  assert.equal(await page.locator('#segments button').filter({hasText:'CAFÉ区域命名修订'}).count(),1);assert.match(await page.locator('#map').textContent(),/CAFÉ区域命名修订/);
  await page.locator('#speed').selectOption('8');await page.locator('#play').click();await page.waitForFunction(()=>Number(document.getElementById('seek').value)>17);await page.locator('#play').click();
  await page.locator('#seek').evaluate(e=>{e.value='186';e.dispatchEvent(new Event('input'));});await page.waitForFunction(()=>document.getElementById('front').src.includes('observation-000373'));
  assert.match(await page.locator('#map-caption').textContent(),/上层/);await page.screenshot({path:path.join(output,'rooftop.png'),fullPage:false});
  const revisit=page.locator('.revisit').first();await revisit.locator('textarea').fill('隔离测试重访审核');await revisit.locator('button[data-status="uncertain"]').click();await page.waitForFunction(()=>document.getElementById('save-state').textContent.includes('版本3'));
  const exported=await(await fetch(base+'/api/export')).json();assert.equal(exported.revision,3);assert.equal(exported.base.frames.length,192);assert.equal(exported.reviews[2].status,'uncertain');
  assert.equal(errors.length,0);assert.equal((await fs.readFile(path.join(input,'sample.json'))).equals(await fs.readFile(path.join(copy,'sample.json'))),true);
  await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify({passed:true,observations:192,segments:42,revisits:3,synchronizedImages:true,mapFloorSwitch:true,playback:true,persistentCorrections:true,segmentReview:true,export:true,productionReviewWrites:0,errors,modelCalls:0},null,2));console.log(JSON.stringify({output,passed:true,errors,modelCalls:0}));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
