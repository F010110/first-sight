// Pure import-contract tests in a stub DOM; not a real-browser interaction test.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const script=readFileSync(new URL('./school_memory_review.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function context(){
 const elements=new Map();
 const sandbox={document:{getElementById(id){if(!elements.has(id))elements.set(id,{addEventListener(){}});return elements.get(id)}},window:{addEventListener(){}},fetch:()=>new Promise(()=>{}),console};
 const ctx=vm.createContext(sandbox);vm.runInContext(script,ctx);
 vm.runInContext(`data={datasetId:'school',fingerprint:'v1',issues:[{id:'q'}]}`,ctx);
 return ctx;
}
test('review imports require same dataset and frozen fingerprint',()=>{
 const ctx=context();
 assert.throws(()=>vm.runInContext(`validateImport({protocol:'school-human-review-v1',datasetId:'other',fingerprint:'v1',records:{}})`,ctx));
 assert.throws(()=>vm.runInContext(`validateImport({protocol:'school-human-review-v1',datasetId:'school',fingerprint:'v2',records:{}})`,ctx));
});
test('unknown issue IDs and invalid statuses are rejected before local storage writes',()=>{
 const ctx=context();
 for(const record of [{other:{status:'pending',cause:'',notes:'',updatedAt:new Date().toISOString()}},{q:{status:'invented',cause:'',notes:'',updatedAt:new Date().toISOString()}}]){
  ctx.doc={protocol:'school-human-review-v1',datasetId:'school',fingerprint:'v1',records:record};
  assert.throws(()=>vm.runInContext('validateImport(doc)',ctx));
 }
});
test('notes remain plain text and valid review metadata is retained',()=>{
 const ctx=context();
 ctx.doc={protocol:'school-human-review-v1',datasetId:'school',fingerprint:'v1',records:{q:{status:'disputed',cause:'label',notes:'<script>not executable</script>',updatedAt:new Date().toISOString()}}};
 assert.equal(vm.runInContext('validateImport(doc).q.notes',ctx),ctx.doc.records.q.notes);
});
