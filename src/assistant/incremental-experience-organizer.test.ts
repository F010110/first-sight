import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ThreeAgentStore,type AgentResult} from './three-agent-store.js';
import {synchronizeCommittedExperience} from './incremental-experience-organizer.js';
import {OrganizedExperienceMemory} from './organized-experience-memory.js';

test('actual committed versions and availability synchronize, reopen and reconcile missed notifications',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opencode/organizer-'));let now=100;
 const store=new ThreeAgentStore(join(dir,'source.sqlite'),()=>now),path=join(dir,'organized.sqlite');
 try{
  const image=join(dir,'original.png');await writeFile(image,'source bytes');
  const result=(id:string):AgentResult=>({summary:'地下地铁站台木椅',sourceIds:[id],facts:[{text:'木椅',sourceIds:[id]}]});
  store.archive({id:'first',atMs:0,sourceAtMs:0,frames:[image]});
  const work=store.claim('memory')!;store.commit(work,result('first'),0);
  assert.equal((await synchronizeCommittedExperience(store,path)).added,1);
  assert.equal((await synchronizeCommittedExperience(store,path)).added,0);
  now=500;store.archive({id:'second',atMs:1000,sourceAtMs:500,frames:[image]});
  store.commit(store.claim('memory')!,result('second'),1);
  assert.equal((await synchronizeCommittedExperience(store,path)).added,1);
  const memory=new OrganizedExperienceMemory(path,true);
  try{
   const facts=memory.facts({eventAtMs:1000,knownAtMs:500});
   assert.deepEqual(facts.map(f=>[f.memoryRef,f.availableAtMs,f.sourceAtMs]),[['memory-v1',100,0],['memory-v2',500,500]]);
   assert.equal(memory.facts({eventAtMs:1000,knownAtMs:100}).length,1);
   assert.equal(store.version(),2);
  }finally{memory.close();}
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
