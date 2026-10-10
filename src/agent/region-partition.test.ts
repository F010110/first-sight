import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionRegions, type RegionEvidence } from "./region-partition.js";
const edge = (a: string, b: string, relation: RegionEvidence["relation"], weight = 1): RegionEvidence => ({ id: `${a}-${b}-${relation}`, a, b, relation, weight, source: "test", reason: "fixture", frames: [a, b] });
test("unknown and absent evidence do not create claimed regions", () => {
	const result = partitionRegions(["a", "b", "c"], [edge("a", "b", "unknown")]);
	assert.equal(result.groups.length, 0); assert.deepEqual(result.unresolvedObservationIds, ["a", "b", "c"]);
});
test("repulsive structure evidence blocks an attractive chain", () => {
	const result = partitionRegions(["a", "b", "c"], [edge("a", "b", "same"), edge("b", "c", "same"), edge("a", "c", "different", 3)]);
	assert.equal(result.groups.length, 1); assert.equal(result.groups[0]!.observationIds.length, 2);
	assert.equal(result.objectiveCost, 1);
});
test("retraction revises proposals without changing inputs", () => {
	const ids = ["a", "b", "c"], evidence = [edge("a", "b", "same"), edge("b", "c", "same")];
	const before = JSON.stringify({ ids, evidence });
	assert.equal(partitionRegions(ids, evidence).groups[0]!.observationIds.length, 3);
	assert.deepEqual(partitionRegions(ids, evidence.slice(0, 1)).unresolvedObservationIds, ["c"]);
	assert.equal(JSON.stringify({ ids, evidence }), before);
});
test("conflicting evidence remains visible and invalid provenance is rejected", () => {
	const result = partitionRegions(["a", "b"], [edge("a", "b", "same", 2), edge("a", "b", "different")]);
	assert.equal(result.objectiveCost, 1); assert.equal(result.violatedEvidenceIds.length, 1);
	assert.throws(() => partitionRegions(["a", "b"], [{ ...edge("a", "b", "same"), frames: [] }]));
});
