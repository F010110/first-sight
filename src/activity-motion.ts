import type { ActivityMotionPattern, MotionTimelineSegment } from "./agent/types.js";
import { estimateMotionTrajectory, type CalibrationInfo, type MotionCalibration, type MotionTrajectory, type TrajectorySummary } from "./dead-reckoning.js";

/**
 * Heuristic motion classifier over ~60 Hz IMU readings.
 *
 * Design goals (V1):
 * - Separate rotation around the vertical axis (yaw, a real turn) from tilting
 *   the phone (pitch/roll, just aiming it).
 * - Report a coarse travel direction relative to where the phone camera points.
 * - Be conservative: only *sustained, continuous* motion counts. Casual shaking,
 *   single spikes and one-window blips do not.
 */

const MIN_DISPLACEMENT_WINDOW_M = 0.1;
const MIN_ACTION_PATH_M = 1.5;
const MIN_TRANSLATION_RUN_PATH_M = 0.35;
const MIN_TRANSLATION_RUN_MS = 3_000;
const MIN_TURN_INPLACE_PATH_M = 1.5;
const MIN_TRANSLATION_DIRECTION_M = 0.05;
const YAW_ACTIVE_PATH_DEG = 10;
const MIN_TURN_NET_DEG = 40;
const MIN_TURN_COHERENCE = 0.6;
const MIN_TURN_PATH_DEG = 120;
const MIN_TURN_HALF_NET_DEG = 60;
const MIN_TILT_PATH_DEG = 60;
const TRAJECTORY_CALIBRATION_MS = 3_000;

type InvariantState = MotionTimelineSegment["viewHeadingChange"];

interface WindowTrajectory {
	maxSpeedMps: number;
	horizontalDisplacementM: number;
	pathM: number;
	stationaryRatio: number;
}

interface WindowFeatures {
	startMs: number;
	endMs: number;
	yawPathDeg: number;
	yawNetDeg: number;
	yawSignedDeg: number;
	yawCoherence: number;
	tiltPathDeg: number;
	accelerationDynamicRms: number;
	accelerationCoherence: number;
	yawTurn: boolean;
	activelyMoving: boolean;
	accelerationElevated: boolean;
	tiltSignificant: boolean;
	pattern: ActivityMotionPattern;
	viewHeadingChange: InvariantState;
	translationEvidence: MotionTimelineSegment["translationEvidence"];
	motionVariance: MotionTimelineSegment["motionVariance"];
	rotationAxis: NonNullable<MotionTimelineSegment["rotationAxis"]>;
	confidence: "medium" | "low";
	trajectory: WindowTrajectory | null;
}

export interface TranslationSpan {
	startMs: number;
	endMs: number;
	/** Direction relative to where the phone camera points. */
	direction: NonNullable<MotionTimelineSegment["translationDirection"]>;
	speed: NonNullable<MotionTimelineSegment["speed"]>;
	/** Accumulated travel distance in meters. */
	distanceM: number;
	/** Absolute net displacement in meters (may be much smaller than distanceM). */
	netDisplacementM: number;
	confidence: "medium" | "low";
}

export interface TurnEvent {
	startMs: number;
	endMs: number;
	/** Signed net yaw in degrees (positive = left/counter-clockwise). */
	netDeg: number;
	direction: "left" | "right" | "mixed";
	/** True when the turn happened without meaningful travel (turning in place). */
	inPlace: boolean;
	confidence: "medium" | "low";
}

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function wrapDegrees(value: number): number { return ((value + 180) % 360 + 360) % 360 - 180; }
function magnitude(vector: { x: number; y: number; z: number }): number { return Math.hypot(vector.x, vector.y, vector.z); }

function percentile(values: number[], fraction: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))]!;
}

function median(values: number[]): number {
	return percentile(values, 0.5);
}

