import {test} from "node:test";
import assert from "node:assert/strict";
import {proposeRetrospectiveRepairs as propose,applyRetrospectiveRepairs as apply} from "./retrospective-group-repair.js";
import type {SegmentLink} from "./segment-association.js";
const order=["a","b","c","d","e","f"];
const grouping={assignments:{a:"old",b:"old",c:"old",d:"old",e:"new",f:"new"},groups:[{id:"old",observationIds:["a","b","c","d"]},{id:"new",observationIds:["e","f"]}]};
const link=(a:string,b:string,confidence:number):SegmentLink=>({id:`${a}-${b}`,a,b,confidence,kind:"visual",source:"fixture",frames:[a,b]});
const evidence=[link("a","b",1),link("e","f",1),link("c","d",1),...['c','d'].flatMap(id=>[link(id,"a",.1),link(id,"b",.1),link(id,"e",.8),link(id,"f",.8)])];
test("later coherent evidence can reassign an earlier wrong suffix without editing input",()=>{
	const before=structuredClone(grouping),repairs=propose(order,grouping,evidence);
	assert.deepEqual(repairs[0]!.observationIds,["c","d"]);assert.equal(repairs[0]!.confirmedAtObservationId,"f");
	assert.deepEqual(apply(grouping,repairs).groups[1]!.observationIds,["c","d","e","f"]);
	assert.deepEqual(grouping,before);
});
test("missing comparisons, unsupported later cohort and competing old support abstain",()=>{
	assert.equal(propose(order,grouping,evidence.filter(e=>e.id!=="d-f")).length,0);
	assert.equal(propose(order,grouping,evidence.map(e=>e.id==="e-f"?{...e,confidence:0}:e)).length,0);
	assert.equal(propose(order,grouping,[...evidence,link("d","a",.9)]).length,0);
});
test("future evidence is rejected and stale/overlapping repairs are atomic",()=>{
	assert.throws(()=>propose(order.slice(0,5),grouping,evidence));
	const repairs=propose(order,grouping,evidence),before=structuredClone(grouping);
	assert.throws(()=>apply(grouping,[...repairs,...repairs]));assert.deepEqual(grouping,before);
});
test("matching target entry alone cannot override contradictory later target views",()=>{
	const extended={assignments:{...grouping.assignments,g:"new",h:"new"},groups:[grouping.groups[0]!,{id:"new",observationIds:["e","f","g","h"]}]};
	const links=[...evidence,link("g","h",1),...['c','d'].flatMap(id=>[link(id,"g",.05),link(id,"h",.05)])];
	assert.equal(propose([...order,"g","h"],extended,links).length,0);
});
