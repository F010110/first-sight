import {test} from "node:test";
import assert from "node:assert/strict";
import {proposeCoherentContextChanges} from "./coherent-context-changes.js";
import type {SegmentLink} from "./segment-association.js";
const input=[1,2,3,4].map(i=>({id:`o${i}`,atMs:i*1000,frames:[`f${i}`]}));
const edge=(a:number,b:number,confidence:number):SegmentLink=>({id:`e${a}-${b}`,a:`o${a}`,b:`o${b}`,confidence,kind:"visual",source:"bidirectional multi-bearing fixture",frames:[`f${a}`,`f${b}`]});
const evidence=[edge(1,2,1),edge(3,4,1),edge(1,3,0),edge(1,4,0),edge(2,3,0),edge(2,4,0)];
test("v2 freezes mixed one-link bridges until later departure confirmation",()=>{
	const rows=[1,2,3,4,5,6].map(i=>({id:`o${i}`,atMs:i*500,frames:[`f${i}`]}));
	const links=[edge(1,2,1),edge(3,4,1),edge(1,3,0),edge(1,4,.5),edge(2,3,0),edge(2,4,0),edge(5,6,1),edge(1,5,0),edge(1,6,0),edge(2,5,0),edge(2,6,0)];
	const r=proposeCoherentContextChanges(rows,links,4000,"updating-context-v2");
	assert.equal(r.boundaries[0]!.beforeObservationId,"o5");
	assert.equal(proposeCoherentContextChanges(rows.slice(0,5),links,4000,"updating-context-v2").boundaries.length,0);
});
test("updating context advances with positive observations then confirms departure causally",()=>{
	const rows=[1,2,3,4,5].map(i=>({id:`o${i}`,atMs:i*500,frames:[`f${i}`]}));
	const links=[edge(1,2,1),edge(2,3,1),edge(1,3,1),edge(4,5,1),edge(2,4,0),edge(2,5,0),edge(3,4,0),edge(3,5,0)];
	assert.equal(proposeCoherentContextChanges(rows,links,4000,"updating-context").boundaries[0]!.beforeObservationId,"o4");
	assert.equal(proposeCoherentContextChanges(rows.slice(0,4),links,4000,"updating-context").boundaries.length,0);
	assert.equal(proposeCoherentContextChanges(rows,links.slice(0,-1),4000,"updating-context").boundaries.length,0);
});
test("positive old/new cohorts and sustained measured departure propose a reversible context cut",()=>{
	const r=proposeCoherentContextChanges(input,evidence,4000);
	assert.equal(r.boundaries[0]!.beforeObservationId,"o3");
	assert.equal(r.diagnostics[0]!.confirmedAtObservationId,"o4");
});
test("missing matches and isolated weak image are not departure evidence",()=>{
	assert.equal(proposeCoherentContextChanges(input,evidence.slice(0,2),4000).boundaries.length,0);
	assert.equal(proposeCoherentContextChanges(input,evidence.map(e=>e.a==="o3"&&e.b==="o4"?{...e,confidence:0}:e),4000).boundaries.length,0);
});
test("positive old overlap blocks departure and hiatus cannot accumulate cohorts",()=>{
	assert.equal(proposeCoherentContextChanges(input,[...evidence,edge(1,4,.8)],4000).boundaries.length,0);
	const gap=structuredClone(input);gap[2]!.atMs=20000;gap[3]!.atMs=21000;
	assert.equal(proposeCoherentContextChanges(gap,evidence,4000).boundaries.length,0);
});
test("weak startup recovers using later disjoint positive anchors, legacy unchanged",()=>{
	const rows=[1,2,3,4,5,6].map(i=>({id:`o${i}`,atMs:i*1000,frames:[`f${i}`]}));
	const links=[edge(1,2,0),edge(3,4,1),edge(5,6,1),edge(3,5,0),edge(3,6,0),edge(4,5,0),edge(4,6,0)];
	assert.equal(proposeCoherentContextChanges(rows,links,4000).boundaries.length,0);
	assert.equal(proposeCoherentContextChanges(rows,links,4000,"recover-weak-anchors").boundaries[0]!.beforeObservationId,"o5");
	assert.equal(proposeCoherentContextChanges(rows.slice(0,5),links,4000,"recover-weak-anchors").boundaries.length,0);
	assert.equal(proposeCoherentContextChanges(rows,links.slice(0,3),4000,"recover-weak-anchors").boundaries.length,0);
	const gap=structuredClone(rows);gap[4]!.atMs=20000;gap[5]!.atMs=21000;
	assert.equal(proposeCoherentContextChanges(gap,links,4000,"recover-weak-anchors").boundaries.length,0);
});
