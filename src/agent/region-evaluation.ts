/** Independent manual judgments, not solver edges. No API or oracle in inference. */
export interface RegionJudgment {
	id: string; a: string; b: string; relation: "same" | "different" | "unknown";
	category: "rotation" | "small-move" | "boundary" | "revisit" | "similar-distinct" | "activity-scope";
	reviewer: string; rationale: string; frameRefs: string[];
}
export function evaluateRegions(prediction: { groups: { observationIds: string[] }[]; unresolvedObservationIds: string[] }, judgments: RegionJudgment[]) {
	const membership = new Map<string, number>(), unresolved = new Set(prediction.unresolvedObservationIds);
	for (const [index, group] of prediction.groups.entries()) for (const id of group.observationIds) {
		if (membership.has(id) || unresolved.has(id)) throw new Error(`Duplicate prediction membership: ${id}`);
		membership.set(id, index);
	}
	if (unresolved.size !== prediction.unresolvedObservationIds.length) throw new Error("Duplicate unresolved membership");
	const seen = new Set<string>();
	const rows = judgments.map(row => {
		const pair = [row.a, row.b].sort().join("\0");
		if (seen.has(pair) || row.a === row.b || !row.id || !row.reviewer.trim() || !row.rationale.trim() || !row.frameRefs.length
			|| !["same", "different", "unknown"].includes(row.relation)
			|| !["rotation", "small-move", "boundary", "revisit", "similar-distinct", "activity-scope"].includes(row.category)) throw new Error(`Invalid/duplicate judgment: ${row.id}`);
		seen.add(pair);
		for (const id of [row.a, row.b]) if (!membership.has(id) && !unresolved.has(id)) throw new Error(`Missing predicted observation: ${id}`);
		// Different provisional groups are a proposed separation, not a verified
		// physical distinction. Unknown membership is abstention, not a split.
		const proposed = unresolved.has(row.a) || unresolved.has(row.b) ? "unknown" : membership.get(row.a) === membership.get(row.b) ? "same" : "different";
		return { ...row, proposed, outcome: row.relation === "unknown" ? "unscored" : proposed === "unknown" ? "abstained" : proposed === row.relation ? "correct" : proposed === "same" ? "false-merge" : "false-split" };
	});
	const summarize = (items: typeof rows) => {
		const known = items.filter(row => row.relation !== "unknown"), decided = known.filter(row => row.proposed !== "unknown");
		const same = known.filter(row => row.relation === "same"), different = known.filter(row => row.relation === "different");
		const correct = decided.filter(row => row.outcome === "correct").length;
		const ratio = (a: number, b: number) => b ? a / b : null;
		return { judged: items.length, scorable: known.length, decided: decided.length, abstained: known.length - decided.length,
			falseMerges: decided.filter(row => row.outcome === "false-merge").length, falseSplits: decided.filter(row => row.outcome === "false-split").length,
			coverage: ratio(decided.length, known.length), selectiveAccuracy: ratio(correct, decided.length),
			sameRegionRecovery: ratio(same.filter(row => row.proposed === "same").length, same.length),
			differentRegionRecovery: ratio(different.filter(row => row.proposed === "different").length, different.length),
			unknownJudgmentsWithProposals: items.filter(row => row.relation === "unknown" && row.proposed !== "unknown").length };
	};
	return { summary: summarize(rows), byCategory: Object.fromEntries([...new Set(rows.map(row => row.category))].map(category => [category, summarize(rows.filter(row => row.category === category))])), rows };
}
