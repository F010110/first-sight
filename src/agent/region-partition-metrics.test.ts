import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePartitionLayer } from "./region-partition-metrics.js";
const truth = { a: "A", b: "A", c: "B", d: "B" };
test("perfect permutations of IDs have perfect partition metrics", () => {
	const result = scorePartitionLayer(truth, { a: "X", b: "X", c: "Y", d: "Y" });
	assert.equal(result.pairF1, 1); assert.equal(result.ariOnAssignedOnly, 1);
});
test("all merged is penalized and all unknown cannot gain a perfect ARI", () => {
	assert.equal(scorePartitionLayer(truth, { a: "X", b: "X", c: "X", d: "X" }).falseMergedPairs, 4);
	const unknown = scorePartitionLayer(truth, { a: null, b: null, c: null, d: null });
	assert.equal(unknown.pairF1, 0); assert.equal(unknown.coverage, 0); assert.equal(unknown.ariOnAssignedOnly, null);
});
test("ambiguous truth is excluded, missing predictions rejected", () => {
	assert.equal(scorePartitionLayer({ ...truth, d: null }, { a: "X", b: "X", c: "Y", d: null }).truthObservations, 3);
	assert.throws(() => scorePartitionLayer(truth, { a: "X" }));
});
