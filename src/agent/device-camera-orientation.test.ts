import { test } from "node:test";
import assert from "node:assert/strict";
import { compareDeviceCameraOrientation, type DeviceOrientationReading } from "./device-camera-orientation.js";
const reading = (alpha: number, atMs: number): DeviceOrientationReading => ({ observationId: `o${atMs}`, atMs, alpha, beta: 30, gamma: 15, referenceId: "device-session", reliable: true, uncertaintyDegrees: 2 });
const calibration = { calibrated: true, cameraToDevice: [[1, 0, 0], [0, 0, 1], [0, -1, 0]] };
test("full tilt and explicit camera axes yield relative ray rotation", () => {
	const result = compareDeviceCameraOrientation(reading(350, 0), reading(20, 1000), calibration);
	assert.equal(result.status, "available");
	assert.ok(result.status === "available" && Math.abs(result.rotationDegrees - 30) < 1e-6);
	assert.equal(result.status === "available" && result.provesStationary, false);
});
test("uncalibrated axes, interrupted sensors and reflected axes cannot authorize rotation", () => {
	assert.equal(compareDeviceCameraOrientation(reading(0, 0), reading(30, 1000), { ...calibration, calibrated: false }).status, "unknown");
	assert.equal(compareDeviceCameraOrientation(reading(0, 0), reading(30, 5000), calibration).status, "unknown");
	assert.throws(() => compareDeviceCameraOrientation(reading(0, 0), reading(30, 1000), { calibrated: true, cameraToDevice: [[-1, 0, 0], [0, 1, 0], [0, 0, 1]] }));
});