function vectorCoherence(vectors: Array<{ x: number; y: number; z: number }>): number {
	const total = vectors.reduce((sum, vector) => sum + magnitude(vector), 0);
	if (total < 1e-6) return 1;
	const sum = vectors.reduce((acc, vector) => ({ x: acc.x + vector.x, y: acc.y + vector.y, z: acc.z + vector.z }), { x: 0, y: 0, z: 0 });
	return Math.min(1, magnitude(sum) / total);
}

/**
 * World "up" expressed in the device frame, derived from the W3C Z-X'-Y''
 * deviceorientation angles. Only the tilt matters here, so relative yaw is fine.
 */
function deviceUp(o: { alpha: number; beta: number; gamma: number }): { x: number; y: number; z: number } {
	const alpha = (o.alpha * Math.PI) / 180;
	const beta = (o.beta * Math.PI) / 180;
	const gamma = (o.gamma * Math.PI) / 180;
	const ca = Math.cos(alpha), sa = Math.sin(alpha);
	const cb = Math.cos(beta), sb = Math.sin(beta);
	const cg = Math.cos(gamma), sg = Math.sin(gamma);
	// Third row of R = Rz(alpha) * Rx(beta) * Ry(gamma), i.e. R^T * (0,0,1).
	return { x: -cb * sg, y: sb, z: cb * cg };
}

/** Rotation matrix (device -> world) for the W3C Z-X'-Y'' orientation, row-major. */
function rotationMatrix(o: { alpha: number; beta: number; gamma: number }): number[] {
	const alpha = (o.alpha * Math.PI) / 180;
	const beta = (o.beta * Math.PI) / 180;
	const gamma = (o.gamma * Math.PI) / 180;
	const ca = Math.cos(alpha), sa = Math.sin(alpha);
	const cb = Math.cos(beta), sb = Math.sin(beta);
	const cg = Math.cos(gamma), sg = Math.sin(gamma);
	return [
		ca * cg - sa * sb * sg, -sa * cb, ca * sg + sa * sb * cg,
		sa * cg + ca * sb * sg, ca * cb, sa * sg - ca * sb * cg,
		-cb * sg, sb, cb * cg,
	];
}

/** Horizontal component of the direction the phone's rear camera looks at, in world coordinates. */
function horizontalForward(o: { alpha: number; beta: number; gamma: number }): { x: number; y: number } {
	const R = rotationMatrix(o);
	// Camera points along device -z.
	const x = -R[2]!;
	const y = -R[5]!;
	const length = Math.hypot(x, y);
	return length > 1e-6 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
}

/** Horizontal component of the phone's right axis (device +x) in world coordinates. */
function horizontalRight(o: { alpha: number; beta: number; gamma: number }): { x: number; y: number } {
	const R = rotationMatrix(o);
	const x = R[0]!;
	const y = R[3]!;
	const length = Math.hypot(x, y);
	return length > 1e-6 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
}

function orientationRows(rows: Array<Record<string, unknown>>): Array<{ timeMs: number; alpha: number; beta: number; gamma: number }> {
	return rows
		.filter((row) => row.kind === "orientation" && finite(row.timeMs) && finite(row.alpha) && finite(row.beta) && finite(row.gamma))
		.map((row) => ({ timeMs: row.timeMs as number, alpha: row.alpha as number, beta: row.beta as number, gamma: row.gamma as number }));
}

