import test from 'node:test';
import assert from 'node:assert/strict';
import {applyUserAcceptance} from './reference-acceptance.js';

const sample=()=>({
 id:'s',frames:[0,1,2,3].map(i=>({id:'f'+i,atMs:i*1000,sourceAtMs:i*500,annotation:{segmentId:i<2?'a':'b',placeId:i<2?'A':'B',facilityId:i<2?'A':'B',description:i<2?'A':'B',visibility:'clear',boundaryUncertain:i===2}})),
 segments:[{id:'a',startIndex:0,endIndex:1,startMs:0,endMs:1000,sourceStartMs:0,sourceEndMs:500,title:'A'},{id:'b',startIndex:2,endIndex:3,startMs:2000,endMs:3000,sourceStartMs:1000,sourceEndMs:1500,title:'B'}],
});
const acceptance={schema:'unioncity-annotation-acceptance-v1',sampleId:'s',overallAccepted:true,date:'2026-11-01',corrections:[{segmentId:'b',presentationStartMs:3000,sourceStartMs:1500,label:'B'}],remainingAnnotations:'user accepted; not independent gold'};

test('an accepted correction moves frames to the preceding segment without mutating the published sample',()=>{
 const original=sample(),{sample:accepted,applied}=applyUserAcceptance(original,acceptance as any);
 assert.equal(original.frames[2]!.annotation.segmentId,'b');
 assert.equal(accepted.frames[2]!.annotation.segmentId,'a');
 assert.equal(accepted.frames[2]!.annotation.placeId,'A');
 assert.equal(accepted.frames[3]!.annotation.segmentId,'b');
 assert.equal(accepted.segments[0]!.endIndex,2);assert.equal(accepted.segments[0]!.endMs,2000);
 assert.equal(accepted.segments[1]!.startIndex,3);assert.equal(accepted.segments[1]!.startMs,3000);assert.equal(accepted.segments[1]!.sourceStartMs,1500);
 assert.deepEqual(applied[0]!.movedFrames,['f2']);assert.equal(applied[0]!.previousSegmentId,'a');
 assert.equal(accepted.userAcceptance.sampleId,'s');assert.match(accepted.userAcceptance.note,/user accepted/);
});

test('an acceptance for another sample or a backward start is refused',()=>{
 assert.throws(()=>applyUserAcceptance(sample(),{...acceptance,sampleId:'other'} as any),/sampleId/);
 assert.throws(()=>applyUserAcceptance(sample(),{...acceptance,corrections:[{segmentId:'b',presentationStartMs:0}]} as any),/backwards/);
 assert.throws(()=>applyUserAcceptance(sample(),{...acceptance,overallAccepted:false} as any),/accepted/);
});
