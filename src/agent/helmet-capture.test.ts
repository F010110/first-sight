import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptHelmetCapture, type HelmetCaptureObservation } from "./helmet-capture.js";

const policy = { maxSkewMs: 10, maxHeadingAgeMs: 20 };
const fixture = (): HelmetCaptureObservation => ({ schemaVersion: 1, recordingId: "recording", id: "one", atMs: 100, clockId: "clock", cameras: ["front", "left", "right", "rear"].map(direction => ({ direction: direction as "front", cameraId: direction, frame: `${direction}.jpg`, capturedAtMs: 100, timestampSource: "exposure" })) });
test("helmet adapter preserves raw rear view and emits legacy-compatible ordered triple", () => {
	const raw = fixture(), before = structuredClone(raw), result = adaptHelmetCapture(raw, policy);
	assert.deepEqual(result.observation.frames, ["front.jpg", "left.jpg", "right.jpg"]);
	assert.equal(result.raw.cameras.length, 4); assert.equal(result.eligibleForThreeViewReplay, true); assert.equal(result.headingUsable, false);
	result.raw.cameras[0]!.frame = "changed"; assert.deepEqual(raw, before);
});
test("missing or duplicated views fail; asynchronous and receive timestamps are ineligible", () => {
	const missing = fixture(); missing.cameras.splice(1, 1); assert.throws(() => adaptHelmetCapture(missing, policy));
	const duplicate = fixture(); duplicate.cameras[1]!.frame = "front.jpg"; assert.throws(() => adaptHelmetCapture(duplicate, policy));
	const skewed = fixture(); skewed.cameras[1]!.capturedAtMs = 130; assert.equal(adaptHelmetCapture(skewed, policy).eligibleForThreeViewReplay, false);
	const received = fixture(); received.cameras[0]!.timestampSource = "host-receive"; assert.equal(adaptHelmetCapture(received, policy).eligibleForThreeViewReplay, false);
});
test("heading is optional and never creates inference evidence; stale or uncalibrated abstains", () => {
	const raw = fixture(); raw.heading = { atMs: 100, degrees: 90, reference: "magnetic-north", reliable: true, uncertaintyDegrees: 10 };
	assert.equal(adaptHelmetCapture(raw, policy).headingUsable, false);
	raw.heading.calibrationId = "sensor-calibration"; assert.equal(adaptHelmetCapture(raw, policy).headingUsable, true);
	raw.heading.atMs = 0; assert.equal(adaptHelmetCapture(raw, policy).headingUsable, false);
	raw.heading.degrees = 360; assert.throws(() => adaptHelmetCapture(raw, policy));
});
