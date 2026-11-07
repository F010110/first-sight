import test from 'node:test';
import assert from 'node:assert/strict';
import {groupedMemoryReport,type WindowVerdict} from './grouped-memory-report.js';

const annotation=(segmentId:string,placeId:string)=>({segmentId,placeId,facilityId:placeId,description:segmentId,visibility:'clear',boundaryUncertain:false});
const bundle=(obs:string[],windows:Array<{version:number;members:string[];placeId:string|null;name?:string}>,reference:Array<{id:string;annotation:any}>,coverage={skippedWindows:0,fullCoverage:true})=>({
 schema:'holistic-memory-audit-bundle-v1',run:'synthetic',hashes:{},complete:{},observations:obs.map((id,i)=>({id,atMs:i*2000,views:[],facts:{}})),
 states:windows.map(w=>({version:w.version,atMs:0,memberIds:w.members,assessment:{location:{placeId:w.placeId,name:w.name??w.placeId,status:w.placeId?'known':'unknown'}}})),
 claims:[],places:windows.filter(w=>w.placeId).map(w=>({id:w.placeId,name:w.name??w.placeId})),visits:[],revisions:[],reference,integrity:{},scope:{referenceAuthority:'test',referenceLimitations:[],coverage}
}) as any;
const sample=(segments:Array<{id:string;start:number;end:number;placeId:string}>)=>({segments:segments.map(s=>({id:s.id,startIndex:s.start,endIndex:s.end,startMs:s.start*2000,endMs:s.end*2000,placeId:s.placeId,title:s.placeId,kind:'測試'}))});
const verdict=(version:number,identity:WindowVerdict['identity']['verdict']='supported'):WindowVerdict=>({version,identity:{verdict:identity},currentReason:{verdict:'supported'},windowScope:{verdict:'supported'}});

test('per-group scores aggregate judged windows over one reference visit and keep skipped observations as gaps',()=>{
 const ref=[...['o1','o2','o3'].map(id=>({id,annotation:annotation('segment-A','a')})),...['o4','o5','o6'].map(id=>({id,annotation:annotation('segment-B','b')}))];
 const report=groupedMemoryReport(
  bundle(['o1','o2','o3','o4','o5','o6'],[
   {version:1,members:['o1','o2','o3'],placeId:'pA',name:'place A'},
   {version:2,members:['o4','o6'],placeId:'pB',name:'place B'}],ref),
  sample([{id:'segment-A',start:0,end:2,placeId:'a'},{id:'segment-B',start:3,end:5,placeId:'b'}]),
  [verdict(1),verdict(2,'contradicted')]);
 assert.equal(report.groups.length,2);
 assert.equal(report.groups[0]!.segmentId,'segment-A');
 assert.equal(report.groups[0]!.identityScore,100);
 assert.equal(report.groups[0]!.judged,3);assert.equal(report.groups[0]!.skipped,0);
 assert.equal(report.groups[1]!.identityScore,0);
 assert.equal(report.groups[1]!.judged,2);assert.equal(report.groups[1]!.skipped,1);
 assert.equal(report.coverage.judgedObservations,5);assert.equal(report.coverage.skippedObservations,1);
 assert.equal(report.summary.meanGroupScore,50);assert.equal(report.summary.medianGroupScore,50);
 assert.deepEqual(report.summary.windowIdentity,{supported:1,uncertain:0,contradicted:1});
});

test('a candidate place used for two reference places is a merge, and separate visits reuse or split identity',()=>{
 const ref=[
  ...['o1','o2'].map(id=>({id,annotation:annotation('segment-A','a')})),
  ...['o3','o4'].map(id=>({id,annotation:annotation('segment-B','b')})),
  ...['o5','o6'].map(id=>({id,annotation:annotation('segment-C','a')}))];
 const windows=[
  {version:1,members:['o1','o2'],placeId:'pSame',name:'same place'},
  {version:2,members:['o3','o4'],placeId:'pSame',name:'same place'},
  {version:3,members:['o5','o6'],placeId:'pOther',name:'other place'}];
 const segments=[{id:'segment-A',start:0,end:2,placeId:'a'},{id:'segment-B',start:2,end:4,placeId:'b'},{id:'segment-C',start:4,end:6,placeId:'a'}];
 // pSame covers reference places a and b -> merge; segment revision A and C reuse pSame -> revisited.
 const merged=groupedMemoryReport(bundle(['o1','o2','o3','o4','o5','o6'],windows,ref),sample(segments),[verdict(1),verdict(2),verdict(3)]);
 assert.equal(merged.merges.length,1);
 assert.ok(merged.merges.some(m=>m.referencePlaces.includes('a')&&m.referencePlaces.includes('b')));
 assert.equal(merged.groups[0]!.merged,true);
 assert.equal(merged.revisits.find(r=>r.referencePlace==='a')!.verdict,'different');
 const reused=groupedMemoryReport(
  bundle(['o1','o2','o3','o4','o5','o6'],[
   {version:1,members:['o1','o2'],placeId:'pA',name:'A'},
   {version:2,members:['o3','o4'],placeId:'pB',name:'B'},
   {version:3,members:['o5','o6'],placeId:'pA',name:'A'}],ref),
  sample(segments),[verdict(1),verdict(2),verdict(3)]);
 assert.equal(reused.merges.length,0);
 assert.equal(reused.revisits.find(r=>r.referencePlace==='a')!.verdict,'reused');
});

test('a missing or duplicate judge verdict is refused instead of silently scored',()=>{
 const ref=['o1','o2'].flatMap(id=>[{id,annotation:annotation('segment-A','a')}]);
 const b=bundle(['o1','o2'],[{version:1,members:['o1','o2'],placeId:'pA',name:'A'}],ref);
 assert.throws(()=>groupedMemoryReport(b,sample([{id:'segment-A',start:0,end:1,placeId:'a'}]),[]),/one judge verdict/);
 assert.throws(()=>groupedMemoryReport(b,sample([{id:'segment-A',start:0,end:1,placeId:'a'}]),[verdict(1),verdict(1)]),/one judge verdict/);
});
