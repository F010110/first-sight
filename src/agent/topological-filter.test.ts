import assert from "node:assert/strict";
import { test } from "node:test";
import { TopologicalFilter, UNKNOWN, normalize, motionTokens, visualPotentials, motionCompatibility, decideBelief } from "./topological-filter.js";

test("qualitative path ignores metric distance and heading", () => {
	assert.deepEqual(motionTokens("moved forward for 3s, then turned right roughly 90 degrees. Absolute heading: S."), ["move", "turn_right"]);
	assert.equal(motionCompatibility([], ["move"]), 1);
});
test("belief sums to one, preserves unknown and permits relocalization", () => {
	const filter = new TopologicalFilter(["a", "b"], []);
	filter.belief = normalize(new Map([["a", 1], ["b", 0], [UNKNOWN, 0]]));
	const belief = filter.update(new Map([["a", 0.001], ["b", 10], [UNKNOWN, 0.01]]), [], true, true);
	assert.ok(Math.abs([...belief.values()].reduce((a,b) => a+b,0) - 1) < 1e-10);
	assert.equal(decideBelief(belief).id, "b");
});
test("matching action order prefers the compatible outgoing edge", () => {
	const filter = new TopologicalFilter(["a", "b", "c"], [{ from: "a", to: "b", motion: ["move", "turn_right"] }, { from: "a", to: "c", motion: ["turn_left", "move"] }]);
	filter.belief = normalize(new Map([["a", 1], ["b", 0], ["c", 0], [UNKNOWN, 0]]));
	const belief = filter.update(new Map([["a", 0.01], ["b", 1], ["c", 1], [UNKNOWN, 0.01]]), ["move", "turn_right"], true, true);
	assert.ok(belief.get("b")! > belief.get("c")!);
});
test("poor visual evidence stays unresolved; matcher failure is uninformative", () => {
	const filter = new TopologicalFilter(["a", "b"], []);
	assert.equal(decideBelief(filter.update(visualPotentials(filter.ids, [], true), [], false, true)).status, "unresolved");
	assert.deepEqual([...visualPotentials(filter.ids, [], false).values()], [1, 1, 1]);
});

test("sensor dropout cannot confirm a location from prior alone", () => {
	assert.equal(decideBelief(new Map([["a", 0.99], [UNKNOWN, 0.01]]), false).status, "unresolved");
});
