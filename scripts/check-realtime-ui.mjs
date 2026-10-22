/** Actual Chromium smoke check against the running, paired network camera. */
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
if(!process.argv.includes('--confirm-paid'))throw Error('Requires --confirm-paid: clicks Start interaction and submits one question');
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const root=resolve(process.argv[2]);await mkdir(root,{recursive:false});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const report={};const state=async()=>page.evaluate(async()=> (await(await fetch('/api/live/state')).json()).session);
async function until(predicate,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){const s=await state();if(predicate(s))return s;await new Promise(r=>setTimeout(r,300));}throw Error('Timed out waiting for realtime state');}
async function calls(id){try{return JSON.parse(await readFile(join('run/realtime-system',id,'spatial-requests/hour-00000/usage.json'),'utf8')).calls;}catch{return 0;}}
try{
 await page.goto('http://127.0.0.1:8884/realtime.html');
 await page.waitForFunction(()=>document.querySelector('#live-image')?.naturalWidth===640,{},{timeout:60000});
 if((await state()).paid)await page.getByRole('button',{name:'暂停交互'}).click();
 await until(s=>!s.paid&&!s.processing&&!s.questionBusy,180000);
 const before=await state(),beforeCalls=await calls(before.sessionId);
 await until(s=>s.frames>=before.frames+3);
 const preview=await state();if(preview.paid||await calls(preview.sessionId)!==beforeCalls)throw Error('Preview invoked spatial model');
 report.preview={framesBefore:before.frames,framesAfter:preview.frames,modelCallsUnchanged:true,usbRequired:preview.usbRequired};
 await page.getByRole('button',{name:'启动交互',exact:true}).click();
 await until(s=>s.paid,10000);
 await page.locator('#live-question').fill('刚才画面中有哪些物体？请搜索并查看历史原图。');
 await page.getByRole('button',{name:'发送问题',exact:true}).click();
 await until(s=>{const q=s.questions.at(-1);return s.questions.length>before.questions.length&&q?.question==='刚才画面中有哪些物体？请搜索并查看历史原图。'&&q.status!=='answering';},180000);
 const answered=await state();report.answer=answered.questions.at(-1);if(report.answer.status!=='answered'||report.answer.abstained||!report.answer.sourceIds?.length)throw Error('Question did not produce an evidenced answer');
 await page.waitForFunction(()=>document.querySelectorAll('#live-answers a').length>0,{},{timeout:10000});
 await page.screenshot({path:join(root,'desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(root,'mobile.png'),fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Mobile horizontal overflow');
 await page.getByRole('button',{name:'暂停交互'}).click();await until(s=>!s.paid);
 const paused=await state();await until(s=>s.frames>paused.frames);
 report.pause={previewContinues:true};report.errors=errors;if(errors.length)throw Error('Browser page errors');
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{await page.evaluate(async()=>fetch('/api/live/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).catch(()=>{});await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));}
