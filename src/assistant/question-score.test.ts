import {test} from 'node:test';
import assert from 'node:assert/strict';
import {questionUtility,compareBaseline} from './question-score.js';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
test('baseline scoring keeps every execution failure and gates semantic credit on actual evidence',()=>{
 const valid={completed:true,delivered:true,answerable:true,abstained:false,referenceSatisfied:true,invalidCitations:false,credit:1,harm:0};
 assert.equal(questionUtility(valid),1);
 for(const change of [{completed:false},{delivered:false},{referenceSatisfied:false},{invalidCitations:true},{abstained:true},{harm:1}])assert.equal(questionUtility({...valid,...change}),0);
 assert.equal(questionUtility({...valid,credit:.5}),.5);assert.equal(questionUtility({...valid,harm:.25}),1);
 assert.equal(questionUtility({...valid,answerable:false,abstained:true,referenceSatisfied:false}),1);
 assert.equal(questionUtility({...valid,answerable:false}),0);
});
test('baseline acceptance is paired per task, not an aggregate that hides lost capabilities',()=>{
 const baseline=Array.from({length:90},(_,i)=>({id:String(i),utility:i===0?0:1,harm:0})),same=structuredClone(baseline);
 assert.equal(compareBaseline(same,baseline).noRegression,true);
 same[0]!.utility=1;same[1]!.utility=0;const result=compareBaseline(same,baseline);assert.equal(result.noRegression,false);assert.equal(result.losses[0]!.id,'1');assert.equal(result.gains[0]!.id,'0');
 assert.throws(()=>compareBaseline(same.slice(1),baseline));
});
test('frozen original90 utility retains the released 96.67 primary score',{skip:!existsSync('run/inspect-repair-full90-v1/full-grading/grades.jsonl')},async()=>{
 const baseline=(await readFile('run/inspect-repair-full90-v1/full-grading/grades.jsonl','utf8')).trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(baseline.length,90);assert.ok(Math.abs(baseline.reduce((sum,g)=>sum+g.utility*100,0)/90-96.6666666667)<1e-8);assert.equal(compareBaseline(baseline,baseline).noRegression,true);
});
