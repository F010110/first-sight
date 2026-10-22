import {test} from 'node:test';
import assert from 'node:assert/strict';
import {liveProvider} from './live-provider.js';
test('continuous live provider keeps a single ledger within an hour and rolls only at the time boundary',async()=>{
 let now=1000;const windows:string[]=[];const p=liveProvider('root',.5,()=>now,(root,calls,usd)=>{windows.push(root);assert.equal(usd,.5);return async()=>({root});});
 const input={phase:'identity' as const,prompt:'',data:{},images:[]};
 await p(input);await p(input);now+=3599999;await p(input);assert.equal(windows.length,1);
 now++;await p(input);assert.equal(windows.length,2);assert.match(windows[1]!,/hour-00001/);
});
