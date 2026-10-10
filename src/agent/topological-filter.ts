/** Experimental discrete localization. Scores are potentials, not calibrated probabilities. */
export const UNKNOWN = "unknown";
export interface TopologicalEdge { from: string; to: string; motion: string[] }
export interface VisualEvidence { id: string; inliers: number; similarity: number }

export function normalize(values: Map<string, number>): Map<string, number> {
	const sum = [...values.values()].reduce((a, b) => a + b, 0);
	if (!(sum > 0) || !Number.isFinite(sum)) throw new Error("Invalid belief mass");
	return new Map([...values].map(([id, score]) => [id, score / sum]));
}

/** Ignore distance, duration magnitude and compass. Preserve action order only. */
export function motionTokens(description: string | null): string[] {
	if (!description) return [];
	return [...description.matchAll(/moved (?:forward|backward|left|right)|turned (left|right)|stayed still/gi)].map(match => match[1] ? `turn_${match[1].toLowerCase()}` : /moved/i.test(match[0]) ? "move" : "still");
}

export function motionCompatibility(a: string[], b: string[]): number {
	if (!a.length || !b.length) return 1;
	const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let diagonal = previous[0]!; previous[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const old = previous[j]!;
			previous[j] = Math.min(previous[j]! + 1, previous[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
			diagonal = old;
		}
	}
	return Math.exp(-2 * previous[b.length]! / Math.max(a.length, b.length));
}

export function visualPotentials(ids: string[], evidence: VisualEvidence[], available: boolean): Map<string, number> {
	if (!available) return new Map([...ids, UNKNOWN].map(id => [id, 1]));
	const scores = new Map(evidence.map(row => [row.id, row]));
	const strongest = Math.max(0, ...evidence.map(row => row.inliers));
	const values = ids.map(id => {
		const row = scores.get(id);
		// SIFT surface evidence dominates weak global layout evidence.
		const value = row ? 0.01 + Math.pow(Math.min(row.inliers / 100, 1), 3) + 0.02 * Math.pow(row.similarity, 4) : 0.01;
		return [id, value] as const;
	});
	return new Map([...values, [UNKNOWN, strongest < 15 ? 0.7 : strongest < 40 ? 0.12 : 0.01]]);
}

export class TopologicalFilter {
	belief: Map<string, number>;
	constructor(readonly ids: string[], readonly edges: TopologicalEdge[]) {
		this.belief = normalize(new Map([...ids, UNKNOWN].map(id => [id, 1])));
	}
	update(emission: Map<string, number>, motion: string[], usePath: boolean, accumulate: boolean): Map<string, number> {
		const states = [...this.ids, UNKNOWN];
		const best = [...this.belief].sort((a, b) => b[1] - a[1])[0]!;
		// Single-frame+path uses the previous MAP state, not the full posterior.
		// Keep a uniform initial prior until a previous observation exists.
		const prior = accumulate ? this.belief : best[1] > 1 / states.length + 1e-10
			? normalize(new Map(states.map(id => [id, id === best[0] ? 1 : 0])))
			: normalize(new Map(states.map(id => [id, 1])));
		const predicted = new Map(states.map(id => [id, 0]));
		for (const from of states) {
			const row = normalize(new Map(states.map(to => {
				// Nonzero teleport and unknown mass permit relocalization and unseen regions.
				let weight = 0.03;
				if (from === UNKNOWN || to === UNKNOWN) weight = 0.2;
				else if (from === to) weight = !motion.includes("move") && motion.length ? 5 : 1;
				else {
					const edges = this.edges.filter(edge => edge.from === from && edge.to === to);
					if (edges.length) weight = Math.max(...edges.map(edge => usePath ? motionCompatibility(motion, edge.motion) : 1));
				}
				return [to, weight];
			})));
			for (const to of states) predicted.set(to, predicted.get(to)! + prior.get(from)! * row.get(to)!);
		}
		this.belief = normalize(new Map(states.map(id => [id, predicted.get(id)! * (emission.get(id) ?? 1)])));
		return new Map(this.belief);
	}
}

export function decideBelief(belief: Map<string, number>, observationAvailable = true): { id: string | null; status: "localized" | "unresolved"; confidence: number; margin: number } {
	const ranked = [...belief].sort((a, b) => b[1] - a[1]);
	const [id, confidence] = ranked[0]!;
	const margin = confidence - (ranked[1]?.[1] ?? 0);
	const localized = observationAvailable && id !== UNKNOWN && confidence >= 0.6 && margin >= 0.2;
	return { id: localized ? id : null, status: localized ? "localized" : "unresolved", confidence, margin };
}
