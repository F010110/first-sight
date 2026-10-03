/**
 * Calibrated inertial dead-reckoning for activity recordings.
 *
 * The browser stores raw `devicemotion` / `deviceorientation` readings at roughly
 * 60 Hz. This module turns those readings into a short-horizon, locally metric
 * velocity estimate. It is deliberately conservative:
 *
 * 1. The first `calibrationMs` of a recording is assumed to be quasi-static.
 *    That window estimates the gyroscope bias, the gravity vector in a
 *    fixed world frame and the accelerometer noise floor. Initial velocity is
 *    therefore zero.
 * 2. Acceleration is rotated from the device frame into the world frame with the
 *    fused device orientation, then gravity (measured during calibration) is
 *    removed.
 * 3. The residual is integrated to velocity. A zero-velocity update (ZUPT)
 *    resets velocity whenever the device is detected as quasi-static, which is
 *    what keeps the estimate from drifting without bound.
 *
 * This is NOT an absolute or global position sensor. Yaw is relative, translation
 * is only locally metric and the value degrades quickly while the device keeps
 * moving. Every output carries an explicit confidence and the drift notes.
 */

export interface Vector3 {
	x: number;
	y: number;
	z: number;
}

export interface MotionSample {
	timeMs: number;
	/** Gravity-removed linear acceleration reported by the browser. */
	linearAcceleration: Vector3 | null;
	/** Acceleration including gravity reported by the browser. */
	accelerationIncludingGravity: Vector3 | null;
	/** Rotation rate in degrees per second. */
	rotationRate: Vector3 | null;
	/** Fused orientation (degrees) attached from the nearest previous sample. */
	orientation: { alpha: number; beta: number; gamma: number } | null;
}

export interface CalibrationInfo {
	startMs: number;
	endMs: number;
	sampleCount: number;
	/** Mean gravity vector expressed in the world frame, m/s². */
	gravityWorld: Vector3;
	/** Mean gyroscope reading during the static window, degrees per second. */
	gyroBiasDps: Vector3;
	/** RMS of the gravity-removed acceleration during the static window, m/s². */
	accelerationNoiseMps2: number;
	/** Median bias-corrected rotation-rate magnitude during the static window, deg/s. */
	gyroNoiseDps: number;
	/** True when the calibration window itself looked reasonably still. */
	stable: boolean;
}

export interface TrajectoryPoint {
	timeMs: number;
	velocityMps: Vector3;
	speedMps: number;
	horizontalSpeedMps: number;
	positionM: Vector3;
	horizontalDistanceM: number;
	pathLengthM: number;
	stationary: boolean;
	confidence: "high" | "medium" | "low";
}

export interface TrajectorySummary {
	maxSpeedMps: number;
	finalSpeedMps: number;
	totalPathM: number;
	netDisplacementM: number;
	horizontalDisplacementM: number;
	stationaryRatio: number;
	confidence: "high" | "medium" | "low";
	notes: string[];
}

export interface MotionTrajectory {
	calibration: CalibrationInfo;
	points: TrajectoryPoint[];
	summary: TrajectorySummary;
}

export interface DeadReckoningOptions {
	/** Assumed quasi-static calibration window at the start. Defaults to 3000 ms. */
	calibrationMs?: number;
	/** Rolling window used by the zero-velocity detector. Defaults to 500 ms. */
	zeroVelocityWindowMs?: number;
	/** Consecutive static time required before the ZUPT engages. Defaults to 300 ms. */
	zeroVelocityHoldMs?: number;
	/** Integration is skipped across gaps longer than this. Defaults to 200 ms. */
	maxIntegrationGapMs?: number;
	/** Rotation-rate magnitude below which the device is treated as still, deg/s. */
	staticGyroDps?: number;
	/** Gravity-removed acceleration magnitude below which the device is still, m/s². */
	staticAccelerationMps2?: number;
	/**
	 * Pre-computed calibration from a known static period (e.g. the start of a
	 * live session). When supplied, it is used instead of calibrating this window.
	 */
	calibration?: MotionCalibration;
}

