import { compareDeviceCameraOrientation, type DeviceOrientationReading, type CameraAxisCalibration } from "./device-camera-orientation.js";

export interface CameraIntrinsics { fx: number; fy: number; cx: number; cy: number; width: number; height: number }
export interface VisualTrack { id: string; before: [number, number]; after: [number, number]; staticScene: boolean }
export interface MotionFramePair {
	before: DeviceOrientationReading; after: DeviceOrientationReading;
	calibration: CameraAxisCalibration; camera: CameraIntrinsics;
	tracks: VisualTrack[]; frames: string[]; source: string;
}
/** Uncalibrated diagnostic thresholds, not region/metric-position inference. */
export function assessRotationCompensatedMotion(input: MotionFramePair) {
	const { camera: k } = input;
	if (![k.fx, k.fy, k.cx, k.cy, k.width, k.height].every(Number.isFinite) || k.fx <= 0 || k.fy <= 0 || k.width <= 0 || k.height <= 0 || !input.source.trim() || input.frames.length < 2) throw new Error("Invalid calibrated motion input");
	const ids = new Set<string>();
	for (const track of input.tracks) {
		if (!track.id || ids.has(track.id) || track.before.length !== 2 || track.after.length !== 2 || ![...track.before, ...track.after].every(Number.isFinite) || typeof track.staticScene !== "boolean") throw new Error("Invalid visual tracks");
		ids.add(track.id);
	}
	const orientation = compareDeviceCameraOrientation(input.before, input.after, input.calibration);
	const unknown = (reason: string) => ({ status: "unknown" as const, reason, provesStationary: false as const });
	if (orientation.status === "unknown") return unknown(orientation.reason);
	// Do not widen pixel tolerances to silently absorb unreliable direction.
	if (orientation.uncertaintyDegrees > 1) return unknown("Direction uncertainty too large for pixel residual diagnostic");
	const residuals: { trackId: string; pixels: number; cell: string }[] = [];
	for (const track of input.tracks.filter(row => row.staticScene)) {
		const [x, y] = track.before, [u, v] = track.after;
		if (x < 0 || y < 0 || x >= k.width || y >= k.height || u < 0 || v < 0 || u >= k.width || v >= k.height) continue;
		const ray = [(x - k.cx) / k.fx, (y - k.cy) / k.fy, 1];
		const rotated = orientation.rayRotation.map(row => row.reduce((sum, value, i) => sum + value * ray[i]!, 0));
		if (rotated[2]! <= 1e-6) continue;
		const px = k.fx * rotated[0]! / rotated[2]! + k.cx, py = k.fy * rotated[1]! / rotated[2]! + k.cy;
		if (px < 0 || py < 0 || px >= k.width || py >= k.height) continue;
		residuals.push({ trackId: track.id, pixels: Math.hypot(u - px, v - py), cell: `${Math.floor(x * 3 / k.width)},${Math.floor(y * 3 / k.height)}` });
	}
	if (residuals.length < 12 || new Set(residuals.map(row => row.cell)).size < 4) return unknown("Insufficient broadly distributed static-scene tracks");
	const aligned = residuals.filter(row => row.pixels <= 3), remaining = residuals.filter(row => row.pixels >= 8);
	const status = aligned.length / residuals.length >= .8 ? "rotation-explained" : remaining.length / residuals.length >= .6 && new Set(remaining.map(row => row.cell)).size >= 4 ? "movement-candidate" : "unknown";
	return { status, residuals, rotationDegrees: orientation.rotationDegrees, provesStationary: false as const, reason: "Residual tracks after calibrated ray rotation. Movement candidate may still be tracking/calibration error; no metric displacement or region crossing inferred." };
}
