/** Add positively corroborated local identities without deleting baseline work. */
export function supplementLocalEvidence(baseline: { groups: { observationIds: string[] }[]; unresolvedObservationIds: string[] }, pairs: { a: string; b: string }[]) {
	const groups = baseline.groups.map(group => [...group.observationIds]);
	const pending = new Set(baseline.unresolvedObservationIds), known = new Set<string>();
	for (const id of [...groups.flat(), ...pending]) { if (known.has(id)) throw new Error("Duplicate baseline membership"); known.add(id); }
	const key = (a: string, b: string) => JSON.stringify([a, b].sort());
	const positive = new Set<string>();
	for (const pair of pairs) { if (!known.has(pair.a) || !known.has(pair.b) || pair.a === pair.b) throw new Error("Invalid supplemental edge"); positive.add(key(pair.a, pair.b)); }
	const additions = [];
	for (const { a, b } of pairs) {
		const ga = groups.findIndex(group => group.includes(a)), gb = groups.findIndex(group => group.includes(b));
		// Existing separate groups are NOT merged by local geometry alone.
		if (ga >= 0 && gb >= 0) continue;
		if (pending.has(a) && pending.has(b)) { groups.push([a, b]); pending.delete(a); pending.delete(b); additions.push({ a, b, kind: "new-local-hypothesis" }); }
		else {
			const candidate = pending.has(a) ? a : pending.has(b) ? b : null, target = ga >= 0 ? ga : gb;
			if (candidate && target >= 0 && groups[target]!.every(member => positive.has(key(candidate, member)))) { groups[target]!.push(candidate); pending.delete(candidate); additions.push({ a, b, kind: "all-anchor-local-support" }); }
		}
	}
	return { groups: groups.map((observationIds, i) => ({ id: `supplemental-local-${i + 1}`, observationIds })), unresolvedObservationIds: [...pending], additions, note: "Baseline preserved; new hypotheses are local geometric support, not complete region grouping. Existing cross-region errors are not repaired by this supplement." };
}