/** The subset of calibration needed to integrate a live window. */
export interface MotionCalibration {
	gravityWorld: Vector3;
	gyroBiasDps: Vector3;
	accelerationNoiseMps2: number;
	gyroNoiseDps: number;
	stable: boolean;
}

type ResolvedOptions = Required<Omit<DeadReckoningOptions, "calibration">>;

const DEFAULT_OPTIONS: ResolvedOptions = {
	calibrationMs: 3_000,
	zeroVelocityWindowMs: 500,
	zeroVelocityHoldMs: 300,
	maxIntegrationGapMs: 200,
	staticGyroDps: 0,
	staticAccelerationMps2: 0,
};

function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveNumber(value: unknown): number | null {
	const parsed = finiteNumber(value);
	return parsed !== null && parsed >= 0 ? parsed : null;
}

function readVector(value: unknown): Vector3 | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	const x = finiteNumber(record.x);
	const y = finiteNumber(record.y);
	const z = finiteNumber(record.z);
	if (x === null || y === null || z === null) return null;
	return { x, y, z };
}

/** Rotation rates use the alpha/beta/gamma axis names, unlike the x/y/z acceleration vectors. */
function readRotationRate(value: unknown): Vector3 | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	const x = finiteNumber(record.alpha);
	const y = finiteNumber(record.beta);
	const z = finiteNumber(record.gamma);
	if (x === null || y === null || z === null) return null;
	return { x, y, z };
}

function magnitude(vector: Vector3): number {
	return Math.hypot(vector.x, vector.y, vector.z);
}

function subtract(a: Vector3, b: Vector3): Vector3 {
	return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.5 * sorted.length) - 1))]!;
}

/**
 * Rotates a device-frame vector into the world frame using the W3C
 * Z-X'-Y'' deviceorientation convention. Yaw (`alpha`) is assumed to be
 * relative; that is enough because gravity and distance do not depend on it.
 */
function deviceToWorld(orientation: { alpha: number; beta: number; gamma: number }, vector: Vector3): Vector3 {
	const alpha = (orientation.alpha * Math.PI) / 180;
	const beta = (orientation.beta * Math.PI) / 180;
	const gamma = (orientation.gamma * Math.PI) / 180;
	const ca = Math.cos(alpha);
	const sa = Math.sin(alpha);
	const cb = Math.cos(beta);
	const sb = Math.sin(beta);
	const cg = Math.cos(gamma);
	const sg = Math.sin(gamma);
	// R = Rz(alpha) * Rx(beta) * Ry(gamma)
	const r00 = ca * cg - sa * sb * sg;
	const r01 = -sa * cb;
	const r02 = ca * sg + sa * sb * cg;
	const r10 = sa * cg + ca * sb * sg;
	const r11 = ca * cb;
	const r12 = sa * sg - ca * sb * cg;
	const r20 = -cb * sg;
	const r21 = sb;
	const r22 = cb * cg;
	return {
		x: r00 * vector.x + r01 * vector.y + r02 * vector.z,
		y: r10 * vector.x + r11 * vector.y + r12 * vector.z,
		z: r20 * vector.x + r21 * vector.y + r22 * vector.z,
	};
}

