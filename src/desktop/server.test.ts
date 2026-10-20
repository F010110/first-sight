import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {AssistantRuntime} from '../assistant/runtime.js';
import {FileJournal} from '../assistant/journal.js';
import {desktopServer} from './server.js';

test('simulator replay delivers three actual image views and preserves source provenance',async()=>{
 const root=await mkdtemp(resolve('cam/local/desktop-replay-test-'));
 const journal=new FileJournal(root);let views=0;
 const runtime=new AssistantRuntime({async plan(){throw Error('No model expected');}},{async observe(observation){views=observation.frames.length;},async question(){throw Error('No model expected');},discardPending(){},close(){}},journal,[],false);
 const port=18987,server=desktopServer(runtime,journal,root,port);
 await new Promise<void>(resolve=>server.listen(port,'127.0.0.1',resolve));
 try{
  const base=`http://127.0.0.1:${port}`;
  const response=await fetch(base+'/api/simulator',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start'})});assert.equal(response.status,200);
  let replay:{index:number;images:Array<{url:string}>}={index:0,images:[]};
  for(let i=0;i<100;i++){replay=await (await fetch(base+'/api/simulator')).json() as typeof replay;if(replay.index)break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal(replay.index,1);assert.equal(replay.images.length,3);await runtime.idle();assert.equal(views,3);
  assert.equal(runtime.view().latestObservation?.source,'simulator-replay');
  const image=await fetch(base+replay.images[0]!.url);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.ok((await image.arrayBuffer()).byteLength>1000);
  await fetch(base+'/api/simulator',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pause'})});
  assert.equal(runtime.view().capture,'paused');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await runtime.close();await rm(root,{recursive:true,force:true});}
});
