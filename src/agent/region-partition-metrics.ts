/** Metrics for ONE predeclared label layer; ambiguous/boundary labels stay excluded. */
export function scorePartitionLayer(truth: Record<string, string | null>, prediction: Record<string, string | null>) {
	const ids = Object.keys(truth);
	for (const id of ids) if (!(id in prediction)) throw new Error(`Missing predicted observation ${id}`);
	for (const value of [...Object.values(truth), ...Object.values(prediction)]) if (value !== null && (typeof value !== "string" || !value)) throw new Error("Invalid partition label");
	const known = ids.filter(id => truth[id] !== null), assigned = known.filter(id => prediction[id] !== null);
	let tp = 0, fp = 0, fn = 0, abstainedPairs = 0, totalPairs = 0;
	for (let i = 0; i < known.length; i++) for (let j = i + 1; j < known.length; j++) {
		const a = known[i]!, b = known[j]!; totalPairs++;
		const sameTruth = truth[a] === truth[b], unknown = prediction[a] === null || prediction[b] === null;
		if (unknown) { abstainedPairs++; if (sameTruth) fn++; continue; }
		const samePrediction = prediction[a] === prediction[b];
		if (sameTruth && samePrediction) tp++; else if (samePrediction) fp++; else if (sameTruth) fn++;
	}
	const choose2 = (n: number) => n * (n - 1) / 2;
	const rows = new Map<string, number>(), cols = new Map<string, number>(), cells = new Map<string, number>();
	for (const id of assigned) {
		const a = truth[id]!, b = prediction[id]!, key = JSON.stringify([a, b]);
		rows.set(a, (rows.get(a) ?? 0) + 1); cols.set(b, (cols.get(b) ?? 0) + 1); cells.set(key, (cells.get(key) ?? 0) + 1);
	}
	const total = choose2(assigned.length), sumRows = [...rows.values()].reduce((sum, n) => sum + choose2(n), 0), sumCols = [...cols.values()].reduce((sum, n) => sum + choose2(n), 0), sumCells = [...cells.values()].reduce((sum, n) => sum + choose2(n), 0);
	const expected = total ? sumRows * sumCols / total : 0, denominator = (sumRows + sumCols) / 2 - expected;
	const ari = !total ? null : Math.abs(denominator) < 1e-12 ? 1 : (sumCells - expected) / denominator;
	return { truthObservations: known.length, assigned: assigned.length, coverage: known.length ? assigned.length / known.length : null,
		pairPrecision: tp + fp ? tp / (tp + fp) : null, pairRecall: tp + fn ? tp / (tp + fn) : null,
		pairF1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null, tp, falseMergedPairs: fp, missedSamePairs: fn,
		abstainedPairs, pairCoverage: totalPairs ? (totalPairs - abstainedPairs) / totalPairs : null,
		ariOnAssignedOnly: ari, note: "ARI excludes unknown predictions and must be paired with coverage. Pair recall counts same-label abstentions as unrecovered. Only compare at the same declared granularity; no prescribed room count." };
}
