import { test } from "node:test";
import assert from "node:assert/strict";
import { assessRotationCompensatedMotion, type MotionFramePair } from "./rotation-compensated-motion.js";
const pair = (shift = 0): MotionFramePair => ({
	before: { observationId: "a", atMs: 0, alpha: 0, beta: 0, gamma: 0, uncertaintyDegrees: 0, referenceId: "session", reliable: true },
	after: { observationId: "b", atMs: 1000, alpha: 0, beta: 0, gamma: 0, uncertaintyDegrees: 0, referenceId: "session", reliable: true },
	calibration: { calibrated: true, cameraToDevice: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }, camera: { fx: 160, fy: 160, cx: 160, cy: 160, width: 320, height: 320 },
	tracks: Array.from({ length: 18 }, (_, i) => { const x = 40 + (i % 3) * 100, y = 40 + Math.floor(i / 3) * 40; return { id: `t${i}`, before: [x, y], after: [x + shift, y], staticScene: true }; }), frames: ["a.jpg", "b.jpg"], source: "synthetic-calibrated-tracks"
});
test("unchanged rays support continuity, not stationary truth", () => {
	const result = assessRotationCompensatedMotion(pair()); assert.equal(result.status, "rotation-explained"); assert.equal(result.provesStationary, false);
});
test("known rotation is removed before residual motion is assessed", () => {
	const input = pair(); input.after.alpha = 15;
	const angle = -15 * Math.PI / 180;
	for (const track of input.tracks) { const x = track.before[0] - 160, y = track.before[1] - 160; track.after = [160 + Math.cos(angle) * x - Math.sin(angle) * y, 160 + Math.sin(angle) * x + Math.cos(angle) * y]; }
	assert.equal(assessRotationCompensatedMotion(input).status, "rotation-explained");
});
test("broad unexplained motion is only a candidate; dynamic tracks are excluded", () => {
	assert.equal(assessRotationCompensatedMotion(pair(12)).status, "movement-candidate");
	const input = pair(12); for (const track of input.tracks) track.staticScene = false;
	assert.equal(assessRotationCompensatedMotion(input).status, "unknown");
});
test("direction uncertainty and interrupted sensors abstain", () => {
	const input = pair(); input.after.uncertaintyDegrees = 5; assert.equal(assessRotationCompensatedMotion(input).status, "unknown");
	input.after.uncertaintyDegrees = 0; input.after.atMs = 5000; assert.equal(assessRotationCompensatedMotion(input).status, "unknown");
});
test("concentrated tracks and invalid calibration do not produce movement candidates", () => {
	const input = pair(12);
	for (const track of input.tracks) { track.before = [40, 40]; track.after = [52, 40]; }
	assert.equal(assessRotationCompensatedMotion(input).status, "unknown");
	input.calibration.cameraToDevice[0]![0] = 2;
	assert.throws(() => assessRotationCompensatedMotion(input));
});
