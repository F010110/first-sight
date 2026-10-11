import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreTransitions, scoreObservedEdges } from "./region-event-evaluation.js";
test("event matching is one-to-one, buffer-aware and globally maximizes matches", () => {
	const truth = [{ id: "a", earliestMs: 100, latestMs: 110 }, { id: "b", earliestMs: 150, latestMs: 160 }];
	const result = scoreTransitions(truth, [{ id: "p1", atMs: 80 }, { id: "p2", atMs: 130 }, { id: "p3", atMs: 155 }], 30);
	assert.equal(result.hits, 2); assert.equal(result.falsePositives, 1); assert.equal(result.f1, .8);
	assert.equal(result.meanOutsideBufferMs, 10);
});
test("missing predictions are misses and empty metrics are null", () => {
	assert.equal(scoreTransitions([{ id: "a", earliestMs: 0, latestMs: 1 }], []).f1, 0);
	assert.equal(scoreTransitions([], []).f1, null);
	assert.throws(() => scoreTransitions([{ id: "a", earliestMs: 0, latestMs: 2 }, { id: "b", earliestMs: 1, latestMs: 3 }], []));
});
test("a directed observed edge does not imply its reverse or permission", () => {
	const result = scoreObservedEdges([{ from: "A", to: "B" }], [{ from: "B", to: "A" }]);
	assert.equal(result.hits, 0); assert.equal(result.navigable, false);
});
