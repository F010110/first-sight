import test from 'node:test';import assert from 'node:assert/strict';import {derivePositionStandard} from './position-standard.js';
test('derived cases use clear interior samples and distinguish region identity from facility hierarchy',()=>{
 const frames=Array.from({length:9},(_,index)=>({id:`f${index}`,index,atMs:index*30000,annotation:{placeId:index<3?'a':index<6?'b':'a',facilityId:'building',visibility:'clear',boundaryUncertain:index%3!==1}}));
 const segments=[0,1,2].map(i=>({id:`s${i}`,startIndex:i*3,endIndex:i*3+2,kind:'室内'}));
 const d=derivePositionStandard({frames,segments});assert.equal(d.coreFrames,3);assert.ok(d.cases.every(c=>c.referenceIndex%3===1&&c.currentIndex%3===1));
 assert.equal(d.cases.find(c=>c.kind==='positive')?.expected,'same-region');assert.ok(d.cases.some(c=>c.expected==='same-facility-different-region'));
});
