import test from 'node:test';
import assert from 'node:assert/strict';
import {FastSpatialMemory,BoundedObservationInbox,VisualUpdateGate,FastSpatialWorker,type FastObservation} from './fast-spatial-memory.js';
const observation=(id:string,atMs:number):FastObservation=>({id,atMs,views:[{id,direction:'front',path:'not-read.png',sha256:'0'.repeat(64)}],features:[Array(72).fill(.5)]});
test('one request per update; representative association remains unverified',async()=>{
 let calls=0;
 const memory=new FastSpatialMemory(async r=>{
  calls++;const id=(r.data as any).current.id;
  return {observationId:id,visibleFacts:['desk'],relation:calls===1?'new':'candidate',candidateId:calls===1?null:'place-1',name:'room',reason:'visible desk; representative only',sourceIds:calls===1?[id]:[id,'a']};
 });
 await memory.observe(observation('a',0));await memory.observe(observation('b',100));
 assert.equal(calls,2);assert.deepEqual(memory.snapshot().places[0]!.members,['a']);
 assert.equal(memory.snapshot().reviews.length,1);assert.equal(memory.snapshot().verifiedAssociations,0);
});
test('invented candidate or future source cannot modify memory',async()=>{
 const memory=new FastSpatialMemory(async()=>({observationId:'a',visibleFacts:['desk'],relation:'candidate',candidateId:'unknown',name:'room',reason:'guess',sourceIds:['a','future']}));
 await assert.rejects(memory.observe(observation('a',0)),/Invalid joint/);assert.equal(memory.snapshot().places.length,0);
});
test('latest-only ordinary updates; important observations bounded and audited',()=>{
 const queue=new BoundedObservationInbox<{id:string}>(2);
 queue.offer({id:'a'});queue.offer({id:'b'});queue.offer({id:'e1'},true);queue.offer({id:'e2'},true);queue.offer({id:'e3'},true);
 assert.equal(queue.pending,3);assert.deepEqual(queue.dropped,[{id:'a',reason:'superseded'},{id:'e1',reason:'event-capacity'}]);
 assert.equal(queue.take()!.id,'b');assert.equal(queue.take()!.id,'e2');assert.equal(queue.take()!.id,'e3');assert.equal(queue.take(),null);
});
test('joint protocol error is retained as failure, not retried automatically',async()=>{
 let calls=0;const memory=new FastSpatialMemory(async()=>{calls++;return {};});
 await assert.rejects(memory.observe(observation('a',0)));assert.equal(calls,1);
});
test('image trigger keeps periodic and explicitly important evidence without inferring identity',()=>{
 const gate=new VisualUpdateGate(.003,10000);const features=[Array(72).fill(.5)];
 assert.equal(gate.consider({atMs:0,features}).reason,'initial');
 assert.equal(gate.consider({atMs:2000,features}).analyze,false);
 assert.equal(gate.consider({atMs:4000,features},true).reason,'important-evidence');
 assert.equal(gate.consider({atMs:14000,features}).reason,'heartbeat');
 assert.equal(gate.consider({atMs:16000,features:[Array(72).fill(0)]}).reason,'visual-change');
});
test('inbox audit and pending memory stay bounded under prolonged overload',()=>{
 const queue=new BoundedObservationInbox<{id:string}>(2);
 for(let i=0;i<3000;i++)queue.offer({id:String(i)});
 assert.equal(queue.pending,1);assert.equal(queue.droppedCount,2999);assert.equal(queue.dropped.length,1000);
 assert.equal(queue.take()!.id,'2999');
});
test('slow provider does not block acquisition or build ordinary FIFO backlog',async()=>{
 let release!:()=>void;let calls=0;
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 const memory=new FastSpatialMemory(async r=>{
  calls++;if(calls===1)await blocked;const id=(r.data as any).current.id;
  return {observationId:id,visibleFacts:['desk'],relation:'uncertain',candidateId:null,name:'unknown',reason:'not enough evidence',sourceIds:[id]};
 });
 const worker=new FastSpatialWorker(memory);
 worker.offer(observation('a',0));
 for(let i=1;i<=20;i++)worker.offer(observation(String(i),i*10000));
 assert.equal(worker.inbox.pending,1);assert.equal(calls,1);
 release();await worker.idle();assert.equal(calls,2);assert.equal(memory.decisions[1]!.observationId,'20');
 await worker.stop();assert.throws(()=>worker.offer(observation('closed',300000)));
});
