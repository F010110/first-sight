import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VisualExperienceMemory } from "./visual-experience-memory.js";
import { ExperienceAssociation } from "./experience-association.js";
import { ExperienceGraph } from "./experience-graph.js";
const observation = (i: number) => ({ id: `o${i}`, atMs: i * 1000, visitId: "visit", frames: [`f${i}`], objects: ["cup"], description: "recorded cup", semanticSource: "fixture" });
const setup = () => {
	const memory = new VisualExperienceMemory();
	for (let i = 1; i <= 3; i++) memory.addObservation(observation(i));
	const id = memory.association.graph.createNode(["o1", "o2"], "fixture-supported baseline");
	return { memory, id };
};
test("new VO abstentions retain old identity, unknown objects and raw path", () => {
	const { memory, id } = setup(); const before = memory.association.getBundle();
	const result = memory.interpret({ observations: [1,2,3].map(i => ({ ...observation(i), motionSteps: [], boundaryEvidence: [] })), links: [], contradictions: [], reason: "VO unknown" });
	assert.equal(result.effective.groups[0]!.id, id);
	assert.deepEqual(memory.association.getBundle(), before);
	assert.equal(memory.searchObjects("cup").length, 3);
	assert.ok(memory.searchObjects("cup").every(row => row.historicalOnly));
	assert.deepEqual(result.effective.unresolvedObservationIds, ["o3"]);
});
test("rejection and interpretation history survive atomic load; corrupt load is nonmutating", async () => {
	const { memory, id } = setup();
	memory.reject("o1", id, { source: "fixture", reason: "explicit contradiction" });
	memory.interpret({ observations: [1,2,3].map(i => ({ ...observation(i), motionSteps: [], boundaryEvidence: [] })), links: [], contradictions: [], reason: "first" });
	memory.createReviewedRegion(["o1", "o3"], "reviewed distinct local scope");
	memory.reviseHierarchy([{ id: "scope", layer: "region", parentId: null, observationIds: ["o1", "o3"], source: "reviewed", reason: "fixture" }], "hierarchy review");
	const dir = await mkdtemp(join(tmpdir(), "first-sight-integrated-"));
	try {
		const path = join(dir, "bundle.json"); await memory.persist(path);
		const restored = new VisualExperienceMemory(); await restored.load(path);
		assert.deepEqual(restored.snapshot(), memory.snapshot());
		assert.deepEqual(restored.grouping(), memory.grouping());
		const invalidGrouping=restored.snapshot() as any;
		invalidGrouping.groupingRevisions[0].assignments.future="current-o1";
		await writeFile(path,JSON.stringify({protocol:"visual-experience-memory-v1",...invalidGrouping}));
		await assert.rejects(restored.load(path));assert.deepEqual(restored.snapshot(),memory.snapshot());
		await writeFile(path, '{"protocol":"visual-experience-memory-v1","baseline":{},"interpretations":[]}');
		await assert.rejects(restored.load(path)); assert.deepEqual(restored.snapshot(), memory.snapshot());
	} finally { await rm(dir, { recursive: true, force: true }); }
});
test("interpretation cannot rewrite original timestamps or frames", () => {
	const { memory } = setup();
	assert.throws(() => memory.interpret({ observations: [{ ...observation(1), frames: ["different"], motionSteps: [], boundaryEvidence: [] }], links: [], contradictions: [], reason: "bad" }));
	assert.equal(memory.snapshot().interpretations.length, 0);
});
test("online prefixes cannot consume future evidence and failed append is atomic", () => {
	const memory = new VisualExperienceMemory();
	memory.observe(observation(1), [], []);
	assert.throws(() => memory.observe(observation(2), [], [], [{ id: "future", a: "o2", b: "o3", kind: "geometric", confidence: 1, source: "fixture", frames: ["f2", "f3"] }]));
	assert.equal(memory.association.graph.getState().observations.length, 1);
	const prefix = memory.observe(observation(2), [], []);
	assert.equal(prefix.regions[0]!.temporalRegionId, "experience-o1");
	assert.deepEqual(prefix.regions[0]!.observationIds, ["o1", "o2"]);
});
test("reviewed new identities and bindings can be retracted without deleting observations", () => {
	const memory = new VisualExperienceMemory();
	for (let i=1;i<=3;i++) memory.addObservation(observation(i));
	const target = memory.createReviewedRegion(["o1", "o2"], "manual image review");
	memory.reviewBinding(["o3"], target, "reviewed revisit");
	assert.equal(memory.effective().unresolvedObservationIds.length, 0);
	memory.retractLastReview("revisit uncertain"); assert.deepEqual(memory.effective().unresolvedObservationIds, ["o3"]);
	memory.retractLastReview("retract region"); assert.equal(memory.effective().unresolvedObservationIds.length, 3);
	assert.equal(memory.searchObjects("cup").length, 3);
});
test("hierarchy revisions retain distinct subregions and can be undone by another revision", () => {
	const { memory } = setup();
	const parent = { id: "room", layer: "region" as const, parentId: null, observationIds: ["o1", "o2"], source: "reviewed" as const, reason: "review" };
	memory.reviseHierarchy([parent, { id: "bed", layer: "subregion", parentId: "room", observationIds: ["o1"], source: "temporal-proposal", reason: "context" }], "first");
	assert.equal(memory.hierarchy().length, 2);
	memory.reviseHierarchy([parent], "retract subregion");
	assert.equal(memory.hierarchy().length, 1); assert.equal(memory.snapshot().hierarchyRevisions.length, 2);
});
test("boundary confirmations cannot leak from future into an online prefix", () => {
	const memory = new VisualExperienceMemory(); memory.observe(observation(1), [], []);
	const proposal = { event: { id: "cut", beforeObservationId: "o2", source: "automatic" as const, reason: "inferred candidate", frames: ["f2"] }, availableAtMs: 5000 };
	assert.throws(() => memory.observe(observation(2), [], [], [], [], [proposal]));
	assert.equal(memory.association.graph.getState().observations.length, 1);
});
test("fresh memory uses formal anchor policy while old bundles preserve legacy behavior", () => {
	const fresh = new VisualExperienceMemory();
	assert.equal(fresh.association.getBundle().sequenceAnchorPolicy, "multi-bearing");
	const legacy = new ExperienceAssociation(new ExperienceGraph(), true).getBundle();
	fresh.association.restoreBundle(legacy);
	assert.deepEqual(fresh.association.getBundle(), legacy);
});
test("frozen grouping default remains legacy; research policies require explicit opt-in",()=>{
	const memory=new VisualExperienceMemory();memory.observe(observation(1),[],[]);
	assert.equal(memory.snapshot().interpretations[0]!.coherentAnchorPolicy,"legacy-first-pair");
	memory.observe(observation(2),[],[]);
	assert.equal(memory.snapshot().interpretations[1]!.coherentAnchorPolicy,"legacy-first-pair");
	const research=new VisualExperienceMemory();research.observe(observation(1),[],[],[],[],[],[],"updating-context-v2");
	research.observe(observation(2),[],[]);
	assert.equal(research.snapshot().interpretations[1]!.coherentAnchorPolicy,"updating-context-v2");
});
test("online current grouping is actual output, not legacy visual unknowns", () => {
	const memory=new VisualExperienceMemory();
	for(let i=1;i<=3;i++) {
		const result=memory.observe(observation(i),[],[]);
		assert.equal(result.grouping.assignments[`o${i}`],"current-o1");
		assert.equal(result.grouping.revision,i);
	}
	assert.equal(memory.grouping()!.groups.length,1);
	assert.equal(memory.effective().unresolvedObservationIds.length,3);
	assert.equal(memory.searchGroupObjects("current-o1","cup").length,3);
});
test("rotation, weak matches and unknown VO do not remove current membership", () => {
	const memory=new VisualExperienceMemory();memory.observe(observation(1),[],[]);
	const result=memory.observe(observation(2),[{beforeFrame:"a",afterFrame:"b",status:"skipped-rotation"}],[],[{id:"weak",a:"o1",b:"o2",kind:"visual",confidence:.01,source:"fixture",frames:["f1","f2"]}]);
	assert.equal(result.grouping.assignments.o2,"current-o1");
	assert.equal(result.grouping.groups[0]!.historicalIdentityStatus,"unrecognized");
});
test("new positive contradiction is atomic, revisable and group search uses current membership", () => {
	const memory=new VisualExperienceMemory();memory.observe(observation(1),[],[]);memory.observe(observation(2),[],[]);
	const result=memory.observe(observation(3),[],[],[],[],[],[{id:"c",a:"o1",b:"o3",reason:"verified different context",source:"fixture",frames:["f1","f3"]}]);
	assert.equal(result.grouping.assignments.o3,"current-o3");
	assert.equal(memory.searchGroupObjects("current-o1","cup").length,2);
	const before=memory.snapshot(),groups=memory.grouping();
	assert.throws(()=>memory.observe(observation(4),[],[],[],[],[],[{id:"future",a:"o4",b:"o5",reason:"bad",source:"fixture",frames:["f4"]}]));
	assert.deepEqual(memory.snapshot(),before);assert.deepEqual(memory.grouping(),groups);
});
test("supported multi-bearing visual anchor changes produce provisional context cuts", () => {
	const graph=new ExperienceGraph(), association=new ExperienceAssociation(graph), memory=new VisualExperienceMemory(association);
	for(let i=1;i<=4;i++)memory.addObservation(observation(i));
	for(const [a,b] of [[1,2],[3,4]])memory.addEvidence({a:`o${a}`,b:`o${b}`,bearings:[1,1],backwardBearings:[1,1],source:"positive anchor fixture"});
	const result=memory.interpret({observations:[1,2,3,4].map(i=>({...observation(i),motionSteps:[],boundaryEvidence:[]})),links:[],contradictions:[],reason:"available positive context anchors"});
	assert.deepEqual(result.grouping.groups.map(group=>group.observationIds),[["o1","o2"],["o3","o4"]]);
	assert.equal(result.grouping.groups[1]!.physicalScopeVerified,false);
	assert.equal(result.continuity.boundaries.length,0);
});
test("historical rejection retracts a group match without deleting temporal membership",()=>{
	const memory=new VisualExperienceMemory();for(let i=1;i<=6;i++)memory.addObservation(observation(i));
	const target=memory.association.graph.createNode(["o1","o2"],"fixture historical anchor");
	const cuts=[3,5].map(i=>({event:{id:`c${i}`,beforeObservationId:`o${i}`,source:"automatic" as const,reason:"context evidence",frames:[`f${i}`]},availableAtMs:6000}));
	const links=[[1,5],[2,6]].map(([a,b],i)=>({id:`g${i}`,a:`o${a}`,b:`o${b}`,kind:"geometric" as const,confidence:1,source:"fixture",frames:[`f${a}`,`f${b}`]}));
	memory.interpret({observations:[1,2,3,4,5,6].map(i=>({...observation(i),motionSteps:[],boundaryEvidence:[]})),links,contradictions:[],automaticBoundaryProposals:cuts,reason:"initial group revisit"});
	assert.equal(memory.grouping()!.assignments.o5,"current-o1");
	memory.reject("o5",target,{source:"review",reason:"wrong historical association"});
	assert.equal(memory.grouping()!.assignments.o5,"current-o5");
	assert.equal(Object.keys(memory.grouping()!.assignments).length,6);
	assert.equal(memory.searchObjects("cup").length,6);
});