/** Parses the raw `motion.jsonl` rows, attaching the nearest previous orientation to each motion sample. */
export function parseMotionSamples(rows: Array<Record<string, unknown>>): MotionSample[] {
	type OrientationRow = { timeMs: number; alpha: number; beta: number; gamma: number };
	const motion: MotionSample[] = [];
	const orientations: OrientationRow[] = [];
	for (const row of rows) {
		const timeMs = positiveNumber(row.timeMs);
		if (timeMs === null) continue;
		const kind = typeof row.kind === "string" ? row.kind : undefined;
		const hasAcceleration = readVector(row.accelerationIncludingGravity) !== null || readVector(row.acceleration) !== null;
		if (kind === "orientation" || (!hasAcceleration && finiteNumber(row.alpha) !== null)) {
			const alpha = finiteNumber(row.alpha);
			const beta = finiteNumber(row.beta);
			const gamma = finiteNumber(row.gamma);
			if (alpha !== null && beta !== null && gamma !== null) orientations.push({ timeMs, alpha, beta, gamma });
			continue;
		}
		// A row without an explicit kind that carries a rotation rate is a motion sample.
		const rotationRate = readRotationRate(row.rotationRate);
		if (kind === "motion" || rotationRate !== null || hasAcceleration) {
			motion.push({
				timeMs,
				linearAcceleration: readVector(row.acceleration),
				accelerationIncludingGravity: readVector(row.accelerationIncludingGravity),
				rotationRate,
				orientation: null,
			});
		}
	}
	motion.sort((a, b) => a.timeMs - b.timeMs);
	orientations.sort((a, b) => a.timeMs - b.timeMs);
	let cursor = -1;
	for (const sample of motion) {
		while (cursor + 1 < orientations.length && orientations[cursor + 1]!.timeMs <= sample.timeMs) cursor += 1;
		const orientation = cursor >= 0 ? orientations[cursor]! : orientations[0] ?? null;
		if (orientation) sample.orientation = { alpha: orientation.alpha, beta: orientation.beta, gamma: orientation.gamma };
	}
	return motion;
}

/** Returns the gravity vector in the world frame for a sample, or null when it cannot be computed. */
function worldGravityAcceleration(sample: MotionSample): Vector3 | null {
	if (!sample.accelerationIncludingGravity || !sample.orientation) return null;
	return deviceToWorld(sample.orientation, sample.accelerationIncludingGravity);
}

function meanVector(vectors: Vector3[]): Vector3 {
	if (vectors.length === 0) return { x: 0, y: 0, z: 0 };
	const sum = vectors.reduce((acc, vector) => ({ x: acc.x + vector.x, y: acc.y + vector.y, z: acc.z + vector.z }), { x: 0, y: 0, z: 0 });
	return { x: sum.x / vectors.length, y: sum.y / vectors.length, z: sum.z / vectors.length };
}

function calibrate(samples: MotionSample[], calibrationMs: number, options: ResolvedOptions): CalibrationInfo {
	const endMs = samples.length === 0 ? 0 : Math.min(samples[0]!.timeMs + calibrationMs, samples.at(-1)!.timeMs);
	const window = samples.filter((sample) => sample.timeMs <= endMs);
	const worldGravity = window.map(worldGravityAcceleration).filter((value): value is Vector3 => value !== null);
	const gravityWorld = meanVector(worldGravity);
	const gyroBias = meanVector(window.map((sample) => sample.rotationRate).filter((value): value is Vector3 => value !== null));
	const residuals: number[] = [];
	const correctedGyro: number[] = [];
	for (const sample of window) {
		const world = worldGravityAcceleration(sample);
		if (world) residuals.push(magnitude(subtract(world, gravityWorld)));
		if (sample.rotationRate) correctedGyro.push(magnitude(subtract(sample.rotationRate, gyroBias)));
	}
	const accelerationNoiseMps2 = residuals.length ? Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length) : 0;
	const gyroNoiseDps = median(correctedGyro);
	const gyroThreshold = options.staticGyroDps > 0 ? options.staticGyroDps : Math.max(4, gyroNoiseDps * 5);
	const accelerationThreshold = options.staticAccelerationMps2 > 0 ? options.staticAccelerationMps2 : Math.max(0.25, accelerationNoiseMps2 * 4);
	const stable = worldGravity.length >= 5 && gyroNoiseDps <= gyroThreshold && accelerationNoiseMps2 <= accelerationThreshold;
	return {
		startMs: samples[0]?.timeMs ?? 0,
		endMs,
		sampleCount: window.length,
		gravityWorld,
		gyroBiasDps: gyroBias,
		accelerationNoiseMps2,
		gyroNoiseDps,
		stable,
	};
}

