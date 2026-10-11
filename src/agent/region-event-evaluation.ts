export interface TransitionTruth { id: string; earliestMs: number; latestMs: number }
export interface TransitionPrediction { id: string; atMs: number }
/** Ordered one-to-one alignment maximizes hits, then minimizes timing error. */
export function scoreTransitions(truth: TransitionTruth[], predictions: TransitionPrediction[], toleranceMs = 0) {
	if (!Number.isFinite(toleranceMs) || toleranceMs < 0) throw new Error("Invalid event tolerance");
	const ids = new Set<string>();
	for (const row of truth) {
		if (!row.id || ids.has(row.id) || !Number.isFinite(row.earliestMs) || !Number.isFinite(row.latestMs) || row.latestMs < row.earliestMs) throw new Error("Invalid truth event"); ids.add(row.id);
	}
	ids.clear();
	for (const row of predictions) { if (!row.id || ids.has(row.id) || !Number.isFinite(row.atMs)) throw new Error("Invalid predicted event"); ids.add(row.id); }
	const t = [...truth].sort((a, b) => a.earliestMs - b.earliestMs), p = [...predictions].sort((a, b) => a.atMs - b.atMs);
	for (let i = 1; i < t.length; i++) if (t[i]!.earliestMs <= t[i - 1]!.latestMs) throw new Error("Overlapping truth event intervals require adjudication");
	type Alignment = { hits: number; error: number; pairs: { truthId: string; predictionId: string; signedDelayMs: number; outsideBufferMs: number }[] };
	const dp: Alignment[][] = Array.from({ length: t.length + 1 }, () => Array.from({ length: p.length + 1 }, () => ({ hits: 0, error: 0, pairs: [] })));
	const better = (a: Alignment, b: Alignment) => a.hits > b.hits || a.hits === b.hits && a.error < b.error ? a : b;
	for (let i = 1; i <= t.length; i++) for (let j = 1; j <= p.length; j++) {
		let best = better(dp[i - 1]![j]!, dp[i]![j - 1]!);
		const a = t[i - 1]!, b = p[j - 1]!;
		const delay = b.atMs < a.earliestMs ? b.atMs - a.earliestMs : b.atMs > a.latestMs ? b.atMs - a.latestMs : 0;
		if (Math.abs(delay) <= toleranceMs) {
			const prev = dp[i - 1]![j - 1]!;
			best = better(best, { hits: prev.hits + 1, error: prev.error + Math.abs(delay), pairs: [...prev.pairs, { truthId: a.id, predictionId: b.id, signedDelayMs: delay, outsideBufferMs: Math.abs(delay) }] });
		} dp[i]![j] = best;
	}
	const result = dp[t.length]![p.length]!;
	return { hits: result.hits, truthEvents: t.length, predictedEvents: p.length, falsePositives: p.length - result.hits, missed: t.length - result.hits,
		precision: p.length ? result.hits / p.length : null, recall: t.length ? result.hits / t.length : null,
		f1: t.length + p.length ? 2 * result.hits / (t.length + p.length) : null,
		meanOutsideBufferMs: result.hits ? result.error / result.hits : null, matches: result.pairs };
}
/** Edges here mean observed directed transitions, not navigation permission. */
export function scoreObservedEdges(truth: { from: string; to: string }[], prediction: { from: string; to: string }[]) {
	const key = (row: { from: string; to: string }) => {
		if (!row.from || !row.to || row.from === row.to) throw new Error("Invalid topology edge"); return JSON.stringify([row.from, row.to]);
	};
	const t = new Set(truth.map(key)), p = new Set(prediction.map(key));
	const hits = [...p].filter(edge => t.has(edge)).length;
	return { hits, precision: p.size ? hits / p.size : null, recall: t.size ? hits / t.size : null, falseEdgeKeys: [...p].filter(edge => !t.has(edge)), missedEdgeKeys: [...t].filter(edge => !p.has(edge)), navigable: false };
}
