import type { replayVisualExperience } from "./visual-experience-pipeline.js";
type Interpretation = ReturnType<typeof replayVisualExperience>["result"]["interpretation"];

/** Stable observation anchors, not transient segment IDs, key provisional regions. */
export function organizeRegionInterpretation(interpretation: Interpretation, bufferObservations = 1) {
	if (!Number.isInteger(bufferObservations) || bufferObservations < 0) throw new Error("Invalid boundary buffer");
	const segments = interpretation.segmentation.segments;
	const anchors = new Map(segments.map(segment => [segment.id, `experience-${segment.observationIds[0]}`]));
	return segments.map((segment, i) => {
		const hypothesis = interpretation.association.hypotheses.find(row => row.segmentId === segment.id);
		const supportedTarget = hypothesis?.status === "supported" ? hypothesis.targetSegmentId : null;
		const before = segments[i - 1], after = segments[i + 1];
		const shared = bufferObservations ? [...(before?.observationIds.slice(-bufferObservations) ?? []), ...(after?.observationIds.slice(0, bufferObservations) ?? [])] : [];
		return { temporalRegionId: anchors.get(segment.id)!, historicalCandidateId: supportedTarget ? anchors.get(supportedTarget)! : null,
			identityStatus: supportedTarget ? "supported-historical-hypothesis" : hypothesis?.status === "ambiguous" ? "ambiguous" : "new-or-unrecognized-candidate",
			physicalScopeVerified: false as const, observationIds: segment.observationIds.slice(), sharedBoundaryAnchorIds: bufferObservations ? shared : [],
			parentRegionId: null, subregionIds: [] as string[], note: "Temporal organization is not proof of one physical region. Shared anchors do not change unique primary observation membership." };
	});
}
