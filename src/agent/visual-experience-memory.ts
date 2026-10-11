import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { ExperienceGraph } from "./experience-graph.js";
import { ExperienceAssociation, type CorrespondenceEvidence } from "./experience-association.js";
import { replayVisualExperience, type VisualPipelineObservation } from "./visual-experience-pipeline.js";
import type { SegmentLink, SegmentContradiction } from "./segment-association.js";
import { organizeRegionInterpretation } from "./region-interpretation.js";
import { validateRegionHierarchy, type RegionScope } from "./revisable-region-hierarchy.js";
import type { BoundaryEvent } from "./experience-segments.js";
interface InterpretationInput { observations: VisualPipelineObservation[]; links: SegmentLink[]; contradictions: SegmentContradiction[]; reason: string; automaticBoundaryProposals?: { event: BoundaryEvent; availableAtMs: number }[] }

/** Additive integration: new temporal hypotheses NEVER erase baseline abilities. */
export class VisualExperienceMemory {
	private interpretations: InterpretationInput[] = [];
	private reviews: { observationIds: string[]; targetNodeId: string | null; previousNodeIds: (string | null)[]; reason: string }[] = [];
	private hierarchyRevisions: { scopes: RegionScope[]; reason: string }[] = [];
	constructor(readonly association = new ExperienceAssociation(new ExperienceGraph(), true)) {}
	addObservation(input: Parameters<ExperienceGraph["addObservation"]>[0]) { this.association.graph.addObservation(input); }
	addEvidence(input: CorrespondenceEvidence) { this.association.addEvidence(input); this.association.reconsider(); }
	reject(...args: Parameters<ExperienceAssociation["reject"]>) { this.association.reject(...args); }
	searchObjects(query: string) { return this.association.graph.searchObjects(query); }
	reviseHierarchy(scopes: RegionScope[], reason: string) {
		if (!reason.trim()) throw new Error("Hierarchy revision rationale required");
		const staged = validateRegionHierarchy(scopes, this.association.graph.getState().observations.map(row => row.id));
		this.hierarchyRevisions.push({ scopes: staged, reason });
		return { revision: this.hierarchyRevisions.length, scopes: structuredClone(staged) };
	}
	hierarchy() { return structuredClone(this.hierarchyRevisions.at(-1)?.scopes ?? []); }
	private evaluate(input: InterpretationInput) {
		if (!input.reason.trim()) throw new Error("Interpretation rationale required");
		const raw = this.association.graph.getState().observations;
		// Prefix interpretations may remain in history after later observations.
		for (const row of input.observations) {
			const original = raw.find(other => other.id === row.id);
			if (!original || original.atMs !== row.atMs || JSON.stringify(original.frames) !== JSON.stringify(row.frames)) throw new Error("Interpretation must reference unchanged original observations");
		}
		const proposals = input.automaticBoundaryProposals ?? [];
		const latestTime = input.observations.at(-1)?.atMs ?? -Infinity;
		if (proposals.some(row => !Number.isFinite(row.availableAtMs) || row.availableAtMs > latestTime)) throw new Error("Future boundary confirmation is not available to this prefix");
		return replayVisualExperience(input.observations, input.links, input.contradictions, undefined, proposals.map(row => row.event)).result;
	}
	interpret(input: InterpretationInput) {
		const staged = structuredClone(input), result = this.evaluate(staged);
		this.interpretations.push(staged);
		return { revision: this.interpretations.length, ...result, regions: organizeRegionInterpretation(result.interpretation), effective: this.effective() };
	}
	/** Online append; only already observed correspondence endpoints are accepted. */
	observe(input: Parameters<ExperienceGraph["addObservation"]>[0], motionSteps: VisualPipelineObservation["motionSteps"], boundaryEvidence: VisualPipelineObservation["boundaryEvidence"], links: SegmentLink[] = [], correspondences: CorrespondenceEvidence[] = [], automaticBoundaryProposals: NonNullable<InterpretationInput["automaticBoundaryProposals"]> = []) {
		const before = this.snapshot();
		try {
			this.addObservation(input);
			for (const pair of correspondences) this.association.addEvidence(pair);
			if (correspondences.length) this.association.reconsider();
			const previous = this.interpretations.at(-1);
			const observations = [...(previous?.observations ?? []), { id: input.id, atMs: input.atMs, frames: input.frames, motionSteps, boundaryEvidence }];
			return this.interpret({ observations, links: [...(previous?.links ?? []), ...links], contradictions: previous?.contradictions ?? [], automaticBoundaryProposals: [...(previous?.automaticBoundaryProposals ?? []), ...automaticBoundaryProposals], reason: `Online prefix through ${input.id}` });
		} catch (error) { this.association.restoreBundle(before.baseline); this.interpretations = before.interpretations; throw error; }
	}
	/** Explicit reviewed edits; never automatic acceptance of uncertain temporal scope. */
	reviewBinding(observationIds: string[], targetNodeId: string | null, reason: string) {
		if (!reason.trim() || !observationIds.length || new Set(observationIds).size !== observationIds.length) throw new Error("Invalid reviewed binding");
		const raw = this.association.graph.getState().observations;
		const previousNodeIds = observationIds.map(id => { const row = raw.find(other => other.id === id); if (!row) throw new Error("Unknown reviewed observation"); return row.nodeId; });
		this.association.graph.rebind(observationIds, targetNodeId, `Reviewed: ${reason}`);
		this.reviews.push({ observationIds: observationIds.slice(), targetNodeId, previousNodeIds, reason });
	}
	createReviewedRegion(observationIds: string[], reason: string) {
		if (!reason.trim() || observationIds.length < 2 || new Set(observationIds).size !== observationIds.length) throw new Error("Reviewed region needs distinct evidence anchors and rationale");
		const raw = this.association.graph.getState().observations;
		const previousNodeIds = observationIds.map(id => { const row = raw.find(other => other.id === id); if (!row) throw new Error("Unknown reviewed observation"); return row.nodeId; });
		const targetNodeId = this.association.graph.createNode(observationIds, `Reviewed new region: ${reason}`);
		this.reviews.push({ observationIds: observationIds.slice(), targetNodeId, previousNodeIds, reason });
		return targetNodeId;
	}
	retractLastReview(reason: string) {
		if (!reason.trim() || !this.reviews.length) throw new Error("No review to retract or missing rationale");
		const review = this.reviews.at(-1)!, raw = this.association.graph.getState().observations;
		if (review.observationIds.some(id => raw.find(row => row.id === id)?.nodeId !== review.targetNodeId)) throw new Error("Later binding prevents blind review undo");
		const bundle = this.association.getBundle();
		try { for (const [i, id] of review.observationIds.entries()) this.association.graph.rebind([id], review.previousNodeIds[i]!, `Review retraction: ${reason}`); }
		catch (error) { this.association.restoreBundle(bundle); throw error; }
		this.reviews.pop();
	}
	effective() {
		const state = this.association.graph.getState();
		return { groups: state.nodes.filter(node => node.observationIds.length).map(node => ({ id: node.id, observationIds: node.observationIds })), unresolvedObservationIds: state.observations.filter(row => row.nodeId === null).map(row => row.id), transitions: state.transitions, origin: "preserved-baseline" as const,
			note: "Baseline visual identities retained, including known unresolved errors. Temporal hypotheses are separate and do not veto/overwrite baseline. No new region correctness claimed." };
	}
	snapshot() { return { baseline: this.association.getBundle(), interpretations: structuredClone(this.interpretations), reviews: structuredClone(this.reviews), hierarchyRevisions: structuredClone(this.hierarchyRevisions), effective: this.effective() }; }
	async persist(path: string) {
		await mkdir(dirname(path), { recursive: true });
		const temp = `${path}.${randomUUID()}.tmp`;
		await writeFile(temp, JSON.stringify({ protocol: "visual-experience-memory-v1", ...this.snapshot() }, null, 2));
		await rename(temp, path);
	}
	async load(path: string) {
		const data = JSON.parse(await readFile(path, "utf8"));
		if (data.protocol !== "visual-experience-memory-v1" || !Array.isArray(data.interpretations)) throw new Error("Invalid integrated memory bundle");
		const staged = new VisualExperienceMemory();
		staged.association.restoreBundle(data.baseline);
		for (const input of data.interpretations) staged.interpret(input);
		const reviews = data.reviews ?? [];
		if (!Array.isArray(reviews)) throw new Error("Invalid review history");
		for (const review of reviews) {
			if (!review.reason?.trim() || !Array.isArray(review.observationIds) || !review.observationIds.length || new Set(review.observationIds).size !== review.observationIds.length || !Array.isArray(review.previousNodeIds) || review.observationIds.length !== review.previousNodeIds.length || review.observationIds.some((id: string) => !staged.association.graph.getState().observations.some(row => row.id === id)) || [...review.previousNodeIds, review.targetNodeId].some((id: string | null) => id !== null && !staged.association.graph.getState().nodes.some(node => node.id === id))) throw new Error("Invalid reviewed bindings");
		}
		staged.reviews = structuredClone(reviews);
		const hierarchyRevisions = data.hierarchyRevisions ?? [];
		if (!Array.isArray(hierarchyRevisions)) throw new Error("Invalid hierarchy history");
		for (const revision of hierarchyRevisions) staged.reviseHierarchy(revision.scopes, revision.reason);
		this.association.restoreBundle(staged.association.getBundle());
		this.interpretations = staged.interpretations;
		this.reviews = staged.reviews;
		this.hierarchyRevisions = staged.hierarchyRevisions;
	}
}
