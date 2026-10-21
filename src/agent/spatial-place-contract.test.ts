import {test} from 'node:test';import assert from 'node:assert/strict';
import {FixedScopePlaceGroup} from './spatial-place-contract.js';
const members=[{id:'a',atMs:1},{id:'b',atMs:2},{id:'c',atMs:3}];
const group=()=>new FixedScopePlaceGroup('g',{name:'named region',definition:'this side of a concrete boundary',boundaryRules:['exclude the other side'],sourceIds:['a','b','c']},members);
function answers(plan:ReturnType<FixedScopePlaceGroup['plan']>){return plan.pages.map((page,pageIndex)=>({groupId:'g',version:plan.version,pageIndex,currentId:plan.current.id,scopeMatch:'yes',reason:'within fixed region',memberChecks:page.map(m=>({id:m.id,relation:'compatible',evidence:'same region layout'})),sourceIds:[plan.current.id,...page.map(m=>m.id)]}));}
test('all members are paged and checked; closest-image-only admission cannot pass',()=>{
 const g=group(),p=g.plan({id:'new',atMs:4},2),a=answers(p);assert.equal(p.pages.length,2);
 assert.throws(()=>g.evaluate(p,a.slice(1)),/whole-group coverage/);assert.equal(g.snapshot().members.length,3);
 assert.equal(g.evaluate(p,a).verdict,'belongs');
});
test('one older member conflict vetoes compatible latest members; no arbitrary group drift',()=>{
 const g=group(),p=g.plan({id:'new',atMs:4}),a=answers(p);a[0]!.memberChecks[0]!.relation='conflict';
 assert.equal(g.evaluate(p,a).verdict,'different');assert.throws(()=>g.append(p,a),/conflicting/);assert.equal(g.snapshot().members.length,3);
});
test('name and scope do not change when admitted; snapshots detached, stale plans rejected',()=>{
 const g=group(),before=g.snapshot(),p=g.plan({id:'new',atMs:4}),a=answers(p);const after=g.append(p,a);
 assert.deepEqual(after.scope,before.scope);assert.equal(after.contractHash,before.contractHash);assert.equal(after.members.length,4);
 after.scope.name='mutated';assert.equal(g.snapshot().scope.name,'named region');assert.throws(()=>g.append(p,a),/Stale/);
 assert.throws(()=>g.plan({id:'future-test',atMs:3}),/causal/);
});
test('missing member and invented/future citations cannot masquerade as full coverage',()=>{
 const g=group(),p=g.plan({id:'new',atMs:4}),a=answers(p);a[0]!.memberChecks.pop();assert.throws(()=>g.evaluate(p,a),/Every group member/);
 const b=answers(p);b[0]!.sourceIds.push('future');assert.throws(()=>g.evaluate(p,b),/citation/);
});
