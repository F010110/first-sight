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
