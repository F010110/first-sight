import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {listSimulations,readSimulation,simulationImage} from './simulation-recordings.js';
import {realtimeServer} from './realtime-server.js';

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'simulation-replay-')),base=join(root,'samples','sampleA','public');await mkdir(join(base,'frames'),{recursive:true});
 const frames=[];
 for(const view of ['front','left','right']){const bytes=Buffer.from('independent-'+view),path='frames/0000-'+view+'.png';await writeFile(join(base,path),bytes);frames.push({view,path,sha256:createHash('sha256').update(bytes).digest('hex')});}
 await writeFile(join(base,'manifest.json'),JSON.stringify({schema:'three-view-render-input-v1',observations:1,scoreEligible:false,title:'Test simulation',secretOracle:'do not expose'}));
 await writeFile(join(base,'observations.jsonl'),JSON.stringify({id:'observation-0000',sourceAtMs:0,frames,pose:'secret-pose',answer:'secret-answer'})+'\n');
 return {root,base,samples:join(root,'samples'),frames};
}
test('simulation archives bind independent originals and reject traversal and changed bytes',async()=>{
 const f=await fixture();try{
  assert.equal((await listSimulations(f.samples)).length,1);assert.equal((await readSimulation(f.samples,'sampleA')).frames[0]!.views.length,3);
  assert.equal((await simulationImage(f.samples,'sampleA','observation-0000','left')).bytes.toString(),'independent-left');
  await assert.rejects(readSimulation(f.samples,'../private'));await assert.rejects(simulationImage(f.samples,'sampleA','observation-0000','../private'));
  await writeFile(join(f.base,f.frames[0]!.path),'changed');await assert.rejects(simulationImage(f.samples,'sampleA','observation-0000','front'),/changed/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('incomplete packages and duplicated views are not advertised as ready',async()=>{
 const f=await fixture();try{
  await mkdir(join(f.samples,'failed','public'),{recursive:true});
  assert.equal((await listSimulations(f.samples)).length,1);
  await writeFile(join(f.base,'observations.jsonl'),JSON.stringify({id:'o',sourceAtMs:0,frames:[f.frames[0],{...f.frames[0],view:'left'}]}));
  assert.equal((await listSimulations(f.samples)).length,0);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('one HTTP origin serves home, real/synthetic playback and images without exposing oracle or starting a session',async()=>{
 const f=await fixture(),app=realtimeServer(join(f.root,'real'),0,false,false,f.samples);
 await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));const port=(app.server.address() as {port:number}).port,base=`http://127.0.0.1:${port}`;
 try{
  assert.match(await (await fetch(base+'/')).text(),/统一入口/);
  assert.match(await (await fetch(base+'/recordings.html')).text(),/replay-source/);
  const response=await fetch(base+'/api/replay/simulation?id=sampleA'),body=await response.text();assert.equal(response.status,200);assert.doesNotMatch(body,/secret-pose|secret-answer|secretOracle|"base"|"position"/);
  const data=JSON.parse(body);assert.equal(data.clock,'synthetic');assert.equal(data.frames[0].views.length,3);assert.deepEqual(data.questions,[]);
  assert.equal((await fetch(base+data.frames[0].views[0].url)).status,200);
  assert.equal((await fetch(base+'/private/poses.jsonl')).status,404);
  assert.equal((await (await fetch(base+'/api/live/state')).json() as any).session,null);
  assert.equal((await fetch(base+'/api/replay/simulation?id=sampleA',{method:'POST',headers:{Origin:base}})).status,404);
 }finally{await app.close();await rm(f.root,{recursive:true,force:true});}
});
