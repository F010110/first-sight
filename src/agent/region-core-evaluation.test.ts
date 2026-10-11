import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRegionCores, type CoreLabel } from "./region-core-evaluation.js";
const label = (id: string, region: string): CoreLabel => ({ observationId: id, kind: "core", regions: [region], reason: "fixture", frames: [id] });
test("core review detects merges, fragmentation and missing coverage separately", () => {
	const result = evaluateRegionCores({ groups: [{ observationIds: ["a", "b"] }, { observationIds: ["c"] }], unresolvedObservationIds: ["d"] }, [label("a", "A"), label("b", "B"), label("c", "A"), label("d", "B")]);
	assert.equal(result.summary.mixedGroups, 1); assert.equal(result.summary.fragmentedRegions, 1);
	assert.equal(result.summary.coreCoverage, 0.75); assert.equal(result.summary.regionsWithMissingCores, 1);
});
test("a boundary can belong to either allowed neighbor without becoming a core", () => {
	const result = evaluateRegionCores({ groups: [{ observationIds: ["a", "x"] }], unresolvedObservationIds: [] }, [label("a", "A"), { observationId: "x", kind: "boundary", regions: ["A", "B"], reason: "doorway", frames: ["x"] }]);
	assert.equal(result.boundaries[0]!.outcome, "allowed"); assert.equal(result.summary.cores, 1);
});
test("incomplete labels and duplicate membership fail instead of hiding errors", () => {
	assert.throws(() => evaluateRegionCores({ groups: [{ observationIds: ["a", "b"] }], unresolvedObservationIds: [] }, [label("a", "A")]));
	assert.throws(() => evaluateRegionCores({ groups: [{ observationIds: ["a"] }], unresolvedObservationIds: ["a"] }, [label("a", "A")]));
});
