/** Signed evidence graph. No image scores, motion defaults, or forced connectivity. */
export interface RegionEvidence {
	id: string; a: string; b: string;
	relation: "same" | "different" | "unknown";
	weight: number; source: string; reason: string; frames: string[];
}

/** Greedy additive edge contraction for the multicut objective (not an exact solver).
 * Unknowns have zero cost. Unconnected observations remain unresolved, not different.
 * Observations and evidence are never mutated; recalculation is a reversible proposal.
 */
export function partitionRegions(ids: string[], evidence: RegionEvidence[]) {
	if (new Set(ids).size !== ids.length) throw new Error("Duplicate observation ID");
	const valid = new Set(ids), evidenceIds = new Set<string>();
	for (const edge of evidence) {
		if (!valid.has(edge.a) || !valid.has(edge.b) || edge.a === edge.b || evidenceIds.has(edge.id)
			|| !Number.isFinite(edge.weight) || edge.weight < 0 || !edge.source || !edge.reason || !edge.frames.length
			|| !["same", "different", "unknown"].includes(edge.relation)) throw new Error(`Invalid region evidence: ${edge.id}`);
		evidenceIds.add(edge.id);
	}
	const signed = evidence.filter(edge => edge.relation !== "unknown" && edge.weight > 0);
	let groups = ids.map(id => [id]);
	const history: { members: string[]; gain: number; evidenceIds: string[] }[] = [];
	while (true) {
		let best: { i: number; j: number; gain: number; edges: RegionEvidence[] } | null = null;
		for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
			const a = new Set(groups[i]), b = new Set(groups[j]);
			const edges = signed.filter(edge => a.has(edge.a) && b.has(edge.b) || a.has(edge.b) && b.has(edge.a));
			const gain = edges.reduce((sum, edge) => sum + (edge.relation === "same" ? edge.weight : -edge.weight), 0);
			if (gain > 1e-9 && (!best || gain > best.gain)) best = { i, j, gain, edges };
		}
		if (!best) break;
		groups[best.i] = [...groups[best.i]!, ...groups[best.j]!]; groups.splice(best.j, 1);
		history.push({ members: [...groups[best.i]!], gain: best.gain, evidenceIds: best.edges.map(edge => edge.id) });
	}
	const assignment = new Map(groups.flatMap((members, index) => members.map(id => [id, index] as const)));
	const violated = signed.filter(edge => (assignment.get(edge.a) === assignment.get(edge.b)) !== (edge.relation === "same"));
	return {
		algorithm: "greedy-additive-edge-contraction-multicut" as const,
		groups: groups.filter(members => members.length > 1).map((observationIds, index) => ({
			id: `region-proposal-${index + 1}`, observationIds, status: "provisional" as const, scopeVerified: false,
		})),
		unresolvedObservationIds: groups.filter(members => members.length === 1).flat(),
		objectiveCost: violated.reduce((sum, edge) => sum + edge.weight, 0),
		violatedEvidenceIds: violated.map(edge => edge.id), history,
		warning: "Soft evidence partition, not calibrated probabilities. Separate proposals do not establish different physical regions. No navigation authorization. Greedy merges can drift through chains; inspect membership and conflicts.",
	};
}
