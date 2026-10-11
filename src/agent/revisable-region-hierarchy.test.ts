import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRegionHierarchy, type RegionScope } from "./revisable-region-hierarchy.js";
const scopes: RegionScope[] = [{ id: "bedroom", layer: "region", parentId: null, observationIds: ["a", "b"], source: "reviewed", reason: "review" }, { id: "bed-side", layer: "subregion", parentId: "bedroom", observationIds: ["a"], source: "temporal-proposal", reason: "local context" }, { id: "desk-side", layer: "subregion", parentId: "bedroom", observationIds: ["b"], source: "temporal-proposal", reason: "local context" }];
test("one room may contain several stable subregions without merging their anchors", () => {
	assert.deepEqual(validateRegionHierarchy(scopes, ["a", "b"]), scopes);
});
test("dangling or overlapping hierarchy claims are rejected", () => {
	const invalid = structuredClone(scopes); invalid[2]!.observationIds = ["a"];
	assert.throws(() => validateRegionHierarchy(invalid, ["a", "b"]));
	invalid[2]!.observationIds = ["b"]; invalid[2]!.parentId = "missing";
	assert.throws(() => validateRegionHierarchy(invalid, ["a", "b"]));
});
