import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const html=fs.readFileSync(new URL('./spatial_graph_review.html',import.meta.url),'utf8'),code=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function context(){const elements=new Map();const ctx=vm.createContext({document:{getElementById(id){if(!elements.has(id))elements.set(id,{});return elements.get(id)}},fetch:()=>new Promise(()=>{}),console});vm.runInContext(code,ctx);return ctx}
test('review import requires frozen graph fingerprint and known UUIDs',()=>{
 const ctx=context();ctx.value={protocol:'spatial-graph-review-notes-v1',fingerprint:'f',records:{p:{status:'possible-split',notes:'边界需核对'}}};
 assert.equal(vm.runInContext("validateRecords(value,'f',new Set(['p'])).p.notes",ctx),'边界需核对');assert.throws(()=>vm.runInContext("validateRecords(value,'other',new Set(['p']))",ctx));assert.throws(()=>vm.runInContext("validateRecords(value,'f',new Set(['different']))",ctx));
});
test('native XY projection is deterministic and does not infer a floor',()=>{
 const ctx=context();vm.runInContext('xy={minX:0,minY:0,scale:10}',ctx);assert.deepEqual(Array.from(vm.runInContext('project({xyz:[2,3,50]})',ctx)),[55,635]);
});
