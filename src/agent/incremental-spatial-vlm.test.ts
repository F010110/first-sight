import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSpatialDecision } from "./incremental-spatial-vlm.js";
import type { SpatialSnapshot } from "./incremental-spatial-memory.js";

test("protocol rejects invented identities and unsupported same", () => {
	const history: SpatialSnapshot = { version: 1, currentPlaceId: null, records: [], places: [] };
	assert.throws(() => validateSpatialDecision({ kind: "same", placeId: null, summary: "room", reason: "layout" }, history));
	assert.throws(() => validateSpatialDecision({ kind: "known", placeId: "fake", summary: "room", reason: "layout" }, history));
	assert.throws(() => validateSpatialDecision({ kind: "new", placeId: "fake", summary: "room", reason: "layout" }, history));
	assert.equal(validateSpatialDecision({ kind: "unknown", placeId: null, summary: "occluded", reason: "no evidence" }, history).kind, "unknown");
});
