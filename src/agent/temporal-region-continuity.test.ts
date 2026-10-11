import { test } from "node:test";
import assert from "node:assert/strict";
import { proposeTemporalBoundaries, type ContinuityInput, type ContinuityEvidence } from "./temporal-region-continuity.js";
const row = (i: number, kinds: ContinuityEvidence["kind"][] = [], track = "opening", atMs = i * 1000): ContinuityInput => ({ observation: { id: `o${i}`, atMs, frames: [`f${i}`] }, evidence: kinds.map((kind, j) => ({ id: `e${i}-${j}`, kind, source: "synthetic-track-fixture", frames: [`f${i}`], boundaryTrackId: track })) });
test("turning and movement alone preserve provisional continuity, not stationary truth", () => {
	const result = proposeTemporalBoundaries([row(1), row(2, ["rotation-support"]), row(3, ["movement-support"])]);
	assert.equal(result.boundaries.length, 0); assert.equal(result.trace[2]!.status, "provisional-continuation");
	assert.equal(result.trace[1]!.provesStationary, false);
});
test("approach, passage and two later confirmations propose a buffered retrospective cut", () => {
	const inputs = [row(1, ["boundary-approach"]), row(2, ["boundary-passage", "movement-support", "rotation-support"]), row(3, ["post-boundary-support"]), row(4, ["post-boundary-support"])];
	assert.equal(proposeTemporalBoundaries(inputs.slice(0, 3)).boundaries.length, 0);
	assert.equal(proposeTemporalBoundaries(inputs).boundaries[0]!.beforeObservationId, "o2");
});
test("seeing a boundary, unrelated tracks, missing movement and retreat cannot confirm", () => {
	assert.equal(proposeTemporalBoundaries([row(1, ["boundary-approach"]), row(2, ["boundary-passage"]), row(3, ["post-boundary-support"]), row(4, ["post-boundary-support"])]).boundaries.length, 0);
	assert.equal(proposeTemporalBoundaries([row(1, ["boundary-approach"]), row(2, ["boundary-passage", "movement-support"], "other"), row(3, ["post-boundary-support"]), row(4, ["post-boundary-support"])]).boundaries.length, 0);
	assert.equal(proposeTemporalBoundaries([row(1, ["boundary-approach"]), row(2, ["returned-inside", "boundary-passage", "movement-support"]), row(3, ["post-boundary-support"]), row(4, ["post-boundary-support"])]).boundaries.length, 0);
});
test("gaps reset crossing evidence and out-of-order input fails", () => {
	const result = proposeTemporalBoundaries([row(1, ["boundary-approach"]), row(2, ["boundary-passage", "movement-support"], "opening", 5000), row(3, ["post-boundary-support"], "opening", 6000)]);
	assert.equal(result.boundaries.length, 0); assert.equal(result.trace[1]!.status, "unknown-after-gap");
	assert.throws(() => proposeTemporalBoundaries([row(2), row(1)]));
});
