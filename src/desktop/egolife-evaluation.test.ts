import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {egoLifeViewerServer} from './egolife-viewer-server.js';

test('EgoLife viewer separates diagnostic gold, binds media, shows actual traces and forbids writes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'egolife-viewer-')),inputRoot=join(root,'input'),baselineRoot=join(root,'baseline'),runRoot=join(root,'v2');
 const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
 const save=(path:string,value:unknown)=>writeFile(path,JSON.stringify(value));
 await mkdir(join(inputRoot,'clips'),{recursive:true});await mkdir(join(inputRoot,'png'));await mkdir(baselineRoot);await mkdir(join(runRoot,'requests/0000'),{recursive:true});
 const video=Buffer.from('range-test-video-fixture'),png=Buffer.from('fixture-image-hash-binding');
 await writeFile(join(inputRoot,'clips/0000.mp4'),video);await writeFile(join(inputRoot,'png/a.png'),png);
 const task={ID:'1',type:'EntityLog',question:'Where was it?',choices:{A:'desk',B:'shelf',C:'room',D:'other'},queryTime:{date:'DAY1',time:'00000100'},untilTime:100000100,cutoffMs:1000};
 await save(join(inputRoot,'manifest.json'),{schema:'original-real-video-v1',title:'Fixture',scope:'read-only diagnostic',cameraCount:1,source:'EgoLife',durationMs:2000,clips:[{file:'clips/0000.mp4',durationMs:2000,bytes:video.length,sha256:hash(video)}]});
 await save(join(baselineRoot,'public-input.json'),{source:{firstMs:0,lastMs:1000},tasks:[task],originals:[{id:'a',atMs:0,pngPath:join(inputRoot,'png/a.png'),pngSha256:hash(png)}]});
 await save(join(runRoot,'summary.json'),{correct:0,total:1,accuracy:0});
 await save(join(runRoot,'results.json'),[{ID:'1',status:'answered',response:'B',rawFirstSightAnswer:{text:'B',sourceIds:['a']},privateField:'DO_NOT_EXPOSE'}]);
 await save(join(runRoot,'qa-trace-audit.json'),[{directory:'0000',question:task.question,action:{kind:'answer',text:'B'},feedback:'trace',imageIds:['a']}]);
 await save(join(runRoot,'requests/0000/input.json'),{data:{toolResult:{hits:[{id:'a'}]}},privateField:'DO_NOT_EXPOSE'});
 const goldSource=join(root,'gold.json');await save(goldSource,[{ID:'1',answer:'A',reason:'SECRET_GOLD_REASON',need_audio:false,need_name:false,target_time:{date:'DAY1',time:'00000000'}}]);
 const server=egoLifeViewerServer({inputRoot,baselineRoot,goldSource,runs:[{id:'v2',title:'Fixture',root:runRoot}]});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port,base='http://127.0.0.1:'+port;
 try{
  const catalog=await(await fetch(base+'/api/evaluation/egolife')).json() as any;assert.equal(catalog.tasks.length,1);assert.equal(catalog.modelCallsOnView,0);assert.ok(!JSON.stringify(catalog).includes('SECRET'));
  const response=await fetch(base+'/api/evaluation/egolife/task?id=1&run=v2'),text=await response.text();assert.equal(response.status,200);assert.ok(!text.includes('SECRET'));assert.ok(!text.includes('DO_NOT_EXPOSE'));assert.ok(!text.includes(root.replaceAll('\\','\\\\')));
  const detail=JSON.parse(text);assert.equal(detail.steps[0].images[0].id,'a');assert.equal(detail.citedFrames[0].id,'a');
  const gold=await(await fetch(base+'/api/evaluation/egolife/gold?id=1')).json() as any;assert.equal(gold.reason,'SECRET_GOLD_REASON');assert.equal(gold.notAgentInput,true);
  const media=await fetch(base+'/api/evaluation/egolife/media?clip=0',{headers:{Range:'bytes=2-5'}});assert.equal(media.status,206);assert.equal(await media.text(),video.subarray(2,6).toString());
  const image=await fetch(base+'/api/evaluation/egolife/frame?id=a');assert.equal(image.status,200);assert.equal(Buffer.from(await image.arrayBuffer()).toString(),png.toString());
  assert.equal((await fetch(base+'/api/evaluation/egolife/frame?id=..%2Fsecret')).status,400);
  assert.equal((await fetch(base+'/api/evaluation/egolife/task?id=1&run=..%2Fsecret')).status,400);
  assert.equal((await fetch(base+'/api/evaluation/egolife/media?clip=..%2F0')).status,400);
  assert.equal((await fetch(base+'/api/live/start',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/api/evaluation/egolife',{headers:{Origin:'https://elsewhere.example'}})).status,403);
  assert.equal((await fetch(base+'/egolife.html')).status,200);
  await writeFile(join(inputRoot,'png/a.png'),'changed');assert.equal((await fetch(base+'/api/evaluation/egolife/frame?id=a')).status,400);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});
