import {test} from 'node:test';import assert from 'node:assert/strict';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
test('fixed method2 entry requires paid confirmation and cannot silently enable graph or vary flags',async()=>{
 const {method2Arguments}=await import(pathToFileURL(resolve('scripts/run-spatial-method2.mjs')).href);
 const args=method2Arguments(['public.json','features.json','--confirm-paid']);
 assert.ok(args.includes('--visit-context=sequence'));assert.ok(!args.includes('--visit-context=graph'));assert.ok(args.includes('--candidate-features=features.json'));assert.ok(args.includes('--ground-first'));assert.ok(args.includes('--short-references'));
 assert.throws(()=>method2Arguments(['public.json','features.json']),/Usage/);assert.throws(()=>method2Arguments(['public.json','features.json','--confirm-paid','--visit-context=graph']),/Usage/);
});
