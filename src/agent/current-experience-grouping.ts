import type { replayVisualExperience } from "./visual-experience-pipeline.js";
type Interpretation = ReturnType<typeof replayVisualExperience>["result"]["interpretation"];

/** Primary current membership; historical identity is a separate optional claim. */
export function currentExperienceGrouping(interpretation: Interpretation) {
	const segments = interpretation.segmentation.segments;
	const roots = new Map(segments.map(segment => [segment.id, segment.id]));
	for (const hypothesis of interpretation.association.hypotheses) {
		if (hypothesis.status === "supported" && hypothesis.targetSegmentId) roots.set(hypothesis.segmentId, roots.get(hypothesis.targetSegmentId)!);
	}
	const groups = new Map<string, { id: string; observationIds: string[]; episodeIds: string[]; historicalIdentityStatus: "unrecognized" | "supported-hypothesis"; provisional: true; physicalScopeVerified: false; navigationAllowed: false }>();
	const assignments: Record<string, string> = Object.create(null);
	for (const segment of segments) {
		const rootId = roots.get(segment.id)!, root = segments.find(row => row.id === rootId)!;
		const id = `current-${root.observationIds[0]}`;
		let group = groups.get(id);
		if (!group) { group = { id, observationIds: [], episodeIds: [], historicalIdentityStatus: "unrecognized", provisional: true, physicalScopeVerified: false, navigationAllowed: false }; groups.set(id, group); }
		if (segment.id !== rootId) group.historicalIdentityStatus = "supported-hypothesis";
		group.episodeIds.push(`episode-${segment.observationIds[0]}`);
		for (const observationId of segment.observationIds) { group.observationIds.push(observationId); assignments[observationId] = id; }
	}
	return { groups: [...groups.values()], assignments, unassignedObservationIds: [] as string[],
		unrecognizedHistoricalGroupIds: [...groups.values()].filter(group => group.historicalIdentityStatus === "unrecognized").map(group => group.id),
		revision: interpretation.segmentation.revision, origin: "temporal-current-membership" as const,
		note: "Continuity supplies revisable current membership, not verified physical identity. Historical abstention never removes current membership. No cut evidence can leave an overmerged context: score this explicitly, never count coverage alone as success." };
}
