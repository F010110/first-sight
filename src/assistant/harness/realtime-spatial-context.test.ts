import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {RealtimeSpatialContext} from './realtime-spatial-context.js';
test('original real-time facts publish causal modules without model calls, history rewriting or future leakage',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/realtime-module-'));const context=new RealtimeSpatialContext(root,['one','two']);
 const records:any[]=[];const store={snapshot:()=>({results:records})} as any;
 const record=(id:string,index:number)=>({lane:'memory',observation_id:id,source_at_ms:index,available_at_ms:1000+index,evidence_until_ms:index,memoryRef:`memory-v${index}`,result:{summary:id,facts:[{text:id,sourceIds:[id]}]}});
 try{
  records.push(record('one',1));await context.synchronize(store);const first=context.module.snapshot(),before=await readFile(first.contextPath);
  records.push(record('two',2));await context.synchronize(store);assert.equal(context.module.snapshot().index,2);assert.deepEqual(await readFile(first.contextPath),before);
  const snapshot=context.snapshotAt(first);assert.equal(snapshot.results.length,1);assert.equal(snapshot.results[0]!.available_at_ms,1);assert.ok(!before.toString().includes('two'));
  assert.ok(!before.toString().includes('session'));assert.equal(context.failure,null);
 }finally{await rm(root,{recursive:true,force:true});}
});
