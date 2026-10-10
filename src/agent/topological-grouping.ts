/** Experimental grouping proposals, not authoritative semantic region identities. */
export interface PairAffinity { a: string; b: string; score: number; directions: number }
export interface GroupProposal { id: string; members: string[]; status: "provisional"; minimumAffinity: number }
const key = (a: string, b: string) => [a, b].sort().join("\0");

/** Complete-link avoids A~B~C chaining when A and C do not match. */
export function proposePlaces(ids: string[], pairs: PairAffinity[], threshold: number, minimumDirections = 2): GroupProposal[] {
	const affinity = new Map(pairs.map(pair => [key(pair.a, pair.b), pair.directions >= minimumDirections ? pair.score : 0]));
	let groups = ids.map(id => [id]);
	const minimum = (a: string[], b: string[]) => Math.min(...a.flatMap(i => b.map(j => affinity.get(key(i, j)) ?? 0)));
	while (true) {
		let chosen: [number, number] | null = null, best = threshold - 1e-10;
		for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
			const score = minimum(groups[i]!, groups[j]!);
			if (score >= threshold && score > best) { best = score; chosen = [i, j]; }
		}
		if (!chosen) break;
		const [i, j] = chosen;
		groups[i] = [...groups[i]!, ...groups[j]!]; groups.splice(j, 1);
	}
	return groups.map((members, i) => ({ id: `place-${i + 1}`, members, status: "provisional", minimumAffinity: members.length < 2 ? 0 : Math.min(...members.flatMap((a,j) => members.slice(j + 1).map(b => affinity.get(key(a,b)) ?? 0))) }));
}

export interface RegionEdge { a: string; b: string; count: number; evidence: Array<{ from: string; to: string }> }
export function buildRegionEdges(order: string[], places: GroupProposal[]): RegionEdge[] {
	const assignment = new Map(places.flatMap(place => place.members.map(member => [member, place.id] as const)));
	const edges = new Map<string, RegionEdge>();
	for (let i = 1; i < order.length; i++) {
		const a = assignment.get(order[i - 1]!), b = assignment.get(order[i]!);
		if (!a || !b || a === b) continue;
		const k = key(a, b), edge = edges.get(k) ?? { a, b, count: 0, evidence: [] };
		edge.count++; edge.evidence.push({ from: order[i - 1]!, to: order[i]! }); edges.set(k, edge);
	}
	return [...edges.values()];
}

/** Greedy modularity proposals on repeat-supported adjacency, not route components. */
export function proposeSpaces(places: GroupProposal[], edges: RegionEdge[]): Array<{ id: string; placeIds: string[]; status: "provisional"; internalEdges: RegionEdge[]; scopeVerified: false }> {
	const supported = edges.filter(edge => edge.count >= 2);
	const degree = new Map(places.map(place => [place.id, 0]));
	for (const edge of supported) { degree.set(edge.a, degree.get(edge.a)! + edge.count); degree.set(edge.b, degree.get(edge.b)! + edge.count); }
	const total = supported.reduce((sum, edge) => sum + edge.count, 0);
	let groups = places.map(place => [place.id]);
	if (total > 0) while (true) {
		let chosen: [number, number] | null = null, gain = 1e-10;
		for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
			const a = new Set(groups[i]), b = new Set(groups[j]);
			const between = supported.filter(edge => (a.has(edge.a) && b.has(edge.b)) || (b.has(edge.a) && a.has(edge.b))).reduce((sum, edge) => sum + edge.count, 0);
			const da = groups[i]!.reduce((sum,id) => sum + degree.get(id)!, 0), db = groups[j]!.reduce((sum,id) => sum + degree.get(id)!, 0);
			const delta = between / total - da * db / (2 * total * total);
			if (between > 0 && delta > gain) { gain = delta; chosen = [i,j]; }
		}
		if (!chosen) break;
		const [i,j] = chosen; groups[i] = [...groups[i]!, ...groups[j]!]; groups.splice(j,1);
	}
	return groups.filter(group => group.length >= 2).map((placeIds,i) => ({ id: `space-candidate-${i + 1}`, placeIds, status: "provisional", internalEdges: supported.filter(edge => placeIds.includes(edge.a) && placeIds.includes(edge.b)), scopeVerified: false }));
}
