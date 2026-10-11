import { test } from "node:test";
import assert from "node:assert/strict";
import { replayVisualExperience } from "./visual-experience-pipeline.js";
import { currentExperienceGrouping } from "./current-experience-grouping.js";
const rows = (n: number) => Array.from({length:n},(_,i)=>({id:`o${i+1}`,atMs:(i+1)*1000,frames:[`f${i+1}`],motionSteps:[],boundaryEvidence:[]}));
test("chronological continuity supplies current membership despite no historical match", () => {
	const group = currentExperienceGrouping(replayVisualExperience(rows(4),[]).result.interpretation);
	assert.deepEqual(Object.values(group.assignments),Array(4).fill("current-o1"));
	assert.deepEqual(group.unassignedObservationIds,[]); assert.deepEqual(group.unrecognizedHistoricalGroupIds,["current-o1"]);
	assert.equal(group.groups[0]!.physicalScopeVerified,false);
});
test("positive context contradiction splits without requiring a tracked doorway", () => {
	const result = replayVisualExperience(rows(4),[],[{id:"different",a:"o1",b:"o3",reason:"independently supported different contexts",source:"fixture",frames:["f1","f3"]}]).result;
	assert.equal(result.continuity.boundaries.length,0);
	const groups = currentExperienceGrouping(result.interpretation);
	assert.deepEqual(groups.groups.map(group=>group.observationIds),[["o1","o2"],["o3","o4"]]);
});
test("historical matching joins supported episodes, not individual competing frames", () => {
	const input=rows(6),cuts=[3,5].map(i=>({id:`cut${i}`,beforeObservationId:`o${i}`,source:"automatic" as const,reason:"positive-context-fixture",frames:[`f${i}`]}));
	const links=[[1,5],[2,6]].map(([a,b],i)=>({id:`link${i}`,a:`o${a}`,b:`o${b}`,kind:"geometric" as const,confidence:1,source:"fixture",frames:[`f${a}`,`f${b}`]}));
	const result=replayVisualExperience(input,links,[],undefined,cuts).result;
	const group=currentExperienceGrouping(result.interpretation);
	assert.equal(group.groups.length,2);
	assert.deepEqual(group.groups[0]!.observationIds,["o1","o2","o5","o6"]);
	assert.equal(group.groups[0]!.historicalIdentityStatus,"supported-hypothesis");
});
test("retracting a context contradiction revises membership, not original observations", () => {
	const input=rows(4),before=structuredClone(input);
	const split=replayVisualExperience(input,[],[{id:"e",a:"o1",b:"o3",reason:"different context",source:"fixture",frames:["f1"]}]);
	assert.equal(currentExperienceGrouping(split.result.interpretation).groups.length,2);
	assert.equal(currentExperienceGrouping(replayVisualExperience(input,[]).result.interpretation).groups.length,1);
	assert.deepEqual(input,before);
});
test("recording gap isolates contexts while skipped motion has no membership veto",()=>{
	const input=rows(3);input[1]!.atMs=20000;input[2]!.atMs=21000;
	const grouping=currentExperienceGrouping(replayVisualExperience(input,[]).result.interpretation);
	assert.deepEqual(grouping.groups.map(group=>group.observationIds),[["o1"],["o2","o3"]]);
	assert.deepEqual(grouping.unassignedObservationIds,[]);
});
