import {test} from 'node:test';import assert from 'node:assert/strict';
import {qwenNonthinkingPayload} from './qwen-provider.js';
test('strict JSON is applied only to final answers, never tool selection',()=>{
 const tool=qwenNonthinkingPayload({tools:[{type:'function'}],model:'qwen3.8-flash'},true);
 assert.equal('response_format' in tool,false);assert.equal(tool.enable_thinking,false);
 assert.deepEqual(qwenNonthinkingPayload({tools:[]},true).response_format,{type:'json_object'});
 assert.equal('response_format' in qwenNonthinkingPayload({},false),false);
 assert.equal(qwenNonthinkingPayload({tools:[{}]},true,true).tool_choice,'required');
 assert.equal('tool_choice' in qwenNonthinkingPayload({tools:[]},true,true),false);
 const final=qwenNonthinkingPayload({tools:[{}],tool_choice:'required'},true,false,true);
 assert.equal('tools' in final,false);assert.equal('tool_choice' in final,false);assert.deepEqual(final.response_format,{type:'json_object'});
});