function collectFeatures(motionRows: Array<Record<string, unknown>>, durationMs: number): WindowFeatures[] {
	const windows: WindowFeatures[] = [];
	const allOrientations = orientationRows(motionRows);
	for (let startMs = 0; startMs < durationMs; startMs += 2_000) {
		const endMs = Math.min(durationMs, startMs + 2_000);
		const rows = motionRows.filter((row) => finite(row.timeMs) && row.timeMs >= startMs && row.timeMs < endMs);
		const motion = rows.filter((row) => row.kind === "motion");

		const orientations = orientationRows(rows);
		// Heading (yaw) comes from the fused orientation's alpha; tilt from beta/gamma.
		// Using the fused angles avoids the device-dependent rotationRate axis naming.
		let yawPathDeg = 0;
		let yawSignedDeg = 0;
		let tiltPathDeg = 0;
		for (let index = 1; index < orientations.length; index++) {
			const previous = orientations[index - 1]!;
			const current = orientations[index]!;
			const deltaAlpha = wrapDegrees(current.alpha - previous.alpha);
			const deltaBeta = wrapDegrees(current.beta - previous.beta);
			const deltaGamma = wrapDegrees(current.gamma - previous.gamma);
			yawPathDeg += Math.abs(deltaAlpha);
			yawSignedDeg += deltaAlpha;
			tiltPathDeg += Math.hypot(deltaBeta, deltaGamma);
		}
		const yawNetDeg = Math.abs(yawSignedDeg);
		const yawCoherence = yawPathDeg > 1e-6 ? Math.min(1, yawNetDeg / yawPathDeg) : 1;

		const accelerationVectors = motion.map((row) => {
			const value = row.acceleration as Record<string, unknown> | null;
			if (!value || !finite(value.x) || !finite(value.y) || !finite(value.z)) return null;
			return { x: value.x, y: value.y, z: value.z };
		}).filter((value): value is { x: number; y: number; z: number } => value !== null);
		let accelerationDynamicRms = 0;
		let accelerationCoherence = 1;
		if (accelerationVectors.length >= 3) {
			const center = {
				x: median(accelerationVectors.map((vector) => vector.x)),
				y: median(accelerationVectors.map((vector) => vector.y)),
				z: median(accelerationVectors.map((vector) => vector.z)),
			};
			const residuals = accelerationVectors.map((vector) => ({ x: vector.x - center.x, y: vector.y - center.y, z: vector.z - center.z }));
			const energies = residuals.map((vector) => magnitude(vector) ** 2);
			accelerationDynamicRms = Math.sqrt(energies.reduce((sum, value) => sum + value, 0) / energies.length);
			accelerationCoherence = vectorCoherence(residuals);
		}

		windows.push({
			startMs, endMs,
			yawPathDeg, yawNetDeg, yawSignedDeg, yawCoherence, tiltPathDeg,
			accelerationDynamicRms, accelerationCoherence,
			yawTurn: false, activelyMoving: false, accelerationElevated: false, tiltSignificant: tiltPathDeg >= MIN_TILT_PATH_DEG,
			pattern: "mixed_or_unknown", viewHeadingChange: "unknown", translationEvidence: "unknown", motionVariance: "unknown",
			rotationAxis: "none", confidence: "low", trajectory: null,
		});
	}
	return windows;
}

/** Uses the calibrated dead-reckoning trajectory to measure sustained, continuous movement per window. */
function annotateTrajectory(windows: WindowFeatures[], trajectory: MotionTrajectory): void {
	if (!trajectory.calibration.stable) return;
	for (const window of windows) {
		const points = trajectory.points.filter((point) => point.timeMs >= window.startMs && point.timeMs < window.endMs);
		if (points.length < 3) continue;
		const first = points[0]!;
		const last = points.at(-1)!;
		const horizontalDisplacementM = Math.hypot(last.positionM.x - first.positionM.x, last.positionM.y - first.positionM.y);
		const pathM = Math.max(0, last.pathLengthM - first.pathLengthM);
		const maxSpeedMps = points.reduce((max, point) => Math.max(max, point.speedMps), 0);
		const stationaryRatio = points.filter((point) => point.stationary).length / points.length;
		window.trajectory = { maxSpeedMps, horizontalDisplacementM, pathM, stationaryRatio };
	}
}

