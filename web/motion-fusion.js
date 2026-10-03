/**
 * Fuses IMU rotation with camera optical-flow translation into a short list of
 * motion segments, plus a natural-language description for the VLM.
 *
 * Pure module (no DOM) so it can be unit-tested in Node and reused on the phone.
 *
 * Input features are per video-pair:
 *   { t, expansion, globalDx, globalDy, dYaw, edge }
 * where expansion/global come from block-flow, dYaw is the device yaw change
 * (degrees) between the two frames, and edge is the saturated-block fraction.
 *
 * Rotation is decided from the *cumulative* yaw over a window (so quick,
 * back-and-forth noise does not register); translation is taken from flow only
 * when the phone is not turning.
 */

const DEFAULTS = {
	windowMs: 1000,
	stepMs: 130,
	holdMs: 600,
	mergeMs: 800,
	turnNetDeg: 40,
	turnCoherence: 0.7,
	forwardThreshold: 0.4,
	lateralThreshold: 6,
	lateralDominance: 1.5,
	focalPx: 140,
};

function mean(values) { return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0; }

export function fuseMotion(features, options = {}) {
	const o = { ...DEFAULTS, ...options };
	if (features.length < 3) return [];
	const t0 = features[0].t;
	const tEnd = features[features.length - 1].t;

	const classifyAt = (endT) => {
		const win = features.filter((f) => f.t >= endT - o.windowMs / 1000 && f.t <= endT);
		if (win.length < 3) return null;
		let yawSigned = 0;
		let yawPath = 0;
		let expansion = 0;
		let residX = 0;
		let edge = 0;
		for (const f of win) {
			yawSigned += f.dYaw;
			yawPath += Math.abs(f.dYaw);
			expansion += f.expansion;
			residX += f.globalDx - o.focalPx * f.dYaw * Math.PI / 180;
			edge += f.edge;
		}
		const n = win.length;
		yawSigned /= 1; yawPath /= 1;
		expansion /= n;
		residX /= n;
		edge /= n;
		const coherence = yawPath > 0 ? Math.abs(yawSigned) / yawPath : 0;
		if (Math.abs(yawSigned) >= o.turnNetDeg && coherence >= o.turnCoherence) {
			return { kind: "turn", direction: yawSigned > 0 ? "left" : "right", netDeg: Math.round(yawSigned), confidence: edge > 0.5 ? "medium" : "high" };
		}
		if (Math.abs(residX) >= o.lateralThreshold && Math.abs(residX) >= Math.abs(expansion) * o.lateralDominance) {
			return { kind: "move", direction: residX > 0 ? "left" : "right", magnitude: bucket(Math.abs(residX)), confidence: edge > 0.5 ? "low" : "medium" };
		}
		if (expansion >= o.forwardThreshold) return { kind: "move", direction: "forward", magnitude: bucket(expansion), confidence: edge > 0.5 ? "low" : "high" };
		if (expansion <= -o.forwardThreshold) return { kind: "move", direction: "backward", magnitude: bucket(-expansion), confidence: edge > 0.5 ? "low" : "high" };
		return { kind: "still", direction: null, confidence: edge > 0.5 ? "low" : "high" };
	};

	const steps = [];
	for (let t = t0 + o.windowMs / 1000; t <= tEnd; t += o.stepMs / 1000) {
		const s = classifyAt(t);
		if (s) steps.push({ t, ...s });
	}
	if (steps.length === 0) return [];

	// Run-length hysteresis: only switch state after it persists for holdMs.
	const segments = [];
	let current = steps[0];
	let start = steps[0].t - o.windowMs / 1000 / 2;
	let candidate = null;
	let candidateSince = 0;
	for (let i = 1; i < steps.length; i++) {
		const s = steps[i];
		if (s.kind === current.kind && s.direction === current.direction) { candidate = null; continue; }
		if (candidate && s.kind === candidate.kind && s.direction === candidate.direction) {
			if (s.t - candidateSince >= o.holdMs / 1000) {
				segments.push({ ...current, start, end: candidateSince });
				current = candidate;
				start = candidateSince;
				candidate = null;
			}
		} else { candidate = s; candidateSince = s.t; }
	}
	segments.push({ ...current, start, end: tEnd });

	mergeShort(segments, o.mergeMs / 1000);
	return segments.map((s) => ({ kind: s.kind, direction: s.direction ?? null, netDeg: s.netDeg ?? null, magnitude: s.magnitude ?? null, confidence: s.confidence, start: round1(s.start), end: round1(s.end) }));
}

function bucket(value) { return value < 1.5 ? "slow" : value < 4 ? "moderate" : "fast"; }
function round1(v) { return Math.round(v * 10) / 10; }

function mergeShort(segments, minSeconds) {
	let changed = true;
	while (changed && segments.length > 1) {
		changed = false;
		for (let i = 0; i < segments.length; i++) {
			const g = segments[i];
			if (g.end - g.start >= minSeconds) continue;
			const prev = segments[i - 1];
			const next = segments[i + 1];
			if (prev && (!next || prev.end - prev.start >= next.end - next.start)) { prev.end = g.end; segments.splice(i, 1); }
			else if (next) { next.start = g.start; segments.splice(i, 1); }
			changed = true;
			break;
		}
	}
}

/** Turns segments into a short, natural-language description for the VLM. */
export function describeMotion(segments) {
	if (!segments.length) return "no clear motion in this window";
	const phrases = segments.map((s) => {
		const dur = Math.max(0.5, s.end - s.start);
		const seconds = dur >= 2 ? `${dur.toFixed(0)}s` : `${dur.toFixed(1)}s`;
		if (s.kind === "still") return `stayed still for about ${seconds}`;
		if (s.kind === "turn") {
			const deg = s.netDeg === null ? "" : ` roughly ${Math.abs(s.netDeg)} degrees`;
			return `turned ${s.direction}${deg} in place for about ${seconds}`;
		}
		const dir = { forward: "forward", backward: "backward", left: "to the left", right: "to the right" }[s.direction] ?? "around";
		return `moved ${dir} (${s.magnitude ?? "slow"}) for about ${seconds}`;
	});
	return "The phone's motion over this window, from sensors and camera (approximate): " + phrases.join(", then ") + ".";
}
