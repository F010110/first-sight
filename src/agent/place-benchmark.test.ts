import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePlaceBenchmark } from "./place-benchmark.js";
const set = { stability: [{ a: "a", b: "b", reason: "rotation" }], separation: [{ a: "a", b: "c", reason: "different core" }], lookup: [{ query: "b", target: "a", forbidden: ["c"], reason: "return" }] };
test("stable subplaces can pass without prescribing one room per group", () => {
	assert.equal(scorePlaceBenchmark({ groups: [{ observationIds: ["a", "b"] }, { observationIds: ["c"] }], unresolvedObservationIds: [] }, set).summary.score, 100);
});
test("all merged exposes a severe error and all unknown scores zero", () => {
	const merged = scorePlaceBenchmark({ groups: [{ observationIds: ["a", "b", "c"] }], unresolvedObservationIds: [] }, set);
	assert.equal(merged.summary.score, 40);
	assert.equal(merged.summary.falseMerges, 1);
	assert.equal(scorePlaceBenchmark({ groups: [], unresolvedObservationIds: ["a", "b", "c"] }, set).summary.score, 0);
});
test("missing test dimension yields no overall score", () => {
	assert.equal(scorePlaceBenchmark({ groups: [{ observationIds: ["a", "b"] }, { observationIds: ["c"] }], unresolvedObservationIds: [] }, { ...set, lookup: [] }).summary.score, null);
});