function classifyWindows(windows: WindowFeatures[]): void {
	const lowRotationWindows = windows.filter((window) => window.yawPathDeg + window.tiltPathDeg <= percentile(windows.map((item) => item.yawPathDeg + item.tiltPathDeg), 0.4));
	const baseline = median(lowRotationWindows.map((window) => window.accelerationDynamicRms));
	const deviations = lowRotationWindows.map((window) => Math.abs(window.accelerationDynamicRms - baseline));
	const accelerationThreshold = baseline + Math.max(0.04, 1.8 * median(deviations));

	for (const window of windows) {
		window.accelerationElevated = window.accelerationDynamicRms > accelerationThreshold;
		window.tiltSignificant = window.tiltPathDeg >= MIN_TILT_PATH_DEG;
	}

	// A window is a turn when its net yaw is large and coherent, OR when it accumulates
	// a large total rotation even if it reverses (e.g. two quick 90° rotations).
	for (const window of windows) {
		window.yawTurn = (window.yawNetDeg >= MIN_TURN_NET_DEG && window.yawCoherence >= MIN_TURN_COHERENCE)
			|| (window.yawPathDeg >= MIN_TURN_PATH_DEG && window.yawNetDeg >= MIN_TURN_HALF_NET_DEG);
	}
	// Bridge a brief non-turn window sitting between two turns (e.g. a short pause mid-turn).
	for (let index = 1; index < windows.length - 1; index++) {
		if (!windows[index]!.yawTurn && windows[index - 1]!.yawTurn && windows[index + 1]!.yawTurn && windows[index]!.yawPathDeg >= YAW_ACTIVE_PATH_DEG) {
			windows[index]!.yawTurn = true;
		}
	}

	// Translation is measured solely from the double-integrated trajectory: a run
	// counts as travel only if the integrated path is long enough.
	const isMoving = (window: WindowFeatures): boolean => window.trajectory !== null
		&& window.trajectory.pathM >= MIN_DISPLACEMENT_WINDOW_M;
	for (let index = 0; index < windows.length;) {
		if (!isMoving(windows[index]!)) { index++; continue; }
		let end = index;
		let path = 0;
		while (end < windows.length && isMoving(windows[end]!)) {
			path += windows[end]!.trajectory!.pathM;
			end++;
		}
		const durationMs = windows[end - 1]!.endMs - windows[index]!.startMs;
		if (path >= MIN_TRANSLATION_RUN_PATH_M && durationMs >= MIN_TRANSLATION_RUN_MS) {
			for (let mark = index; mark < end; mark++) windows[mark]!.activelyMoving = true;
		}
		index = end;
	}

	for (const window of windows) deriveFields(window);
}

function deriveFields(window: WindowFeatures): void {
	const noHeadingChange = window.yawNetDeg < 12;
	const strongTurn = window.yawNetDeg >= 90 || (window.yawPathDeg >= 120 && window.yawNetDeg >= 60);
	const jitter = window.accelerationElevated && window.accelerationCoherence < 0.45 && !window.yawTurn && !window.activelyMoving;
	window.viewHeadingChange = window.yawTurn || strongTurn ? "significant_change" : noHeadingChange ? "no_significant_change" : "unknown";
	window.translationEvidence = window.activelyMoving
		? "possible"
		: window.trajectory && window.trajectory.stationaryRatio >= 0.6 && window.trajectory.maxSpeedMps < 0.1
			? "not_detected"
			: "unknown";
	window.motionVariance = window.accelerationElevated ? "elevated" : !window.yawTurn && !window.activelyMoving ? "low" : "unknown";
	window.rotationAxis = window.yawTurn || strongTurn ? (window.tiltSignificant ? "mixed" : "yaw") : window.tiltSignificant ? "tilt" : "none";
	// Dominant characteristic wins: a big fast turn stays a turn even if the phone
	// also drifted; otherwise sustained travel is travel; the rest falls back.
	window.pattern = strongTurn
		? "rotation_dominant"
		: window.activelyMoving
			? "translation_candidate"
			: window.yawTurn
				? "rotation_dominant"
				: jitter
					? "stationary_jitter_candidate"
					: !window.accelerationElevated && noHeadingChange
						? "low_motion"
						: "mixed_or_unknown";
	window.confidence = window.yawTurn || window.activelyMoving || strongTurn ? "medium" : "low";
}