/**
 * Estimates a locally metric velocity/position trajectory from raw IMU rows.
 * The output should be read as "how fast the phone was moving relative to a
 * fixed point", not as world coordinates.
 */
export function estimateMotionTrajectory(rows: Array<Record<string, unknown>>, options?: DeadReckoningOptions): MotionTrajectory {
	const { calibration: providedCalibration, ...rest } = options ?? {};
	const resolved: ResolvedOptions = { ...DEFAULT_OPTIONS, ...rest };
	const samples = parseMotionSamples(rows);
	const calibration: CalibrationInfo = providedCalibration
		? { startMs: samples[0]?.timeMs ?? 0, endMs: (samples[0]?.timeMs ?? 0) + resolved.calibrationMs, sampleCount: samples.length, ...providedCalibration }
		: calibrate(samples, resolved.calibrationMs, resolved);
	const gyroThreshold = resolved.staticGyroDps > 0 ? resolved.staticGyroDps : Math.max(4, calibration.gyroNoiseDps * 5);
	const accelerationThreshold = resolved.staticAccelerationMps2 > 0 ? resolved.staticAccelerationMps2 : Math.max(0.25, calibration.accelerationNoiseMps2 * 4);

	const points: TrajectoryPoint[] = [];
	const velocity: Vector3 = { x: 0, y: 0, z: 0 };
	const position: Vector3 = { x: 0, y: 0, z: 0 };
	let pathLengthM = 0;
	let previous: MotionSample | null = null;
	// Rolling history of the detector inputs so a single spike cannot trigger or break a ZUPT.
	const recentGyro: Array<{ timeMs: number; value: number }> = [];
	const recentAccel: Array<{ timeMs: number; value: number }> = [];
	let staticSinceMs: number | null = null;
	let lastZeroVelocityMs: number | null = null;

	for (const sample of samples) {
		const world = worldGravityAcceleration(sample);
		const rotation = sample.rotationRate ? subtract(sample.rotationRate, calibration.gyroBiasDps) : null;
		if (world) {
			recentGyro.push({ timeMs: sample.timeMs, value: rotation ? magnitude(rotation) : 0 });
			const residual = magnitude(subtract(world, calibration.gravityWorld));
			recentAccel.push({ timeMs: sample.timeMs, value: residual });
			const cutoff = sample.timeMs - resolved.zeroVelocityWindowMs;
			while (recentGyro.length && recentGyro[0]!.timeMs < cutoff) recentGyro.shift();
			while (recentAccel.length && recentAccel[0]!.timeMs < cutoff) recentAccel.shift();
		}
		if (!world || !sample.orientation) {
			previous = sample;
			continue;
		}

		const peakGyro = recentGyro.reduce((max, entry) => Math.max(max, entry.value), 0);
		const medianAccel = median(recentAccel.map((entry) => entry.value));
		const isStatic = peakGyro <= gyroThreshold && medianAccel <= accelerationThreshold;
		if (isStatic) {
			if (staticSinceMs === null) staticSinceMs = sample.timeMs;
		} else {
			staticSinceMs = null;
		}
		const zuptEngaged = isStatic && staticSinceMs !== null && sample.timeMs - staticSinceMs >= resolved.zeroVelocityHoldMs;

		if (previous) {
			const dt = (sample.timeMs - previous.timeMs) / 1000;
			if (dt > 0 && dt <= resolved.maxIntegrationGapMs / 1000) {
				const acceleration = subtract(world, calibration.gravityWorld);
				// Trapezoidal integration of the world-frame linear acceleration.
				const previousWorld = worldGravityAcceleration(previous);
				const previousAcceleration = previousWorld ? subtract(previousWorld, calibration.gravityWorld) : acceleration;
				velocity.x += ((previousAcceleration.x + acceleration.x) / 2) * dt;
				velocity.y += ((previousAcceleration.y + acceleration.y) / 2) * dt;
				velocity.z += ((previousAcceleration.z + acceleration.z) / 2) * dt;
				if (zuptEngaged) {
					velocity.x = 0;
					velocity.y = 0;
					velocity.z = 0;
					lastZeroVelocityMs = sample.timeMs;
				}
				position.x += velocity.x * dt;
				position.y += velocity.y * dt;
				position.z += velocity.z * dt;
				pathLengthM += magnitude(velocity) * dt;
			} else {
				velocity.x = 0;
				velocity.y = 0;
				velocity.z = 0;
			}
		}
		previous = sample;

		const speedMps = magnitude(velocity);
		const horizontalSpeedMps = Math.hypot(velocity.x, velocity.y);
		const horizontalDistanceM = Math.hypot(position.x, position.y);
		const sinceZero = lastZeroVelocityMs === null ? sample.timeMs - calibration.endMs : sample.timeMs - lastZeroVelocityMs;
		const confidence: TrajectoryPoint["confidence"] = !calibration.stable
			? "low"
			: zuptEngaged
				? "high"
				: sinceZero <= 2_000 && peakGyro <= gyroThreshold * 3
					? "medium"
					: "low";
		points.push({ timeMs: sample.timeMs, velocityMps: { ...velocity }, speedMps, horizontalSpeedMps, positionM: { ...position }, horizontalDistanceM, pathLengthM, stationary: zuptEngaged, confidence });
	}

	const maxSpeedMps = points.reduce((max, point) => Math.max(max, point.speedMps), 0);
	const final = points.at(-1);
	const stationaryCount = points.filter((point) => point.stationary).length;
	const stationaryRatio = points.length ? stationaryCount / points.length : 0;
	const netDisplacementM = final ? magnitude(final.positionM) : 0;
	const notes: string[] = [];
	if (!calibration.stable) notes.push("起始标定窗口看起来不稳定：速度估计置信度低。");
	notes.push("速度是相对于标定时刻静止点的局部估计，不是绝对/地理速度。");
	notes.push("偏航为相对方向，位移会随时间漂移；长时间连续运动后仅作粗略参考。");
	if (stationaryRatio < 0.1 && points.length > 0) notes.push("整段几乎没有检测到静止间隙，零速校正很少，漂移可能占主导。");
	return {
		calibration,
		points,
		summary: {
			maxSpeedMps,
			finalSpeedMps: final ? final.speedMps : 0,
			totalPathM: pathLengthM,
			netDisplacementM,
			horizontalDisplacementM: final ? final.horizontalDistanceM : 0,
			stationaryRatio,
			confidence: !calibration.stable ? "low" : stationaryRatio >= 0.2 ? "medium" : "low",
			notes,
		},
	};
}

/** Formats a byte-free, human-readable per-second table for CLI validation. */
export function formatTrajectoryTable(trajectory: MotionTrajectory, stepMs = 2_000): string {
	const lines = [" t(s)  speed  hspeed  path  |hdisp|  static  conf"];
	for (let timeMs = trajectory.points[0]?.timeMs ?? 0; timeMs <= (trajectory.points.at(-1)?.timeMs ?? 0); timeMs += stepMs) {
		const point = trajectory.points.find((candidate) => candidate.timeMs >= timeMs);
		if (!point) break;
		lines.push([
			(point.timeMs / 1000).toFixed(1).padStart(5),
			point.speedMps.toFixed(2).padStart(6),
			point.horizontalSpeedMps.toFixed(2).padStart(6),
			point.pathLengthM.toFixed(2).padStart(6),
			point.horizontalDistanceM.toFixed(2).padStart(6),
			(point.stationary ? "yes" : "no").padStart(6),
			point.confidence.padStart(6),
		].join(" "));
	}
	return lines.join("\n");
}
