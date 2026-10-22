import {test} from 'node:test';import assert from 'node:assert/strict';
import {SpatialCandidateRecall} from './spatial-candidate-recall.js';
const f=(id:string,n:number)=>({id,features:Array.from({length:3},()=>Array(72).fill(n))});
test('recall unions recent visits with visually matching old places under fixed candidate cap',()=>{
 const rows=[f('now',0),...Array.from({length:20},(_,i)=>f('m'+i,i/20))];const recall=new SpatialCandidateRecall(rows,2,2);
 const groups=rows.slice(1).map((r,i)=>({id:'g'+i,members:[{id:r.id,atMs:i}]}));
 const r=recall.select({id:'now',atMs:30},groups);assert.deepEqual(r.groupIds,['g19','g18','g0','g1']);assert.equal(r.omittedGroups,16);
});
test('deduplication, historical members and causality are preserved',()=>{
 const recall=new SpatialCandidateRecall([f('q',0),f('old',0),f('new',1)],1,1);
 const r=recall.select({id:'q',atMs:4},[{id:'p',members:[{id:'old',atMs:1},{id:'new',atMs:3}]}]);assert.deepEqual(r.groupIds,['p']);assert.equal(r.visual[0]!.matchedId,'old');
 assert.throws(()=>recall.select({id:'q',atMs:3},[{id:'p',members:[{id:'new',atMs:3}]}]),/Noncausal/);
 assert.throws(()=>recall.select({id:'missing',atMs:4},[]),/Missing/);
});
