import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ThreeAgentStore,evidenceBasis,type AgentResult} from './three-agent-store.js';
import {memoryContext,validateAgentEvidence} from './three-agent-evidence.js';
import {aliasedSpatialRequest} from '../agent/spatial-reference-aliases.js';

const result=(id:string):AgentResult=>({facts:[{text:'visible room',sourceIds:[id]}],summary:'room hypothesis',sourceIds:[id]});
const row=(id:string,atMs:number)=>({id,atMs,frames:[id+'.png']});

test('old transitive raw citation is rejected, not silently removed or promoted',()=>{
 const answer:AgentResult={facts:[{text:'history',sourceIds:['old-not-delivered']}],summary:'history',sourceIds:['current','old-not-delivered']};
 const frozen=structuredClone(answer);
 assert.throws(()=>validateAgentEvidence(answer,['current','recent']),/Undelivered/);
 assert.deepEqual(answer,frozen);
});

test('fact citations must also be delivered even when top-level list hides them',()=>{
 assert.throws(()=>validateAgentEvidence({facts:[{text:'x',sourceIds:['hidden']}],summary:'x',sourceIds:['current']},['current']),/fact evidence/);
});

test('evidence category is derived from namespaces, not another model classification task',()=>{
 assert.equal(evidenceBasis({sourceIds:['current','reference'],memoryRefs:[]}),'visual');
 assert.equal(evidenceBasis({sourceIds:[],memoryRefs:['memory-v1']}),'memory');
 assert.equal(evidenceBasis({sourceIds:['current'],memoryRefs:['memory-v1']}),'mixed');
 assert.throws(()=>evidenceBasis({sourceIds:[],memoryRefs:[]}));
});

test('memory context exports version references but not nested raw provenance',()=>{
 const context=memoryContext({lane:'memory',observation_id:'recent',source_at_ms:2,available_at_ms:3,version:2,memoryRef:'memory-v2',result:{facts:[{text:'previous event',sourceIds:['old-not-delivered']}],summary:'history',sourceIds:['recent','old-not-delivered']},body:undefined});
 assert.equal(context.memoryRef,'memory-v2');assert.equal(context.evidenceKind,'historical-interpretation-not-direct-vision');
 assert.equal(JSON.stringify(context).includes('old-not-delivered'),false);
});

test('indirect memory retains its original provenance without claiming direct vision',async()=>{
 const root=await mkdtemp(join(tmpdir(),'memory-provenance-'));const store=new ThreeAgentStore(join(root,'memory.sqlite'));
 try{
  store.archive(row('old',1));const a=store.claim('memory')!;store.commit(a,result('old'),0);
  store.archive(row('recent',2));const b=store.claim('memory')!;
  const mixed:AgentResult={facts:[{text:'current image visible',basis:'visual',sourceIds:['recent']},{text:'prior event is recorded, identity still uncertain',basis:'mixed',sourceIds:['recent'],memoryRefs:['memory-v1']}],summary:'new image plus historical interpretation',sourceIds:['recent'],memoryRefs:['memory-v1']};
  validateAgentEvidence(mixed,['recent'],['memory-v1']);store.commit(b,mixed,1);
  store.archive(row('current',3));const c=store.claim('memory')!;
  const indirect:AgentResult={facts:[{text:'current image is inconclusive',basis:'visual',sourceIds:['current']},{text:'historical interpretation, not reobserved',basis:'memory',sourceIds:[],memoryRefs:['memory-v2']}],summary:'history, current unresolved',sourceIds:['current'],memoryRefs:['memory-v2']};
  validateAgentEvidence(indirect,['current'],['memory-v2']);store.commit(c,indirect,2);
  assert.deepEqual(store.memoryEvidence('memory-v2',3).result.memoryRefs,['memory-v1']);
  assert.deepEqual(store.memoryEvidence('memory-v1',3).result.sourceIds,['old']);
  assert.deepEqual(store.snapshot(3).results.at(-1)!.result.sourceIds,['current']);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});

test('unknown, unprovided, future and wrongly typed provenance fail closed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'memory-provenance-'));const store=new ThreeAgentStore(join(root,'memory.sqlite'));
 try{
  store.archive(row('old',1));store.commit(store.claim('memory')!,result('old'),0);
  const bad:AgentResult={facts:[{text:'not direct',basis:'visual',sourceIds:[],memoryRefs:['memory-v1']}],summary:'x',sourceIds:['old'],memoryRefs:['memory-v1']};
  assert.throws(()=>store.validate(bad,2),/basis/);
  assert.throws(()=>validateAgentEvidence({...result('old'),memoryRefs:['memory-v1']},['old']),/Undelivered memory/);
  assert.throws(()=>store.memoryEvidence('memory-v1',1),/Future/);
  assert.throws(()=>store.memoryEvidence('memory-v999',2),/Unknown/);
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});

test('request-local aliases cover whitelists without rewriting memory version identity',async()=>{
 const request=aliasedSpatialRequest(async input=>{
  const data=input.data as any;
  assert.equal(data.current.id,'S0');assert.deepEqual(data.allowedSourceIds,['S0','S1']);assert.deepEqual(data.rawFallbackIds,['S1']);
  assert.deepEqual(data.allowedMemoryRefs,['memory-v1']);
  return {sourceIds:['S0','S1'],memoryRefs:['memory-v1'],facts:[{text:'x',basis:'mixed',sourceIds:['S0'],memoryRefs:['memory-v1']}]};
 });
 const answer=await request({phase:'identity',prompt:'test',data:{current:{id:'observation-000001'},allowedSourceIds:['observation-000001','observation-000033'],rawFallbackIds:['observation-000033'],allowedMemoryRefs:['memory-v1']},images:['observation-000001','observation-000033'].map(id=>({id,direction:'front',path:'unused.png',sha256:'0'.repeat(64)}))}) as any;
 assert.deepEqual(answer.sourceIds,['observation-000001','observation-000033']);assert.deepEqual(answer.memoryRefs,['memory-v1']);
});
