/** Browser/device orientation adapter with EXPLICIT camera-axis calibration. */
export interface DeviceOrientationReading {
	observationId: string; atMs: number; alpha: number; beta: number; gamma: number;
	uncertaintyDegrees: number; referenceId: string; reliable: boolean;
}
export interface CameraAxisCalibration { calibrated: boolean; cameraToDevice: number[][] }
type Matrix = number[][];
const multiply = (a: Matrix, b: Matrix): Matrix => Array.from({ length: 3 }, (_, i) => Array.from({ length: 3 }, (_, j) => [0, 1, 2].reduce((sum, k) => sum + a[i]![k]! * b[k]![j]!, 0)));
const transpose = (a: Matrix): Matrix => [0, 1, 2].map(i => [0, 1, 2].map(j => a[j]![i]!));
function cameraInReference(reading: DeviceOrientationReading, calibration: CameraAxisCalibration): Matrix | null {
	if (!reading.observationId || !reading.referenceId || ![reading.atMs, reading.alpha, reading.beta, reading.gamma, reading.uncertaintyDegrees].every(Number.isFinite) || reading.uncertaintyDegrees < 0 || reading.uncertaintyDegrees > 180) throw new Error("Invalid device orientation");
	if (!reading.reliable || !calibration.calibrated) return null;
	const m = calibration.cameraToDevice;
	if (m.length !== 3 || m.some(row => row.length !== 3 || row.some(value => !Number.isFinite(value)))) throw new Error("Invalid camera-axis calibration");
	const orth = multiply(transpose(m), m);
	const determinant = m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
	if (Math.abs(determinant - 1) > 1e-6 || orth.some((row, i) => row.some((value, j) => Math.abs(value - (i === j ? 1 : 0)) > 1e-6))) throw new Error("Camera axes require a proper rotation");
	const [a, b, g] = [reading.alpha, reading.beta, reading.gamma].map(value => value * Math.PI / 180);
	const rz = [[Math.cos(a!), -Math.sin(a!), 0], [Math.sin(a!), Math.cos(a!), 0], [0, 0, 1]];
	const rx = [[1, 0, 0], [0, Math.cos(b!), -Math.sin(b!)], [0, Math.sin(b!), Math.cos(b!)]];
	const ry = [[Math.cos(g!), 0, Math.sin(g!)], [0, 1, 0], [-Math.sin(g!), 0, Math.cos(g!)]];
	return multiply(multiply(multiply(rz, rx), ry), m);
}
export function compareDeviceCameraOrientation(a: DeviceOrientationReading, b: DeviceOrientationReading, calibration: CameraAxisCalibration, maxGapMs = 1500) {
	if (!Number.isFinite(maxGapMs) || maxGapMs <= 0) throw new Error("Invalid sensor gap");
	const A = cameraInReference(a, calibration), B = cameraInReference(b, calibration);
	if (!A || !B || a.referenceId !== b.referenceId || b.atMs <= a.atMs || b.atMs - a.atMs > maxGapMs) return { status: "unknown" as const, reason: "Uncalibrated, unreliable, reference reset or interrupted orientation" };
	const rayRotation = multiply(transpose(B), A);
	const cosine = Math.max(-1, Math.min(1, (rayRotation[0]![0]! + rayRotation[1]![1]! + rayRotation[2]![2]! - 1) / 2));
	return { status: "available" as const, rayRotation, rotationDegrees: Math.acos(cosine) * 180 / Math.PI, uncertaintyDegrees: Math.min(180, a.uncertaintyDegrees + b.uncertaintyDegrees), provesStationary: false as const, note: "Relative ray rotation; alpha is not assumed to be camera yaw or true compass north" };
}
