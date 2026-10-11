import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateRegions, type RegionJudgment } from "./region-evaluation.js";
const prediction = { groups: [{ observationIds: ["a", "b"] }, { observationIds: ["c", "d"] }], unresolvedObservationIds: ["e"] };
const label = (a: string, b: string, relation: RegionJudgment["relation"]): RegionJudgment => ({ id: `${a}-${b}`, a, b, relation, category: "activity-scope", reviewer: "test", rationale: "test fixture", frameRefs: [a, b] });
test("manual scoring distinguishes wrong merges, splits and abstentions", () => {
	const result = evaluateRegions(prediction, [label("a", "b", "different"), label("a", "c", "same"), label("b", "e", "same"), label("c", "d", "same"), label("a", "d", "unknown")]);
	assert.equal(result.summary.falseMerges, 1); assert.equal(result.summary.falseSplits, 1);
	assert.equal(result.summary.abstained, 1); assert.equal(result.summary.coverage, 0.75);
	assert.equal(result.summary.selectiveAccuracy, 1 / 3); assert.equal(result.summary.sameRegionRecovery, 1 / 3);
});
test("missing predictions and duplicate pair labels fail rather than bias denominator", () => {
	assert.throws(() => evaluateRegions(prediction, [label("a", "z", "same")]));
	assert.throws(() => evaluateRegions(prediction, [label("a", "b", "same"), label("b", "a", "same")]));
	assert.throws(() => evaluateRegions({ ...prediction, unresolvedObservationIds: ["a"] }, []));
});
test("no scored judgments reports null instead of perfect accuracy", () => {
	assert.equal(evaluateRegions(prediction, [label("a", "b", "unknown")]).summary.selectiveAccuracy, null);
});
