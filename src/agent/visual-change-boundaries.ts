import type { BoundaryEvent } from "./experience-segments.js";
import type { SegmentLink } from "./segment-association.js";
import type { VisualPipelineObservation } from "./visual-experience-pipeline.js";

/** Automatic batch-change proposals, NEVER confirmed physical crossing facts. */
export function proposeVisualChangeBoundaries(observations: VisualPipelineObservation[], links: SegmentLink[], maxGapMs = 4000) {
	const boundaries: BoundaryEvent[] = [], diagnostics = [];
	let streak = 0;
	for (let i = 1; i < observations.length; i++) {
		const before = observations[i - 1]!, after = observations[i]!;
		const matching = links.filter(link => link.kind === "visual" && (link.a === before.id && link.b === after.id || link.b === before.id && link.a === after.id));
		const score = matching.length ? Math.max(...matching.map(link => link.confidence)) : null;
		const stableMovement = after.motionSteps.length >= 2 && after.motionSteps.every(step => step.status === "movement-candidate");
		const weak = score !== null && score < .4 && stableMovement && after.atMs - before.atMs <= maxGapMs;
		streak = weak ? streak + 1 : 0;
		diagnostics.push({ observationId: after.id, score, stableMovement, weak, consecutiveWeakChanges: streak });
		if (streak === 2) boundaries.push({ id: `visual-change-${after.id}`, beforeObservationId: after.id, source: "automatic", reason: "Two consecutive low visual correspondences during VO-supported direction-stable movement: candidate batch split only, NOT verified boundary crossing", frames: [...before.frames, ...after.frames] });
	}
	return { boundaries, diagnostics, confirmedCrossings: false as const };
}
