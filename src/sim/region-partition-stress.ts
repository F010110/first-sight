/** Deterministic solver validation, not perception/region accuracy evaluation. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { partitionRegions, type RegionEvidence } from "../agent/region-partition.js";
const dir = resolve(process.argv[2] ?? "run/sim/multiview-val5-clean-20261007");
const { evidence } = JSON.parse(await readFile(resolve(dir, "region-partition-review-evidence.json"), "utf8")) as { evidence: RegionEvidence[] };
const ids = Array.from({ length: 40 }, (_, i) => `observation-${i + 1}`);
const signature = (result: ReturnType<typeof partitionRegions>) => JSON.stringify([...result.groups.map(group => [...group.observationIds].sort().join(",")), ...result.unresolvedObservationIds].sort());
let seed = 7109;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
function shuffle<T>(items: T[]) { const out = [...items]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; } return out; }
const base = partitionRegions(ids, evidence), baseSignature = signature(base);
const permutations = Array.from({ length: 100 }, () => partitionRegions(shuffle(ids), shuffle(evidence)));
const faults = [0.25, 1, 3].map(weight => {
	const injected: RegionEvidence = { id: `false-bridge-${weight}`, a: ids[0]!, b: ids[7]!, relation: "same", weight, source: "synthetic-fault", reason: "Injected incorrect counter-to-bed bridge", frames: ["fault-reference"] };
	const result = partitionRegions(ids, [...evidence, injected]);
	return { weight, combinedCounterAndBed: result.groups.some(group => group.observationIds.includes(ids[0]!) && group.observationIds.includes(ids[7]!)), groups: result.groups.length, objectiveCost: result.objectiveCost, violatedEvidenceIds: result.violatedEvidenceIds };
});
const dropout = evidence.filter(edge => edge.relation === "same" && edge.weight > 0).map(edge => {
	const result = partitionRegions(ids, evidence.filter(row => row.id !== edge.id));
	return { removed: edge.id, partitionChanged: signature(result) !== baseSignature, groups: result.groups.length, unresolved: result.unresolvedObservationIds.length };
});
// Restricted-growth enumeration visits every set partition, up to seven vertices.
function exactCost(vertices: string[], edges: RegionEvidence[]) {
	const assignment = Array<number>(vertices.length).fill(0); let best = Infinity;
	const positions = new Map(vertices.map((id, index) => [id, index]));
	function visit(index: number, maximum: number) {
		if (index === vertices.length) {
			const cost = edges.reduce((sum, edge) => sum + (edge.relation === "unknown" || (assignment[positions.get(edge.a)!] === assignment[positions.get(edge.b)!]) === (edge.relation === "same") ? 0 : edge.weight), 0);
			best = Math.min(best, cost); return;
		}
		for (let label = 0; label <= maximum + 1; label++) { assignment[index] = label; visit(index + 1, Math.max(maximum, label)); }
	}
	visit(1, 0); return best;
}
let nonOptimal = 0, maxGap = 0, refinedNonOptimal = 0, refinedMaxGap = 0; const failures: unknown[] = [];
for (let trial = 0; trial < 200; trial++) {
	const vertices = Array.from({ length: 6 }, (_, i) => `v${i}`), edges: RegionEvidence[] = [];
	for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) {
		const draw = random(); if (draw < 0.25) continue;
		edges.push({ id: `${a}-${b}`, a: vertices[a]!, b: vertices[b]!, relation: draw < 0.65 ? "same" : "different", weight: 1 + Math.floor(random() * 3), source: "synthetic", reason: "Signed solver benchmark", frames: ["synthetic"] });
	}
	const greedy = partitionRegions(vertices, edges).objectiveCost, exact = exactCost(vertices, edges), gap = greedy - exact;
	const refined = partitionRegions(vertices, edges, { refine: true }).objectiveCost;
	if (refined > greedy + 1e-9 || refined < exact - 1e-9) throw new Error("Invalid refinement/reference cost");
	if (refined > exact + 1e-9) refinedNonOptimal++;
	refinedMaxGap = Math.max(refinedMaxGap, refined - exact);
	if (gap > 1e-9) { nonOptimal++; if (failures.length < 3) failures.push({ vertices, edges, greedy, exact }); }
	maxGap = Math.max(maxGap, gap);
}
const result = {
	note: "Manual-evidence robustness and synthetic solver quality only; no independent activity-region labels or automated perception. Fault endpoints intentionally target distinct reviewed layout scopes.",
	permutation: { trials: 100, changedPartitions: permutations.filter(row => signature(row) !== baseSignature).length, distinctPartitions: new Set(permutations.map(signature)).size },
	faults, singlePositiveEdgeDropout: { trials: dropout.length, changedPartitions: dropout.filter(row => row.partitionChanged).length, details: dropout },
	exactComparison: { trials: 200, vertices: 6, nonOptimal, maxGap, refinedNonOptimal, refinedMaxGap, examples: failures },
};
await writeFile(resolve(dir, "region-partition-refinement-stress.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, singlePositiveEdgeDropout: { trials: dropout.length, changedPartitions: dropout.filter(row => row.partitionChanged).length }, exactComparison: { ...result.exactComparison, examples: undefined } }, null, 2));
