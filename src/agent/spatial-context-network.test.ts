import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {spatialContextVlm} from './spatial-context-vlm.js';import {SpatialWorkingContext} from './spatial-working-context.js';
test('actual provider retries identical HTTP payload and retains unknown billing reservation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'spatial-network-')),oldKey=process.env.QWEN_API_KEY,oldBase=process.env.QWEN_BASE_URL,bodies:string[]=[];
 const decision={assessments:[{observationId:'a',atMs:1,placeId:null,reason:'layout',sourceIds:['a']}],next:{kind:'finish'}};
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=String(chunk);bodies.push(body);if(bodies.length===1){req.socket.destroy();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(decision)}}],usage:{prompt_tokens:10,completion_tokens:5}}));});
 await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));
 try{const address=server.address();assert.ok(address&&typeof address!=='string');process.env.QWEN_API_KEY='fixture';process.env.QWEN_BASE_URL=`http://127.0.0.1:${address.port}`;
  const image=join(root,'image.png');await writeFile(image,'fixture');const observation={id:'a',atMs:1,frames:[image]},context=new SpatialWorkingContext();context.observe(observation);
  const model=spatialContextVlm(join(root,'requests'),3,.1);const result=await model({context:context.view(),observations:[observation],question:null,candidates:[],inspectedIds:['a'],evidenceImages:[],remainingCalls:4,historicalEvidenceRequired:false,feedback:null});
  assert.deepEqual(result,decision);assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);
  const ledger=JSON.parse(await readFile(join(root,'requests/usage.json'),'utf8'));assert.equal(ledger.calls,2);assert.equal(ledger.unknownCallsReserved,1);assert.ok(ledger.estimatedUSD>.017);
  assert.ok(JSON.parse(await readFile(join(root,'requests/0000/transport-failure-0.json'),'utf8')).retrying);assert.equal(JSON.parse(await readFile(join(root,'requests/0000/reservation-1.json'),'utf8')).attempt,1);
 }finally{server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()));if(oldKey===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=oldKey;if(oldBase===undefined)delete process.env.QWEN_BASE_URL;else process.env.QWEN_BASE_URL=oldBase;await rm(root,{recursive:true,force:true});}
});
