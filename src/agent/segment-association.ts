/** Historical batch identity is separate from temporal segmentation. */
export interface SegmentCandidate { id: string; observationIds: string[]; anchorObservationIds?: string[]; sharedBoundaryAnchorIds?: string[] }
export interface SegmentLink {
	id: string; a: string; b: string;
	kind: "visual" | "geometric" | "object-track";
	confidence: number; source: string; frames: string[];
}
export interface SegmentContradiction { id: string; a: string; b: string; reason: string; source: string; frames: string[] }
export function associateSegments(segments: SegmentCandidate[], links: SegmentLink[], contradictions: SegmentContradiction[], revision: number) {
	if (!Number.isInteger(revision) || revision < 1) throw new Error("Invalid revision");
	const ids = new Set<string>(), observations = new Set<string>(), evidenceIds = new Set<string>();
	for (const segment of segments) {
		if (!segment.id || ids.has(segment.id) || !segment.observationIds.length) throw new Error("Invalid segment"); ids.add(segment.id);
		for (const id of segment.observationIds) { if (observations.has(id)) throw new Error("Overlapping segment observations"); observations.add(id); }
		if (segment.anchorObservationIds && (!segment.anchorObservationIds.length || new Set(segment.anchorObservationIds).size !== segment.anchorObservationIds.length || segment.anchorObservationIds.some(id => !segment.observationIds.includes(id)))) throw new Error("Invalid representative anchor inventory");
	}
	for (const segment of segments) if (segment.sharedBoundaryAnchorIds && (new Set(segment.sharedBoundaryAnchorIds).size !== segment.sharedBoundaryAnchorIds.length || segment.sharedBoundaryAnchorIds.some(id => !observations.has(id)))) throw new Error("Invalid shared boundary anchors");
	for (const edge of [...links, ...contradictions]) {
		if (!edge.id || evidenceIds.has(edge.id) || !observations.has(edge.a) || !observations.has(edge.b) || edge.a === edge.b || !edge.source.trim() || !edge.frames.length) throw new Error("Invalid segment evidence"); evidenceIds.add(edge.id);
	}
	for (const edge of links) if (!["visual", "geometric", "object-track"].includes(edge.kind) || !Number.isFinite(edge.confidence) || edge.confidence < 0 || edge.confidence > 1) throw new Error("Invalid link confidence/type");
	for (const edge of contradictions) if (!edge.reason.trim()) throw new Error("Missing contradiction reason");
	const hypotheses = [];
	const historicalRoot = new Map(segments.map(segment => [segment.id, segment.id]));
	for (let i = 1; i < segments.length; i++) {
		const query = segments[i]!, candidates = [];
		for (const target of segments.slice(0, i)) {
			const left = new Set(query.observationIds), right = new Set(target.observationIds);
			const crosses = (edge: { a: string; b: string }) => left.has(edge.a) && right.has(edge.b) || left.has(edge.b) && right.has(edge.a);
			const rejected = contradictions.filter(crosses), evidence = links.filter(edge => crosses(edge) && edge.confidence >= .4);
			const shared = new Set(query.sharedBoundaryAnchorIds ?? []);
			const supplementary = links.filter(edge => edge.confidence >= .4 && (shared.has(edge.a) && right.has(edge.b) || shared.has(edge.b) && right.has(edge.a)));
			// Maximum bipartite matching prevents one object/view repeated many times
			// from masquerading as independent anchor coverage.
			const matched = new Map<string, string>();
			const neighbors = new Map<string, string[]>();
			for (const edge of evidence) { const a = left.has(edge.a) ? edge.a : edge.b, b = right.has(edge.b) ? edge.b : edge.a; neighbors.set(a, [...(neighbors.get(a) ?? []), b]); }
			const augment = (a: string, seen: Set<string>): boolean => {
				for (const b of neighbors.get(a) ?? []) if (!seen.has(b)) { seen.add(b); if (!matched.has(b) || augment(matched.get(b)!, seen)) { matched.set(b, a); return true; } }
				return false;
			};
			for (const a of neighbors.keys()) augment(a, new Set());
			const structural = evidence.filter(edge => edge.kind !== "visual");
			const structuralLeft = new Set(structural.map(edge => left.has(edge.a) ? edge.a : edge.b));
			const structuralRight = new Set(structural.map(edge => right.has(edge.b) ? edge.b : edge.a));
			const enough = matched.size >= 2 && Math.min(matched.size / (query.anchorObservationIds?.length ?? left.size), matched.size / (target.anchorObservationIds?.length ?? right.size)) >= .1;
			candidates.push({ targetSegmentId: target.id, historicalCandidateId: historicalRoot.get(target.id)!, status: rejected.length ? "rejected" : enough && structuralLeft.size >= 2 && structuralRight.size >= 2 ? "eligible" : evidence.length || supplementary.length ? "proposed" : "unknown", anchorMatches: matched.size, evidenceIds: evidence.map(edge => edge.id), supplementaryBoundaryEvidenceIds: supplementary.map(edge => edge.id), contradictionIds: rejected.map(edge => edge.id) });
		}
		// Several views/episodes of an already supported historical identity are
		// not separate competitors. A conflict with ANY member vetoes that root.
		const rejectedRoots = new Set(candidates.filter(candidate => candidate.status === "rejected").map(candidate => candidate.historicalCandidateId));
		const eligibleRoots = [...new Set(candidates.filter(candidate => candidate.status === "eligible" && !rejectedRoots.has(candidate.historicalCandidateId)).map(candidate => candidate.historicalCandidateId))];
		const targetSegmentId = eligibleRoots.length === 1 ? eligibleRoots[0]! : null;
		if (targetSegmentId) historicalRoot.set(query.id, targetSegmentId);
		hypotheses.push({ segmentId: query.id, targetSegmentId, status: eligibleRoots.length === 1 ? "supported" : eligibleRoots.length > 1 ? "ambiguous" : "unknown", candidates });
	}
	return { revision, note: "Recomputable historical segment hypotheses, not irreversible region merges. Pure visual links never confirm region identity. Structural links need multi-anchor validation; input quality is not guaranteed by this function.", hypotheses };
}
