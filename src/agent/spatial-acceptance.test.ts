import {test} from 'node:test';import assert from 'node:assert/strict';
import {spatialAcceptance,type SpatialEvalLabel} from './spatial-acceptance.js';
const labels:SpatialEvalLabel[]=Array.from({length:3},(_,s)=>Array.from({length:20},(_,i)=>({id:`${s}-${i}`,scene:`s${s}`,split:'holdout' as const,kind:'core' as const,region:i<10?'a':'b',reviewer:'fixture-reviewer',reason:'fixture only'}))).flat();
const correct=()=>labels.map(l=>({id:l.id,placeId:l.region,status:'completed' as const}));
const revisits=Array.from({length:3},(_,s)=>[{a:`${s}-0`,b:`${s}-9`},{a:`${s}-10`,b:`${s}-19`}]).flat();
test('perfect heldout multi-scene grouping passes frozen proxy gates independent of ID names',()=>{assert.equal(spatialAcceptance(labels,correct(),revisits).passed,true);});
test('all merged, all singletons and all unknown fail instead of gaming accuracy',()=>{
 for(const mode of ['merged','singleton','unknown']){const p=correct().map(l=>({...l,placeId:mode==='merged'?'one':mode==='singleton'?l.id:null}));assert.equal(spatialAcceptance(labels,p,revisits).passed,false);}
});
test('missing and execution failures remain in denominator; boundary imprecision excluded',()=>{
 const p=correct();p.pop();const r=spatialAcceptance(labels,p,revisits);assert.equal(r.summary.missing,1);assert.ok(r.holdout.coverage!<1);assert.equal(r.passed,false);
 const boundary:SpatialEvalLabel={...labels[0]!,id:'door',kind:'boundary',region:null};
 const b=spatialAcceptance([...labels,boundary],[...correct(),{id:'door',placeId:'arbitrary',status:'completed'}],revisits);assert.equal(b.passed,true);assert.equal(b.summary.boundaries,1);
});
test('scene leakage, duplicate IDs, invented revisits and unreviewed truth are rejected',()=>{
 assert.throws(()=>spatialAcceptance([...labels,{...labels[0]!,id:'leak',split:'development'}],correct()),/leak/);
 assert.throws(()=>spatialAcceptance(labels,[...correct(),correct()[0]!]),/prediction/);
 assert.throws(()=>spatialAcceptance(labels,correct(),[{a:'0-0',b:'0-19'}]),/Revisit/);
 assert.throws(()=>spatialAcceptance([{...labels[0]!,reviewer:''}],[]),/reviewed/);
});
