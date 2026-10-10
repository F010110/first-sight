import assert from "node:assert/strict";
import { test } from "node:test";
import { matchViews, selectCandidates } from "./place-candidates.js";

test("all three directions remain available and legacy front images still load", () => {
	const views = (["front", "left", "right"] as const).map(view => ({ view, path: `${view}.jpg` }));
	assert.deepEqual(matchViews({ path: "triple.jpg", visualMatchViews: views }), views);
	assert.equal(matchViews({ path: "triple.jpg", matchPath: "front.jpg" })[0]?.path, "front.jpg");
});

test("local cross-view matches survive low global appearance similarity", () => {
	const candidates = selectCandidates([
		{ id: "side-match", visual: 0.1, inliers: 80, path: 0, supportedViews: 2 },
		{ id: "route-match", visual: 0.1, inliers: 0, path: 0.9, supportedViews: 0 },
		{ id: "previous", visual: 0, inliers: 0, path: 0, supportedViews: 0 },
	], "previous", true);
	assert.deepEqual(new Set(candidates.map(item => item.id)), new Set(["previous", "side-match", "route-match"]));
});

test("matcher failure is uncertainty, not proof that recent candidates differ", () => {
	const scores = ["a", "b"].map(id => ({ id, visual: 0, inliers: 0, path: 0, supportedViews: 0 }));
	assert.equal(selectCandidates(scores, null, false).length, 2);
});
