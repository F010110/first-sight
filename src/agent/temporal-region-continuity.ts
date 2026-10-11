import type { BoundaryEvent, SegmentObservation } from "./experience-segments.js";

/** Evidence producers must validate tracks; these are not raw object detections. */
export interface ContinuityEvidence {
	id: string; source: string; frames: string[];
	kind: "rotation-support" | "movement-support" | "boundary-approach" | "boundary-passage" | "post-boundary-support" | "returned-inside";
	/** Stable tracked doorway OR declared open-space structural boundary. */
	boundaryTrackId?: string;
}
export interface ContinuityInput { observation: SegmentObservation; evidence: ContinuityEvidence[] }
export interface ContinuityOptions { maxGapMs: number; maxCrossingMs: number; confirmationFrames: number }
const defaults: ContinuityOptions = { maxGapMs: 1500, maxCrossingMs: 10000, confirmationFrames: 2 };

/** Ordered replay. Continuation is provisional, never stationary/region truth. */
export function proposeTemporalBoundaries(inputs: ContinuityInput[], options: ContinuityOptions = defaults) {
	if (!Number.isFinite(options.maxGapMs) || options.maxGapMs <= 0 || !Number.isFinite(options.maxCrossingMs) || options.maxCrossingMs <= 0 || !Number.isInteger(options.confirmationFrames) || options.confirmationFrames < 2) throw new Error("Invalid continuity options");
	const observations = new Set<string>(), evidenceIds = new Set<string>();
	const boundaries: BoundaryEvent[] = [], trace = [];
	const confirmations: { boundaryEventId: string; beforeObservationId: string; confirmedAtObservationId: string; confirmedAtMs: number; confirmationDelayMs: number }[] = [];
	let active: { track: string; beganMs: number; passageId: string | null; confirmations: number; provenance: ContinuityEvidence[] } | null = null;
	let previous: SegmentObservation | null = null;
	for (const { observation, evidence } of inputs) {
		if (!observation.id || observations.has(observation.id) || !Number.isFinite(observation.atMs) || !observation.frames.length || previous && observation.atMs <= previous.atMs) throw new Error("Invalid ordered continuity observations");
		observations.add(observation.id);
		for (const edge of evidence) {
			if (!edge.id || evidenceIds.has(edge.id) || !edge.source.trim() || !edge.frames.length || !["rotation-support", "movement-support", "boundary-approach", "boundary-passage", "post-boundary-support", "returned-inside"].includes(edge.kind) || ["boundary-approach", "boundary-passage", "post-boundary-support", "returned-inside"].includes(edge.kind) && !edge.boundaryTrackId) throw new Error("Invalid continuity evidence");
			evidenceIds.add(edge.id);
		}
		const gap = previous !== null && observation.atMs - previous.atMs > options.maxGapMs;
		if (gap || active && observation.atMs - active.beganMs > options.maxCrossingMs) active = null;
		let status = gap ? "unknown-after-gap" : previous ? "provisional-continuation" : "initial-unknown";
		// A hiatus cannot be bridged by evidence attached to its first endpoint.
		if (!gap) {
			const approach = evidence.find(edge => edge.kind === "boundary-approach");
			if (!active && approach) active = { track: approach.boundaryTrackId!, beganMs: observation.atMs, passageId: null, confirmations: 0, provenance: [approach] };
			if (active) {
				const matching = evidence.filter(edge => edge.boundaryTrackId === active!.track);
				if (matching.some(edge => edge.kind === "returned-inside")) active = null;
				else {
					const passage = matching.find(edge => edge.kind === "boundary-passage");
					if (!active.passageId && passage && evidence.some(edge => edge.kind === "movement-support") && active.beganMs < observation.atMs) {
						active.passageId = observation.id;
						active.provenance.push(passage, ...evidence.filter(edge => edge.kind === "movement-support"));
					}
					if (active.passageId && active.passageId !== observation.id) {
						const post = matching.filter(edge => edge.kind === "post-boundary-support");
						if (post.length) { active.confirmations++; active.provenance.push(...post); }
						else active.confirmations = 0;
					}
					status = active.passageId ? "suspected-crossing" : "approaching-boundary";
					if (active.confirmations >= options.confirmationFrames) {
						boundaries.push({ id: `temporal-crossing-${boundaries.length + 1}`, beforeObservationId: active.passageId!, source: "automatic", reason: `Tracked boundary ${active.track}: approach, movement-supported passage and sustained post-boundary observations. Proposal only; confirmed at ${observation.id}. Evidence: ${active.provenance.map(edge => edge.id).join(", ")}`, frames: [...new Set(active.provenance.flatMap(edge => edge.frames))] });
						const cutTime = inputs.find(row => row.observation.id === active!.passageId)!.observation.atMs;
						confirmations.push({ boundaryEventId: boundaries.at(-1)!.id, beforeObservationId: active.passageId!, confirmedAtObservationId: observation.id, confirmedAtMs: observation.atMs, confirmationDelayMs: observation.atMs - cutTime });
						active = null; status = "crossing-proposed";
					}
				}
			}
		}
		trace.push({ observationId: observation.id, status, boundaryTrackId: active?.track ?? null, provesStationary: false as const, historicalRegionId: null });
		previous = observation;
	}
	return { boundaries, trace, confirmations, note: "Boundary proposals only. No historical identity or navigation permission. Missing crossing evidence cannot prove no crossing; replay permits revision. Rotation support never vetoes positive crossing evidence." };
}
