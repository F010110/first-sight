import { test } from "node:test";
import assert from "node:assert/strict";
import { replayVisualExperience } from "./visual-experience-pipeline.js";
import { organizeRegionInterpretation } from "./region-interpretation.js";
test("unknown identity still organizes continuous experience without claiming physical truth", () => {
	const input = [1,2,3].map(i => ({ id: `o${i}`, atMs: i * 1000, frames: [`f${i}`], motionSteps: [], boundaryEvidence: [] }));
	const result = organizeRegionInterpretation(replayVisualExperience(input, []).result.interpretation);
	assert.equal(result[0]!.temporalRegionId, "experience-o1");
	assert.equal(result[0]!.historicalCandidateId, null); assert.equal(result[0]!.physicalScopeVerified, false);
});
test("buffer observations are shared anchors only, not duplicate primary membership", () => {
	const row = (i: number, kind?: "boundary-approach" | "boundary-passage" | "post-boundary-support") => ({ id: `o${i}`, atMs: i * 1000, frames: [`f${i}`], motionSteps: [0,1].map(j => ({ beforeFrame: `${i}-${j}`, afterFrame: `${i}-${j+1}`, status: "movement-candidate" as const })), boundaryEvidence: kind ? [{ id: `e${i}`, source: "fixture", frames: [`f${i}`], kind, boundaryTrackId: "opening" }] : [] });
	const input = [row(1,"boundary-approach"),row(2,"boundary-passage"),row(3,"post-boundary-support"),row(4,"post-boundary-support")];
	const pipeline = replayVisualExperience(input, []).result;
	const regions = organizeRegionInterpretation(pipeline.interpretation);
	assert.equal(regions.length, 2); assert.deepEqual(regions[0]!.sharedBoundaryAnchorIds, ["o2"]);
	assert.deepEqual(regions[1]!.sharedBoundaryAnchorIds, ["o1"]);
	assert.equal(new Set(regions.flatMap(row => row.observationIds)).size, 4);
	assert.equal(pipeline.continuity.confirmations[0]!.confirmationDelayMs, 2000);
});
