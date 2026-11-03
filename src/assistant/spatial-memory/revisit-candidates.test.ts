import test from 'node:test';
import assert from 'node:assert/strict';
import {selectRevisitCandidates,summarizeRevisitRecall,revisitRecallUnavailable} from './revisit-candidates.js';
import type {RevisitPlace} from './revisit-candidates.js';

const places:RevisitPlace[]=[
 {placeId:'old',name:'五金店前人行道',members:[{observationId:'a1',atMs:1000,path:'a1.png',sha256:'1',direction:'front'},{observationId:'a2',atMs:5000,path:'a2.png',sha256:'2',direction:'left'}]},
 {placeId:'previous',name:'店内',members:[{observationId:'b1',atMs:9000,path:'b1.png',sha256:'3',direction:'front'}]}
];
const result=(entries:Array<{placeId:string;observationId:string;inliers:number;similarity:number}>)=>({ok:true,best:null,nearest:null,results:entries.map(e=>({...e,path:e.observationId+'.png'}))});

test('revisit recall proposes older places, excludes the immediately previous place and keeps matched source provenance',()=>{
 const candidates=selectRevisitCandidates(places,result([{placeId:'previous',observationId:'b1',inliers:99,similarity:0.99},{placeId:'old',observationId:'a2',inliers:29,similarity:0.74}]),'previous',2);
 assert.equal(candidates.length,1);assert.equal(candidates[0]!.placeId,'old');assert.equal(candidates[0]!.matchedObservationId,'a2');
 assert.equal(candidates[0]!.images[0]!.id,'a2');assert.equal(candidates[0]!.images[0]!.sha256,'2');assert.equal(candidates[0]!.supportedMembers,1);
});

test('failed visual recall is explicit and cannot be reported as proof that no place was seen',()=>{
 const recall=revisitRecallUnavailable(places,'previous','opencv unavailable',2);
 assert.equal(recall.status,'unavailable');assert.equal(recall.candidates.length,0);assert.match(recall.note,/not proof/);
 assert.equal(summarizeRevisitRecall(places,'previous',{ok:false,best:null,nearest:null,results:[],error:'timed out'},2).status,'unavailable');
});
