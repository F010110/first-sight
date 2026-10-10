import assert from "node:assert/strict";
import { test } from "node:test";
import { ExperienceGraph } from "./experience-graph.js";
import { groupExperience } from "./experience-grouping.js";
import type { CorrespondenceEvidence } from "./experience-association.js";
const pair=(a:string,b:string,score:number):CorrespondenceEvidence=>({a,b,bearings:[score,score],backwardBearings:[score,score],source:"test"});
test("optional groups preserve visual identities, pending evidence and originals",()=>{
	const graph=new ExperienceGraph();for(const [atMs,id] of ["a","b","c","d","e"].entries())graph.addObservation({id,atMs,visitId:"v",frames:[id],objects:[],description:"",semanticSource:null});
	graph.createNode(["a","b"],"seed");graph.createNode(["c","d"],"seed");const before=graph.getState();
	const result=groupExperience(before,[pair("a","c",0.5),pair("b","d",0.5)],0.4);
	assert.equal(result.groups.length,2);assert.equal(result.groups[0]!.observationIds.length,4);
	assert.equal(result.groups.flatMap(group=>group.observationIds).length,5);assert.deepEqual(graph.getState(),before);
});
test("complete-link refuses transitive group drift and a single strong bearing",()=>{
	const graph=new ExperienceGraph();for(const [atMs,id] of ["a","b","c"].entries())graph.addObservation({id,atMs,visitId:"v",frames:[id],objects:[],description:"",semanticSource:null});
	assert.equal(groupExperience(graph.getState(),[pair("a","b",0.5),pair("b","c",0.5)],0.4).groups.length,2);
	assert.equal(groupExperience(graph.getState(),[{a:"a",b:"b",bearings:[1,0,0],source:"test"}],0.4).groups.length,3);
});
