/** Direction is a quality-tagged angular constraint, never displacement evidence. */
export interface HeadingSample {
	observationId: string; atMs: number; yawDegrees: number;
	uncertaintyDegrees: number; referenceId: string;
	source: "device" | "visual-estimate" | "simulation-experiment";
	quality: "usable" | "unreliable";
	pitchDegrees?: number; rollDegrees?: number;
}
export const normalizeDegrees = (value: number) => ((value % 360) + 360) % 360;
export const signedAngle = (value: number) => normalizeDegrees(value + 180) - 180;
export function validateHeading(sample: HeadingSample) {
	if (!sample.observationId || !sample.referenceId || !Number.isFinite(sample.atMs) || !Number.isFinite(sample.yawDegrees)
		|| !Number.isFinite(sample.uncertaintyDegrees) || sample.uncertaintyDegrees < 0 || sample.uncertaintyDegrees > 180
		|| !["device", "visual-estimate", "simulation-experiment"].includes(sample.source) || !["usable", "unreliable"].includes(sample.quality)
		|| [sample.pitchDegrees, sample.rollDegrees].some(value => value !== undefined && !Number.isFinite(value))
		|| Object.keys(sample).some(key => !["observationId", "atMs", "yawDegrees", "pitchDegrees", "rollDegrees", "uncertaintyDegrees", "referenceId", "source", "quality"].includes(key))) throw new Error("Invalid heading evidence (metric pose is forbidden)");
}
export function compareHeadings(a?: HeadingSample, b?: HeadingSample, viewA = 0, viewB = 0) {
	if (a) validateHeading(a); if (b) validateHeading(b);
	if (!Number.isFinite(viewA) || !Number.isFinite(viewB)) throw new Error("Invalid camera-to-device yaw offset");
	if (!a || !b || a.quality !== "usable" || b.quality !== "usable" || a.referenceId !== b.referenceId) return { status: "unknown" as const, reason: "Missing/unreliable heading or different reference frames" };
	return { status: "available" as const, deltaDegrees: signedAngle(b.yawDegrees + viewB - a.yawDegrees - viewA), uncertaintyDegrees: Math.min(180, a.uncertaintyDegrees + b.uncertaintyDegrees), provesStationary: false as const };
}
/** Requires frequent samples; endpoint yaw cannot recover multiple revolutions. */
export function summarizeTurn(samples: HeadingSample[], maxGapMs = 1500) {
	if (!Number.isFinite(maxGapMs) || maxGapMs <= 0) throw new Error("Invalid sampling gap");
	let totalDegrees = 0, absoluteDegrees = 0;
	for (const sample of samples) validateHeading(sample);
	if (samples.length < 2) return { status: "unknown" as const, reason: "Insufficient samples" };
	for (let i = 1; i < samples.length; i++) {
		const a = samples[i - 1]!, b = samples[i]!, delta = compareHeadings(a, b);
		if (b.atMs <= a.atMs || b.atMs - a.atMs > maxGapMs || delta.status === "unknown" || Math.abs(delta.deltaDegrees) + delta.uncertaintyDegrees >= 180) return { status: "unknown" as const, reason: "Unwrap ambiguous, unreliable or interrupted" };
		totalDegrees += delta.deltaDegrees; absoluteDegrees += Math.abs(delta.deltaDegrees);
	}
	return { status: "available" as const, totalDegrees, absoluteDegrees, provesStationary: false as const };
}
