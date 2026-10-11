import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreGroupingCorrectness as correct, scoreGroupingStability as stable, scoreGroupContentRecognition as content } from "./grouping-evaluation.js";
const truth = { a: "A", b: "A", c: "B", d: "B" };
test("perfect grouping scores one regardless of generated IDs", () => {
	const r = correct(truth, { a: "x", b: "x", c: "y", d: "y" });
	assert.equal(r.balancedGroupingScore, 1); assert.equal(r.coverage, 1);
});
test("all merged and all singleton do not get high balanced accuracy", () => {
	assert.equal(correct(truth, { a: "x", b: "x", c: "x", d: "x" }).balancedGroupingScore, .5);
	assert.equal(correct(truth, { a: "a", b: "b", c: "c", d: "d" }).balancedGroupingScore, .5);
});
test("all unknown is zero recovery, not perfect accuracy", () => {
	const r = correct(truth, { a: null, b: null, c: null, d: null });
	assert.equal(r.balancedGroupingScore, 0); assert.equal(r.accuracyOnDecidedPairs, null);
});
test("abstention reduces score and conditional accuracy is labeled separately", () => {
	const r = correct(truth, { a: "x", b: "x", c: null, d: null });
	assert.equal(r.accuracyOnDecidedPairs, 1); assert.equal(r.balancedGroupingScore, .25);
});
test("missing labels and missing predictions cannot silently improve score", () => {
	assert.throws(() => correct(truth, { a: "x" }));
	assert.equal(correct({ a: "A", b: null }, { a: "x", b: "y" }).balancedGroupingScore, null);
});
test("region and subregion granularity are independent; boundary truth excluded", () => {
	const p = { a: "bed", b: "desk", c: null };
	assert.equal(correct({ a: "bed", b: "desk", c: null }, p).differentSeparation, 1);
	assert.equal(correct({ a: "room", b: "room", c: null }, p).sameRecovery, 0);
});
test("renaming groups does not cause instability", () => {
	const r = stable([{ atMs: 1, assignments: { a: "x", b: "x" } }, { atMs: 2, assignments: { a: "z", b: "z" } }], { a: "A", b: "A" });
	assert.equal(r.decisionPersistence, 1); assert.equal(r.regressions, 0);
});
test("correction and harmful flip are scored separately", () => {
	const r = stable([{ atMs: 1, assignments: { a: "x", b: "y" } }, { atMs: 2, assignments: { a: "x", b: "x" } }, { atMs: 3, assignments: { a: "x", b: "y" } }], { a: "A", b: "A" });
	assert.equal(r.repairs, 1); assert.equal(r.regressions, 1); assert.equal(r.harmfulChangeRate, .5);
});
test("stable wrong and stable unknown cannot masquerade as correct grouping", () => {
	const r = stable([{ atMs: 1, assignments: { a: "x", b: "x" } }, { atMs: 2, assignments: { a: "x", b: "x" } }], { a: "A", b: "B" });
	assert.equal(r.decisionPersistence, 1); assert.equal(r.finalCorrectness!.differentSeparation, 0);
	assert.equal(stable([{ atMs: 1, assignments: { a: null, b: null } }], { a: "A", b: "A" }).decisionPersistence, null);
});
const query = { id: "q", queryObservationId: "now", eligibleHistoricalObservationIds: ["a", "b", "c"], relevantHistoricalObservationIds: ["a", "b"], returnedObservationIds: ["a"] };
test("recognition success and complete content recall are different", () => {
	const r = content([query]); assert.equal(r.correctRecognitionRate, 1); assert.equal(r.contentRecall, .5);
});
test("contaminated group retrieval is wrong, abstention is unknown", () => {
	assert.equal(content([{ ...query, returnedObservationIds: ["a", "c"] }]).wrongRecognitionRate, 1);
	assert.equal(content([{ ...query, returnedObservationIds: [] }]).correctRecognitionRate, 0);
	assert.equal(content([]).correctRecognitionRate, null);
});
test("self, future, duplicate and unreviewed retrieval are rejected", () => {
	for (const returnedObservationIds of [["now"], ["future"], ["a", "a"]]) assert.throws(() => content([{ ...query, returnedObservationIds }]));
	assert.throws(() => content([{ ...query, relevantHistoricalObservationIds: [] }]));
});
