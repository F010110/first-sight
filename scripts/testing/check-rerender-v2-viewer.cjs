/** Read-only browser acceptance for the repaired 2x/1fps sample. No model calls. */
const path=require('node:path'),os=require('node:os'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.tmpdir(),'opencode/realtime-ui-check/node_modules/playwright'));
(async()=>{
 let [base,outArg]=process.argv.slice(2);if(!base||!outArg)throw Error('Usage: check-rerender-v2-viewer URL-OR-BUNDLE NEW-OUTPUT');const output=path.resolve(outArg);await fs.mkdir(output,{recursive:false});let ownedServer;
 if(!base.startsWith('http://')){const {pathToFileURL}=require('node:url');const {createAnnotationReviewServer}=await import(pathToFileURL(path.resolve('dist/current/desktop/annotation-review-server.js')).href);ownedServer=await createAnnotationReviewServer(path.resolve(base));await new Promise(r=>ownedServer.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${ownedServer.address().port}`;}
 const state=await(await fetch(base+'/api/sample')).json();assert.equal(state.sample.frames.length,813);assert.equal(state.sample.reviewRequired,false);assert.equal(state.sample.actions.length,36);assert.equal(state.revision,0);
 assert.ok(state.sample.frames.every(f=>f.atMs===2*f.sourceAtMs));assert.equal(state.sample.provenance.EInputReplayed.observed_edge_count,72);
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1100}});page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
  await page.waitForFunction(()=>document.getElementById('front').naturalWidth===640&&document.getElementById('frame-count').textContent.includes('1 / 813'));
  assert.equal(await page.locator('#segments button').count(),42);assert.equal(await page.locator('#actions .row').count(),36);assert.match(await page.locator('#progress').textContent(),/无需再次审核/);
  assert.equal(await page.locator('button[data-status]:visible').count(),0);
  await page.screenshot({path:path.join(output,'new-sample.png'),fullPage:false});
  await page.locator('#seek').evaluate(e=>{e.value='764';e.dispatchEvent(new Event('input'));});await page.waitForFunction(()=>document.getElementById('front').src.includes('rerender-v2-000765')&&document.getElementById('front').naturalWidth===640);
  const brightness=await page.evaluate(()=>['front','left','right'].map(id=>{const im=document.getElementById(id),c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;const x=c.getContext('2d');x.drawImage(im,0,0);const p=x.getImageData(0,0,c.width,c.height).data;let sum=0;for(let i=0;i<p.length;i+=4)sum+=(p[i]+p[i+1]+p[i+2])/3;return {view:id,mean:sum/(c.width*c.height)};}));
  assert.ok(brightness.every(b=>b.mean>5));assert.match(await page.locator('#current-summary').textContent(),/电梯轿厢/);await page.screenshot({path:path.join(output,'repaired-elevator.png'),fullPage:false});
  await page.locator('#speed').selectOption('4');await page.locator('#play').click();await page.waitForFunction(()=>Number(document.getElementById('seek').value)>764);await page.locator('#play').click();
  assert.equal(errors.length,0);const finalState=await(await fetch(base+'/api/sample')).json();assert.equal(finalState.revision,0);
  const receipt={passed:true,frames:813,threeViews:true,clockScale:2,EPresses:36,EEdges:72,readOnlyCompleteAnnotations:true,renderedElevatorBrightness:brightness,playback:true,errors,modelCalls:0};await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
 }finally{await browser.close();if(ownedServer)await new Promise(r=>ownedServer.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