function nearestOrientation(
	orientations: Array<{ timeMs: number; alpha: number; beta: number; gamma: number }>,
	timeMs: number,
): { timeMs: number; alpha: number; beta: number; gamma: number } | null {
	let best: { timeMs: number; alpha: number; beta: number; gamma: number } | null = null;
	let bestDistance = Infinity;
	for (const orientation of orientations) {
		const distance = Math.abs(orientation.timeMs - timeMs);
		if (distance < bestDistance) { bestDistance = distance; best = orientation; }
	}
	return bestDistance <= 500 ? best : null;
}

function meanHorizontal(vectors: Array<{ x: number; y: number }>): { x: number; y: number } | null {
	const sum = vectors.reduce((acc, vector) => ({ x: acc.x + vector.x, y: acc.y + vector.y }), { x: 0, y: 0 });
	const length = Math.hypot(sum.x, sum.y);
	return length > 1e-6 ? { x: sum.x / length, y: sum.y / length } : null;
}

/**
 * Direction relative to where the phone camera points.
 *
 * The forward/lateral axis is decided from the horizontal acceleration energy
 * projected on the phone's forward vs right axis (drift-free), and the sign
 * (forward vs backward / left vs right) from the short-window displacement.
 * This reports a curving forward walk as "forward" instead of relying on the
 * whole-segment net displacement.
 */
function classifyDirection(
	segment: { startMs: number; endMs: number },
	trajectory: MotionTrajectory,
	orientations: Array<{ timeMs: number; alpha: number; beta: number; gamma: number }>,
	motionRows: Array<Record<string, unknown>>,
): { direction: NonNullable<MotionTimelineSegment["translationDirection"]>; speed: NonNullable<MotionTimelineSegment["speed"]> } | null {
	const points = trajectory.points.filter((point) => point.timeMs >= segment.startMs && point.timeMs < segment.endMs);
	if (points.length < 3) return null;
	const first = points[0]!;
	const last = points.at(-1)!;
	const durationSec = Math.max(0.001, (segment.endMs - segment.startMs) / 1000);
	const path = Math.max(0, last.pathLengthM - first.pathLengthM);
	const avgSpeed = path / durationSec;
	const speed: NonNullable<MotionTimelineSegment["speed"]> = avgSpeed < 0.4 ? "slow" : avgSpeed < 0.9 ? "moderate" : "fast";

	// Axis (forward vs lateral) from horizontal acceleration energy along the
	// phone's own axes; sign from the integrated displacement along that axis.
	const ratio = forwardEnergyRatio(segment.startMs, segment.endMs, orientations, motionRows);
	if (ratio === null) return { direction: "mixed", speed };
	const segmentOrientations = orientations.filter((o) => o.timeMs >= segment.startMs && o.timeMs < segment.endMs);
	const forward = meanHorizontal(segmentOrientations.map(horizontalForward));
	const right = meanHorizontal(segmentOrientations.map(horizontalRight));
	const dx = last.positionM.x - first.positionM.x;
	const dy = last.positionM.y - first.positionM.y;
	if (ratio >= 0.55) {
		const signedForward = forward ? dx * forward.x + dy * forward.y : 0;
		return { direction: signedForward < 0 ? "backward" : "forward", speed };
	}
	if (ratio <= 0.4) {
		const signedLateral = right ? dx * right.x + dy * right.y : 0;
		return { direction: signedLateral < 0 ? "left" : "right", speed };
	}
	return { direction: "mixed", speed };
}

