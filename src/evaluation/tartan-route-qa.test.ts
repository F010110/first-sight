import {test} from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkRequest,validateBenchmarkAnswer} from './tartan-route-qa.js';
const data:any={schema:'tartan-route-qa-public-v1',headingConvention:'NED',images:{I0:{path:'private-query-frame.png',sha256:'hash',headingDeg:90,view:'left'},I1:{path:'private-reference-frame.png',sha256:'hash',headingDeg:0,view:'front'}},nodes:[{id:'A',images:['I1']}],edges:[],tasks:[]};
const task:any={id:'Q1',kind:'localization',queryImages:['I0'],candidates:['A']};
const answer={placeId:'A',path:[],turn:'unknown',abstain:false,description:'参考画面相符。',sourceIds:['I0','I1']};
test('model data has explicit per-image headings, no original paths/coordinates/gold',()=>{
 const r=benchmarkRequest(data,task);const s=JSON.stringify(r.data);
 assert.ok(s.includes('headingDeg'));assert.ok(!s.includes('private-'));assert.ok(!s.includes('gold'));assert.equal(r.images.length,2);
});
test('unknown identities and unsupported reference claims fail, semantic mistakes remain scorable',()=>{
 const r=benchmarkRequest(data,task);
 assert.deepEqual(validateBenchmarkAnswer(answer,r),answer);
 assert.throws(()=>validateBenchmarkAnswer({...answer,sourceIds:['I0']},r),/reference/);
 assert.throws(()=>validateBenchmarkAnswer({...answer,sourceIds:['I0','future']},r),/citations/);
 assert.throws(()=>validateBenchmarkAnswer({...answer,placeId:'invented'},r),/schema/);
 assert.equal(validateBenchmarkAnswer({...answer,turn:'reverse'},r).turn,'reverse');
});
