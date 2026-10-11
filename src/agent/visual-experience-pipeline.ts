import { proposeTemporalBoundaries, type ContinuityEvidence, type ContinuityOptions } from "./temporal-region-continuity.js";
import { SegmentInterpretationStore } from "./segment-interpretation-store.js";
import type { SegmentObservation, BoundaryEvent } from "./experience-segments.js";
import type { SegmentLink, SegmentContradiction } from "./segment-association.js";
import { proposeVisualChangeBoundaries } from "./visual-change-boundaries.js";
import { proposeCoherentContextChanges } from "./coherent-context-changes.js";

export interface VisualMotionStep {
	beforeFrame: string; afterFrame: string;
	status: "movement-candidate" | "skipped-rotation" | "no-visible-motion" | "unknown";
}
export interface VisualPipelineObservation extends SegmentObservation {
	/** All adjacent visual steps since the preceding observation, in order. */
	motionSteps: VisualMotionStep[];
	/** From an independent tracked-boundary producer, never VO alone. */
	boundaryEvidence: ContinuityEvidence[];
}
/** Experiment integration only. No simulator identity/pose inputs accepted. */
export function replayVisualExperience(input: VisualPipelineObservation[], links: SegmentLink[], contradictions: SegmentContradiction[] = [], options: ContinuityOptions = { maxGapMs: 4000, maxCrossingMs: 15000, confirmationFrames: 2 }, additionalBoundaries: BoundaryEvent[] = []) {
	const store = new SegmentInterpretationStore(input.map(({ id, atMs, frames }) => ({ id, atMs, frames })));
	const motionSummary: { observationId: string; candidateSteps: number; maxConsecutiveCandidates: number; continuousMovement: boolean; unknownOrSkipped: boolean }[] = [];
	const continuityInputs = input.map(row => {
		for (const [i, step] of row.motionSteps.entries()) {
			if (!step.beforeFrame || !step.afterFrame || step.beforeFrame === step.afterFrame || !["movement-candidate", "skipped-rotation", "no-visible-motion", "unknown"].includes(step.status) || i > 0 && row.motionSteps[i - 1]!.afterFrame !== step.beforeFrame) throw new Error("Invalid ordered motion steps");
		}
		let run = 0, maxRun = 0;
		for (const step of row.motionSteps) { run = step.status === "movement-candidate" ? run + 1 : 0; maxRun = Math.max(run, maxRun); }
		// No inference across skipped/unknown intervals; motion alone never
		// invents approach/passage/post-boundary structural evidence.
		const continuousMovement = row.motionSteps.length >= 2 && row.motionSteps.every(step => step.status === "movement-candidate");
		const evidence = structuredClone(row.boundaryEvidence);
		if (continuousMovement) evidence.push({ id: `vo-motion-${row.id}`, kind: "movement-support", source: "experimental-three-view-vo; repeated candidate support, not metric position", frames: [...new Set(row.motionSteps.flatMap(step => [step.beforeFrame, step.afterFrame]))] });
		motionSummary.push({ observationId: row.id, candidateSteps: row.motionSteps.filter(step => step.status === "movement-candidate").length, maxConsecutiveCandidates: maxRun, continuousMovement, unknownOrSkipped: row.motionSteps.some(step => ["unknown", "skipped-rotation"].includes(step.status)) });
		return { observation: { id: row.id, atMs: row.atMs, frames: row.frames }, evidence };
	});
	const continuity = proposeTemporalBoundaries(continuityInputs, options);
	const contextChanges = proposeCoherentContextChanges(input, links, options.maxGapMs);
	const visualChanges = proposeVisualChangeBoundaries(input, links, options.maxGapMs);
	const confirmedCuts = new Set(continuity.boundaries.map(event => event.beforeObservationId));
	const hiatusBoundaries = input.slice(1).flatMap((row, i) => row.atMs - input[i]!.atMs > options.maxGapMs ? [{ id: `recording-hiatus-${row.id}`, beforeObservationId: row.id, source: "automatic" as const, reason: "Recording hiatus: split temporal context only, NOT evidence of physical region crossing", frames: [...input[i]!.frames, ...row.frames] }] : []);
	if (additionalBoundaries.some(event => event.source !== "automatic")) throw new Error("Inference pipeline refuses oracle boundary overrides");
	// Failed real replay acceptance: weak changes remain diagnostic only.
	const boundaries = [...continuity.boundaries, ...hiatusBoundaries];
	for (const event of contextChanges.boundaries) if (!boundaries.some(other=>other.beforeObservationId===event.beforeObservationId)) boundaries.push(event);
	for (const event of additionalBoundaries) if (!boundaries.some(other => other.beforeObservationId === event.beforeObservationId)) boundaries.push(event);
	// Positive grouping contradictions can revise context without a doorway
	// detector. Absent/weak visual links are NOT contradictions.
	const order = new Map(input.map((row, i) => [row.id, i]));
	for (const edge of contradictions) {
		// Historical identity veto does not by itself prove a spatial/context cut.
		if(edge.source==="historical-association-veto")continue;
		const a = order.get(edge.a), b = order.get(edge.b);
		if (a === undefined || b === undefined || a === b) throw new Error("Invalid context contradiction endpoints");
		const first = Math.min(a, b), last = Math.max(a, b);
		if (boundaries.some(event => { const index = order.get(event.beforeObservationId)!; return index > first && index <= last; })) continue;
		boundaries.push({ id: `context-contradiction-${edge.id}`, beforeObservationId: input[last]!.id, source: "automatic", reason: `Positive same-group contradiction ${edge.id}: ${edge.reason}. Revisable context split, NOT certified physical crossing.`, frames: edge.frames });
	}
	const interpretation = store.revise({ boundaries, links, contradictions, reason: "Ordered VO + independent crossing tracks + explicitly weak visual batch changes; preserve raw observations and reversible historical proposals" });
	return { store, result: { motionSummary, continuity, contextChanges, visualChanges, hiatusBoundaries, interpretation, limitations: "Current context continuity/departure are revisable grouping hypotheses, not verified physical crossings. Legacy weak single-interval changes remain diagnostic only. Recording hiatus splits temporal contexts, not physical identities. Baseline identities preserved separately; production memory and RequestAgent unchanged." } };
}
