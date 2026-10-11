import { test } from "node:test";
import assert from "node:assert/strict";
import { proposeVisualChangeBoundaries } from "./visual-change-boundaries.js";
import type { VisualPipelineObservation } from "./visual-experience-pipeline.js";
const observations: VisualPipelineObservation[] = [1,2,3].map(i => ({ id: `o${i}`, atMs: i * 3000, frames: [`f${i}`], boundaryEvidence: [], motionSteps: [{ beforeFrame: `${i}-0`, afterFrame: `${i}-1`, status: "movement-candidate" }, { beforeFrame: `${i}-1`, afterFrame: `${i}-2`, status: "movement-candidate" }] }));
const links = [1,2].map(i => ({ id: `e${i}`, a: `o${i}`, b: `o${i+1}`, kind: "visual" as const, confidence: .1, source: "fixture", frames: [`f${i}`, `f${i+1}`] }));
test("sustained change during visual movement splits batches, not physical truth", () => {
	const result = proposeVisualChangeBoundaries(observations, links);
	assert.equal(result.boundaries.length, 1); assert.equal(result.confirmedCrossings, false);
});
test("no match record is unknown; rotation or hiatus cannot authorize change", () => {
	assert.equal(proposeVisualChangeBoundaries(observations, []).boundaries.length, 0);
	const changed = structuredClone(observations); changed[2]!.motionSteps[0]!.status = "skipped-rotation";
	assert.equal(proposeVisualChangeBoundaries(changed, links).boundaries.length, 0);
	changed[2]!.motionSteps[0]!.status = "movement-candidate"; changed[2]!.atMs = 30000;
	assert.equal(proposeVisualChangeBoundaries(changed, links).boundaries.length, 0);
});
