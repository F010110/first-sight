import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePrefixStability } from "./region-online-evaluation.js";
test("node renaming is stable; resolutions, flips and retractions are distinct", () => {
	const result = scorePrefixStability([{ atMs: 1, assignments: { a: null, b: null } }, { atMs: 2, assignments: { a: "x", b: "x" } }, { atMs: 3, assignments: { a: "renamed", b: "renamed" } }, { atMs: 4, assignments: { a: "x", b: "y" } }, { atMs: 5, assignments: { a: null, b: "y" } }]);
	assert.equal(result.resolutions, 1); assert.equal(result.resolvedRelationFlips, 1); assert.equal(result.retractions, 1);
});
test("prefix input cannot silently forget history", () => {
	assert.throws(() => scorePrefixStability([{ atMs: 1, assignments: { a: null } }, { atMs: 2, assignments: {} }]));
});
