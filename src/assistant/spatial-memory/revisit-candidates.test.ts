import test from 'node:test';
import assert from 'node:assert/strict';
import {selectRevisitCandidates,summarizeRevisitRecall,revisitRecallUnavailable,selectRevisitImagePairs} from './revisit-candidates.js';
import type {RevisitPlace} from './revisit-candidates.js';

const places:RevisitPlace[]=[
 {placeId:'old',name:'五金店前人行道',members:[{observationId:'a1',atMs:1000,path:'a1.png',sha256:'1',direction:'front'},{observationId:'a2',atMs:5000,path:'a2.png',sha256:'2',direction:'left'}]},
 {placeId:'previous',name:'店内',members:[{observationId:'b1',atMs:9000,path:'b1.png',sha256:'3',direction:'front'}]}
];
const result=(entries:Array<{placeId:string;observationId:string;inliers:number;similarity:number}>)=>({ok:true,best:null,nearest:null,results:entries.map(e=>({...e,path:e.observationId+'.png'}))});

test('visual priority preserves exact historical and middle-current camera paths rather than recency/front',()=>{
 const current=[{id:'middle',path:'middle-right.png',direction:'right',sha256:'now'}];
 const r={ok:true,best:null,nearest:null,results:[{placeId:'old',observationId:'a2',path:'a2.png',queryPath:'middle-right.png',inliers:50,similarity:.6},{placeId:'previous',observationId:'b1',path:'b1.png',queryPath:'middle-right.png',inliers:2,similarity:.9}]};
 const c=selectRevisitCandidates(places,r,null,2,3,current);
 assert.equal(c[0]!.placeId,'old');assert.equal(c[0]!.matchedPair!.current.id,'middle');
 assert.equal(c[0]!.matchedPair!.current.direction,'right');assert.equal(c[0]!.matchedPair!.historical.direction,'left');
 assert.equal(c[0]!.matchedPair!.historical.path,'a2.png');
});

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

test('dual-channel pair selection is bounded, deduplicated and retains distinct current times',()=>{
 const image=(id:string)=>({id,path:id+'.png',sha256:id,direction:'left'});
 const candidate=(placeId:string,id:string,sim:number)=>({placeId,name:placeId,matchedObservationId:placeId,matchedAtMs:0,bestInliers:1,bestSimilarity:sim,supportedMembers:1,images:[],matchedPair:{current:image(id),historical:image(placeId)},globalPair:{current:image(id),historical:image(placeId),similarity:sim}});
 const recall={status:'ok' as const,method:'sift-ransac-plus-global-layout' as const,consideredPlaces:3,excludedPreviousPlaceId:null,limit:3,error:null,note:'',candidates:[candidate('a','start',.1),candidate('b','middle',.9),candidate('c','end',.2)]};
 const pairs=selectRevisitImagePairs(recall,['start','middle','end'],3);
 assert.equal(pairs.length,3);assert.equal(pairs[0]!.placeId,'a');assert.equal(pairs[1]!.placeId,'b');assert.equal(pairs[2]!.current.id,'end');
 assert.equal(selectRevisitImagePairs(recall,['start','middle','end'],2).length,2);
 assert.throws(()=>selectRevisitImagePairs(recall,[],6));
});