/** Forward share of horizontal acceleration energy over a time range: high = travelling forward, low = turning in place. */
function forwardEnergyRatio(
	startMs: number,
	endMs: number,
	orientations: Array<{ timeMs: number; alpha: number; beta: number; gamma: number }>,
	motionRows: Array<Record<string, unknown>>,
): number | null {
	const segmentOrientations = orientations.filter((o) => o.timeMs >= startMs && o.timeMs < endMs);
	const forward = meanHorizontal(segmentOrientations.map(horizontalForward));
	const right = meanHorizontal(segmentOrientations.map(horizontalRight));
	if (!forward || !right) return null;
	let forwardEnergy = 0;
	let lateralEnergy = 0;
	for (const row of motionRows) {
		const timeMs = row.timeMs;
		if (row.kind !== "motion" || !finite(timeMs) || timeMs < startMs || timeMs >= endMs) continue;
		const acceleration = row.acceleration as Record<string, unknown> | null;
		if (!acceleration || !finite(acceleration.x) || !finite(acceleration.y) || !finite(acceleration.z)) continue;
		const orientation = nearestOrientation(orientations, timeMs);
		if (!orientation) continue;
		const R = rotationMatrix(orientation);
		const wx = R[0]! * acceleration.x + R[1]! * acceleration.y + R[2]! * acceleration.z;
		const wy = R[3]! * acceleration.x + R[4]! * acceleration.y + R[5]! * acceleration.z;
		const projectedForward = wx * forward.x + wy * forward.y;
		const projectedLateral = wx * right.x + wy * right.y;
		forwardEnergy += projectedForward * projectedForward;
		lateralEnergy += projectedLateral * projectedLateral;
	}
	const total = forwardEnergy + lateralEnergy;
	return total > 1e-9 ? forwardEnergy / total : null;
}

