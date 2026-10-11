import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { segmentExperience, type BoundaryEvent, type SegmentObservation } from "./experience-segments.js";
import { associateSegments, type SegmentLink, type SegmentContradiction } from "./segment-association.js";
interface RevisionInput { boundaries: BoundaryEvent[]; links: SegmentLink[]; contradictions: SegmentContradiction[]; reason: string }
/** Full interpretation history is retained, while raw observations never change. */
export class SegmentInterpretationStore {
	private observations: SegmentObservation[];
	private revisions: RevisionInput[] = [];
	constructor(observations: SegmentObservation[]) { segmentExperience(observations, [], 1); this.observations = structuredClone(observations); }
	private interpret(input: RevisionInput, revision: number) {
		if (!input.reason.trim()) throw new Error("Revision rationale required");
		const segmentation = segmentExperience(this.observations, input.boundaries, revision);
		const candidates = segmentation.segments.map((segment, i) => ({ ...segment, sharedBoundaryAnchorIds: [...(segmentation.segments[i - 1]?.observationIds.slice(-1) ?? []), ...(segmentation.segments[i + 1]?.observationIds.slice(0, 1) ?? [])] }));
		const association = associateSegments(candidates, input.links, input.contradictions, revision);
		return { reason: input.reason, segmentation, association };
	}
	revise(input: RevisionInput) {
		const staged = structuredClone(input), result = this.interpret(staged, this.revisions.length + 1);
		this.revisions.push(staged); return result;
	}
	snapshot() { return { observations: structuredClone(this.observations), revisions: this.revisions.map((input, i) => this.interpret(input, i + 1)) }; }
	async persist(path: string) {
		await mkdir(dirname(path), { recursive: true });
		const tmp = `${path}.${randomUUID()}.tmp`;
		await writeFile(tmp, JSON.stringify({ schemaVersion: 1, observations: this.observations, revisions: this.revisions }, null, 2));
		await rename(tmp, path);
	}
	async load(path: string) {
		const data = JSON.parse(await readFile(path, "utf8"));
		if (data.schemaVersion !== 1 || !Array.isArray(data.observations) || !Array.isArray(data.revisions)) throw new Error("Invalid segment bundle");
		const staged = new SegmentInterpretationStore(data.observations);
		for (const revision of data.revisions) staged.revise(revision);
		this.observations = staged.observations; this.revisions = staged.revisions;
	}
}
