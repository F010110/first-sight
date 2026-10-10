import assert from "node:assert/strict";
import { test } from "node:test";
import { proposePlaces, buildRegionEdges, proposeSpaces } from "./topological-grouping.js";

test("Place grouping rejects transitive shared-surface chaining", () => {
	const groups = proposePlaces(["a","b","c"], [{a:"a",b:"b",score:0.9,directions:2},{a:"b",b:"c",score:0.8,directions:2},{a:"a",b:"c",score:0.1,directions:2}],0.5);
	assert.equal(groups.length,2); assert.ok(groups.every(group => group.members.length <= 2));
});
test("one matched direction cannot merge regions", () => {
	assert.equal(proposePlaces(["a","b"],[{a:"a",b:"b",score:1,directions:1}],0.2).length,2);
});
test("compatible multi-direction observations can group across orientation", () => {
	const groups = proposePlaces(["front","reverse"],[{a:"front",b:"reverse",score:0.9,directions:2}],0.2);
	assert.equal(groups.length,1); assert.equal(groups[0]?.status,"provisional");
});
test("Space grouping preserves Place IDs, records transitions, and requires repeats", () => {
	const places = proposePlaces(["a","b","c"],[],0.2);
	assert.equal(proposeSpaces(places,buildRegionEdges(["a","b","c"],places)).length,0);
	const spaces = proposeSpaces(places,buildRegionEdges(["a","b","a","b"],places));
	assert.equal(spaces.length,1); assert.equal(spaces[0]?.placeIds.length,2);
	assert.equal(spaces[0]?.scopeVerified,false); assert.equal(places.length,3);
});