export function analyzeActivityMotion(
	motionRows: Array<Record<string, unknown>>,
	frameRows: Array<Record<string, unknown>>,
	durationMs: number,
	options?: { calibration?: MotionCalibration },
): { segments: MotionTimelineSegment[]; selectedFrameIds: string[]; calibration: CalibrationInfo; trajectorySummary: TrajectorySummary; translationSpans: TranslationSpan[]; turnEvents: TurnEvent[] } {
	const windows = collectFeatures(motionRows, durationMs);
	const trajectory = estimateMotionTrajectory(motionRows, { calibrationMs: TRAJECTORY_CALIBRATION_MS, ...(options?.calibration ? { calibration: options.calibration } : {}) });
	annotateTrajectory(windows, trajectory);
	classifyWindows(windows);
	const orientations = orientationRows(motionRows);

	const segments: MotionTimelineSegment[] = [];
	const pushSegment = (window: WindowFeatures): void => {
		segments.push({
			startMs: window.startMs,
			endMs: window.endMs,
			pattern: window.pattern,
			viewHeadingChange: window.viewHeadingChange,
			translationEvidence: window.translationEvidence,
			motionVariance: window.motionVariance,
			confidence: window.confidence,
			rotationAxis: window.rotationAxis,
			representativeFrameIds: [],
		});
	};
	for (const window of windows) {
		const previous = segments.at(-1);
		if (previous && previous.pattern === window.pattern && previous.viewHeadingChange === window.viewHeadingChange
			&& previous.translationEvidence === window.translationEvidence && previous.motionVariance === window.motionVariance
			&& previous.rotationAxis === window.rotationAxis) {
			previous.endMs = window.endMs;
			previous.confidence = previous.confidence === "medium" || window.confidence === "medium" ? "medium" : "low";
		} else {
			pushSegment(window);
		}
	}
	// Direction and speed are computed over the final merged segment, not a single window.
	for (const segment of segments) {
		if (segment.translationEvidence !== "possible") continue;
		const detail = classifyDirection(segment, trajectory, orientations, motionRows);
		if (detail) {
			segment.translationDirection = detail.direction;
			segment.speed = detail.speed;
		}
	}

	// Build the two independent event streams: translation spans and turn events.
	const turnIndexRanges: Array<{ start: number; end: number; netDeg: number }> = [];
	const turnEvents: TurnEvent[] = [];
	for (let index = 0; index < windows.length;) {
		if (!windows[index]!.yawTurn) { index++; continue; }
		let end = index;
		let signed = 0;
		let anyMoving = false;
		while (end < windows.length && windows[end]!.yawTurn) {
			const windowSigned = windows[end]!.yawSignedDeg;
			if (Math.abs(signed) >= MIN_TURN_NET_DEG && windowSigned !== 0 && Math.sign(windowSigned) !== Math.sign(signed)) break;
			signed += windowSigned;
			anyMoving = anyMoving || windows[end]!.activelyMoving;
			end++;
		}
		const eventStart = windows[index]!.startMs;
		const eventEnd = windows[end - 1]!.endMs;
		turnIndexRanges.push({ start: index, end: end - 1, netDeg: signed });
		// In-place is judged solely from the double-integrated travelled path: a turn
		// that did not cover the action distance is not travel.
		const eventPoints = trajectory.points.filter((point) => point.timeMs >= eventStart && point.timeMs < eventEnd);
		const eventPath = eventPoints.length >= 2 ? Math.max(0, eventPoints.at(-1)!.pathLengthM - eventPoints[0]!.pathLengthM) : 0;
		turnEvents.push({
			startMs: eventStart,
			endMs: eventEnd,
			netDeg: Math.round(signed),
			direction: Math.abs(signed) < 20 ? "mixed" : signed > 0 ? "left" : "right",
			inPlace: eventPath < MIN_TURN_INPLACE_PATH_M,
			confidence: Math.abs(signed) >= 60 ? "medium" : "low",
		});
		index = end;
	}
	// A large reversal (>=120°) separates two travel spans (walk out, turn around, walk back).
	const reversalWindows = new Set<number>();
	for (const range of turnIndexRanges) {
		if (Math.abs(range.netDeg) < 120) continue;
		for (let index = range.start; index <= range.end; index++) reversalWindows.add(index);
	}
	const isMovingWindow = (window: WindowFeatures): boolean => window.trajectory !== null
		&& window.trajectory.pathM >= MIN_DISPLACEMENT_WINDOW_M;
	const translationSpans: TranslationSpan[] = [];
	for (let index = 0; index < windows.length;) {
		if (!isMovingWindow(windows[index]!)) { index++; continue; }
		let end = index;
		let path = 0;
		while (end < windows.length && isMovingWindow(windows[end]!)) {
			path += windows[end]!.trajectory!.pathM;
			end++;
		}
		const durationMs = windows[end - 1]!.endMs - windows[index]!.startMs;
		if (path >= MIN_TRANSLATION_RUN_PATH_M && durationMs >= MIN_TRANSLATION_RUN_MS) {
			const runStart = windows[index]!.startMs;
			const runEnd = windows[end - 1]!.endMs;
			// A large reversal turn (>=120°) in the middle splits travel into two spans
			// (walk out, turn around, walk back).
			const pieces: Array<[number, number]> = [[runStart, runEnd]];
			const reversal = turnEvents
				.filter((event) => Math.abs(event.netDeg) >= 120 && event.startMs > runStart + 1_000 && event.endMs < runEnd - 1_000)
				.sort((a, b) => Math.abs(b.netDeg) - Math.abs(a.netDeg))[0];
			if (reversal) {
				const middle = (reversal.startMs + reversal.endMs) / 2;
				pieces.length = 0;
				pieces.push([runStart, middle], [middle, runEnd]);
			}
			for (const [spanStart, spanEnd] of pieces) {
				const spanPoints = trajectory.points.filter((point) => point.timeMs >= spanStart && point.timeMs < spanEnd);
				if (spanPoints.length < 3) continue;
				const spanFirst = spanPoints[0]!;
				const spanLast = spanPoints.at(-1)!;
				const spanPath = Math.max(0, spanLast.pathLengthM - spanFirst.pathLengthM);
				if (spanPath < 0.2) continue;
				const span = { startMs: spanStart, endMs: spanEnd };
				const detail = classifyDirection(span, trajectory, orientations, motionRows);
				const netDisplacementM = Math.hypot(spanLast.positionM.x - spanFirst.positionM.x, spanLast.positionM.y - spanFirst.positionM.y);
				// An "action" requires a long enough *travelled path*; a turn in place or a
				// small shuffle does not accumulate enough path.
				if (spanPath < MIN_ACTION_PATH_M) continue;
				translationSpans.push({
					startMs: spanStart,
					endMs: spanEnd,
					direction: detail?.direction ?? "mixed",
					speed: detail?.speed ?? "slow",
					distanceM: Number(spanPath.toFixed(3)),
					netDisplacementM: Number(netDisplacementM.toFixed(3)),
					confidence: detail ? "medium" : "low",
				});
			}
		}
		index = end;
	}

	const orderedFrames = frameRows.slice().sort((a, b) => Number(a.timeMs) - Number(b.timeMs));
	const nearestFrame = (timeMs: number): Record<string, unknown> | null => orderedFrames.reduce<Record<string, unknown> | null>((best, frame) => {
		if (!best) return frame;
		return Math.abs(Number(frame.timeMs) - timeMs) < Math.abs(Number(best.timeMs) - timeMs) ? frame : best;
	}, null);
	for (const segment of segments) {
		const duration = segment.endMs - segment.startMs;
		const times = duration >= 6_000 && ["rotation_dominant", "translation_candidate", "mixed_or_unknown"].includes(segment.pattern)
			? [segment.startMs + duration / 3, segment.startMs + 2 * duration / 3]
			: [segment.pattern === "low_motion" ? (segment.startMs + segment.endMs) / 2 : segment.endMs];
		segment.representativeFrameIds = [...new Set(times.map((time) => nearestFrame(time)).filter((row): row is Record<string, unknown> => row !== null && typeof row.id === "string").map((row) => row.id as string))];
	}

	const selected = new Set<string>();
	for (const segment of segments) for (const frameId of segment.representativeFrameIds) selected.add(frameId);
	if (orderedFrames[0] && typeof orderedFrames[0].id === "string") selected.add(orderedFrames[0].id);
	if (orderedFrames.at(-1) && typeof orderedFrames.at(-1)!.id === "string") selected.add(orderedFrames.at(-1)!.id as string);
	const frameById = new Map(orderedFrames.filter((frame) => typeof frame.id === "string").map((frame) => [frame.id as string, frame]));
	let selectedRows = [...selected].map((id) => frameById.get(id)).filter((row): row is Record<string, unknown> => Boolean(row));
	if (selectedRows.length > 12) {
		const stride = (selectedRows.length - 1) / 11;
		selectedRows = Array.from({ length: 12 }, (_, index) => selectedRows[Math.round(index * stride)]!).filter(Boolean);
	}
	selectedRows.sort((a, b) => Number(a.timeMs) - Number(b.timeMs));
	const selectedIds = new Set(selectedRows.map((row) => row.id as string));
	for (const segment of segments) segment.representativeFrameIds = segment.representativeFrameIds.filter((id) => selectedIds.has(id));
	return { segments, selectedFrameIds: selectedRows.map((row) => row.id as string), calibration: trajectory.calibration, trajectorySummary: trajectory.summary, translationSpans, turnEvents };
}

/** Diagnostic helper: per-window raw features before/after classification. */
export function debugWindowFeatures(motionRows: Array<Record<string, unknown>>, durationMs: number): Array<Record<string, unknown>> {
	const windows = collectFeatures(motionRows, durationMs);
	const trajectory = estimateMotionTrajectory(motionRows, { calibrationMs: TRAJECTORY_CALIBRATION_MS });
	annotateTrajectory(windows, trajectory);
	classifyWindows(windows);
	return windows.map((window) => ({
		startMs: window.startMs,
		endMs: window.endMs,
		yawPath: Number(window.yawPathDeg.toFixed(1)),
		yawNet: Number(window.yawNetDeg.toFixed(1)),
		yawSigned: Number(window.yawSignedDeg.toFixed(1)),
		yawCoherence: Number(window.yawCoherence.toFixed(2)),
		tiltPath: Number(window.tiltPathDeg.toFixed(1)),
		yawTurn: window.yawTurn,
		activelyMoving: window.activelyMoving,
		accelerationElevated: window.accelerationElevated,
		pattern: window.pattern,
		rotationAxis: window.rotationAxis,
		trajectory: window.trajectory,
	}));
}
