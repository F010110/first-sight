export interface PrefixSnapshot { atMs: number; assignments: Record<string, string | null> }
/** Track pairwise membership, not unstable generated node names. */
export function scorePrefixStability(snapshots: PrefixSnapshot[]) {
	const previous = new Map<string, string>(), changes: { atMs: number; a: string; b: string; before: string; after: string }[] = [];
	let comparisons = 0, lastTime = -Infinity;
	const known = new Set<string>();
	for (const snapshot of snapshots) {
		if (!Number.isFinite(snapshot.atMs) || snapshot.atMs <= lastTime || Object.values(snapshot.assignments).some(value => value !== null && (typeof value !== "string" || !value))) throw new Error("Invalid prefix snapshot");
		for (const id of known) if (!(id in snapshot.assignments)) throw new Error("Prefix history disappeared");
		lastTime = snapshot.atMs;
		const ids = Object.keys(snapshot.assignments).sort(); for (const id of ids) known.add(id);
		for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
			const a = ids[i]!, b = ids[j]!, x = snapshot.assignments[a], y = snapshot.assignments[b];
			const value = x === null || y === null ? "unknown" : x === y ? "same" : "different", key = JSON.stringify([a, b]);
			if (previous.has(key)) { comparisons++; if (previous.get(key) !== value) changes.push({ atMs: snapshot.atMs, a, b, before: previous.get(key)!, after: value }); }
			previous.set(key, value);
		}
	}
	return { comparisons, changes, resolvedRelationFlips: changes.filter(row => row.before !== "unknown" && row.after !== "unknown").length,
		retractions: changes.filter(row => row.before !== "unknown" && row.after === "unknown").length,
		resolutions: changes.filter(row => row.before === "unknown" && row.after !== "unknown").length,
		note: "Consistency is not correctness. Unknown-to-supported changes and repairs are distinguished; final offline scores cannot replace this trace." };
}
