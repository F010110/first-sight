import test from 'node:test';
import assert from 'node:assert/strict';
import {projectRecentSourceContext} from './source-context-projection.js';

test('candidate source projection removes generated guesses without rewriting observations or stored history',()=>{
 const messages:any[]=[{role:'toolResult',toolName:'record_context',toolCallId:'x',timestamp:1,isError:false,content:[{type:'text',text:JSON.stringify({memoryRef:'memory-v1',observationId:'old',atMs:1,update:{observations:['原始观察'],summary:'推测身份',hypotheses:['过强猜测'],unresolved:['过期疑问']}})}]},{role:'user',content:'新观察',timestamp:2}];
 const before=JSON.stringify(messages),projected=JSON.stringify(projectRecentSourceContext(messages,2));
 assert.ok(projected.includes('原始观察'));assert.ok(projected.includes('新观察'));
 assert.ok(!projected.includes('过强猜测'));assert.ok(!projected.includes('过期疑问'));
 assert.equal(JSON.stringify(messages),before);assert.throws(()=>projectRecentSourceContext(messages,0));
});
