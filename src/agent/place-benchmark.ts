/** Evaluation constraints do not prescribe room counts or a unique partition. */
export interface PlaceBenchmark {
	stability: { a: string; b: string; reason: string }[];
	separation: { a: string; b: string; reason: string; severity?: "cross-region" | "within-region" }[];
	lookup: { query: string; target: string; forbidden: string[]; reason: string }[];
}
export function scorePlaceBenchmark(prediction: { groups: { observationIds: string[] }[]; unresolvedObservationIds: string[] }, benchmark: PlaceBenchmark) {
	const groups = new Map<string, number>(), pending = new Set<string>();
	for (const [i, group] of prediction.groups.entries()) for (const id of group.observationIds) {
		if (groups.has(id)) throw new Error(`Duplicate member ${id}`); groups.set(id, i);
	}
	for (const id of prediction.unresolvedObservationIds) {
		if (groups.has(id) || pending.has(id)) throw new Error(`Duplicate member ${id}`); pending.add(id);
	}
	const check = (ids: string[], reason: string) => {
		if (!reason.trim()) throw new Error("Missing rationale");
		for (const id of ids) if (!groups.has(id) && !pending.has(id)) throw new Error(`Missing prediction ${id}`);
	};
	const same = (a: string, b: string) => groups.has(a) && groups.has(b) && groups.get(a) === groups.get(b);
	const pairRows = (rows: PlaceBenchmark["stability"], expectedSame: boolean) => {
		const seen = new Set<string>();
		return rows.map(row => {
			check([row.a, row.b], row.reason); const key = [row.a, row.b].sort().join("\0");
			if (row.a === row.b || seen.has(key)) throw new Error("Invalid duplicate pair"); seen.add(key);
			const unknown = pending.has(row.a) || pending.has(row.b);
			return { ...row, outcome: unknown ? "abstained" : same(row.a, row.b) === expectedSame ? "passed" : expectedSame ? "false-split" : "false-merge" };
		});
	};
	const stability = pairRows(benchmark.stability, true), separation = pairRows(benchmark.separation, false);
	const crossRegionFalseMerges = separation.filter(row => row.outcome === "false-merge" && ((row as { severity?: string }).severity ?? "cross-region") === "cross-region").length;
	const withinRegionFalseMerges = separation.filter(row => row.outcome === "false-merge" && (row as { severity?: string }).severity === "within-region").length;
	for (const a of benchmark.stability) if (benchmark.separation.some(b => [a.a, a.b].sort().join("\0") === [b.a, b.b].sort().join("\0"))) throw new Error("Contradictory labels");
	const lookup = benchmark.lookup.map(row => {
		check([row.query, row.target, ...row.forbidden], row.reason);
		if (row.query === row.target || row.forbidden.includes(row.query) || row.forbidden.includes(row.target)) throw new Error("Invalid lookup");
		const hit = same(row.query, row.target), contaminated = row.forbidden.some(id => same(row.query, id));
		return { ...row, hit, contaminated, outcome: hit && !contaminated ? "passed" : "failed" };
	});
	const rate = (rows: { outcome: string }[]) => rows.length ? rows.filter(row => row.outcome === "passed").length / rows.length : null;
	const S = rate(stability), D = rate(separation), U = rate(lookup);
	// Coverage/progress score, not an accuracy or safety certificate. Severe
	// cross-region errors stay separately visible and veto a passing status.
	const score = S === null || D === null || U === null ? null : 100 * (0.4 * S + 0.4 * D + 0.2 * U);
	return { summary: { score, stability: S, separation: D, historicalLookupProxy: U,
		counts: { stability: stability.length, separation: separation.length, lookup: lookup.length },
		falseMerges: separation.filter(row => row.outcome === "false-merge").length,
		crossRegionFalseMerges, withinRegionFalseMerges,
		passesSuggestedGate: S !== null && D !== null && U !== null && S >= 0.9 && D >= 0.95 && U >= 0.85 && crossRegionFalseMerges === 0,
		falseSplits: stability.filter(row => row.outcome === "false-split").length,
		abstainedPairs: [...stability, ...separation].filter(row => row.outcome === "abstained").length }, stability, separation, lookup };
}
