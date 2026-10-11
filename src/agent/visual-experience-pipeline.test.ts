import { test } from "node:test";
import assert from "node:assert/strict";
import { replayVisualExperience, type VisualPipelineObservation } from "./visual-experience-pipeline.js";
const row = (i: number, kind?: "boundary-approach" | "boundary-passage" | "post-boundary-support"): VisualPipelineObservation => ({ id: `o${i}`, atMs: i * 3000, frames: [`f${i}`], motionSteps: [0, 1].map(j => ({ beforeFrame: `${i}-${j}`, afterFrame: `${i}-${j + 1}`, status: "movement-candidate" })), boundaryEvidence: kind ? [{ id: `e${i}`, source: "synthetic-test-track", frames: [`f${i}`], kind, boundaryTrackId: "door" }] : [] });
test("VO movement alone never creates crossing or physical region identity", () => {
	const { result } = replayVisualExperience([row(1), row(2)], []);
	assert.equal(result.motionSummary[0]!.continuousMovement, true);
	assert.equal(result.continuity.boundaries.length, 0);
	assert.equal(result.interpretation.segmentation.segments[0]!.historicalRegionId, null);
});
test("VO supports independent crossing process through to revisable store", () => {
	const { result, store } = replayVisualExperience([row(1, "boundary-approach"), row(2, "boundary-passage"), row(3, "post-boundary-support"), row(4, "post-boundary-support")], []);
	assert.equal(result.interpretation.segmentation.segments.length, 2);
	assert.equal(result.continuity.boundaries[0]!.beforeObservationId, "o2");
	store.revise({ boundaries: [], links: [], contradictions: [], reason: "Revoke synthetic boundary" });
	assert.equal(store.snapshot().revisions.length, 2);
});
test("skipped rotation cannot supply movement support; unordered steps fail", () => {
	const input = [row(1, "boundary-approach"), row(2, "boundary-passage"), row(3, "post-boundary-support"), row(4, "post-boundary-support")];
	input[1]!.motionSteps[0]!.status = "skipped-rotation";
	assert.equal(replayVisualExperience(input, []).result.continuity.boundaries.length, 0);
	input[1]!.motionSteps[1]!.beforeFrame = "wrong";
	assert.throws(() => replayVisualExperience(input, []));
});
test("recording hiatus breaks temporal organization without asserting a crossing", () => {
	const input = [row(1), row(2)]; input[1]!.atMs = 20000;
	const { result } = replayVisualExperience(input, []);
	assert.equal(result.continuity.boundaries.length, 0);
	assert.equal(result.interpretation.segmentation.segments.length, 2);
	assert.equal(result.hiatusBoundaries.length, 1);
});
