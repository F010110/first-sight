import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceBoundDescription} from './source-bound-description.js';
import {dialogueBackground} from './capabilities.js';
import {AdaptiveExtractionLimit} from './adaptive-extraction.js';

const image=(id:string)=>({id,path:'unused.png',sha256:'unused',direction:'front'});
test('source-bound text uses only the exact single-observation request envelope',()=>{
 const result=sourceBoundDescription('a',[image('a'),image('a'),image('a')],'可见街道与砖墙，暗处未知。');
 assert.deepEqual(result.sourceIds,['a']);assert.deepEqual(result.facts[0]!.sourceIds,['a']);
 assert.equal(result.facts[0]!.text,'可见街道与砖墙，暗处未知。');
 assert.throws(()=>sourceBoundDescription('a',[image('a'),image('b')],'scene'),/exactly one/);
 for(const value of [{claims:['broken']},'{"claims":["broken"]}','',null])assert.throws(()=>sourceBoundDescription('a',[image('a')],value));
});
test('old dialogue provenance and aliases cannot leak into a fresh evidence namespace',()=>{
 const context=dialogueBackground([{id:'message',role:'assistant',atMs:1,text:'旧观察 observation-000163 (S0) 与 memory-v3',source:'historical',sourceIds:['observation-000163'],taskId:'private-task'}]);
 assert.doesNotMatch(context,/observation-000163|S0|memory-v3|sourceIds|taskId|private-task/);
 assert.match(context,/旧观察/);
});
test('eager extraction uses available independent capacity immediately, congestion still holds it at one',()=>{
 const controller=new AdaptiveExtractionLimit(2,true);
 assert.equal(controller.choose(1,0,0,1000),2);controller.congested(2000);
 assert.equal(controller.choose(100,10000,0,3000),1);assert.equal(controller.choose(1,0,0,32001),2);
 assert.equal(new AdaptiveExtractionLimit(1,true).choose(100,10000,0,100000),1);
});
