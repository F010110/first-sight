/** Deterministic stress tests on cached visual evidence; no VLM or motion. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TopologicalFilter, visualPotentials, decideBelief, type VisualEvidence, type TopologicalEdge } from "../../agent/topological-filter.js";
const dir = resolve(process.argv[2] ?? "run/sim/multiview-val5-clean-20261007");
const baseline = JSON.parse(await readFile(resolve(dir, "topological-baseline.json"), "utf8")) as { evidenceRows: Array<{ index: number; available: boolean; scores: VisualEvidence[] }> };
const rows = (await readFile(resolve(dir, "windows.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
const ids = Array.from({ length: 20 }, (_, i) => `anchor-${i + 1}`);
const chain: TopologicalEdge[] = ids.slice(1).flatMap((id, i) => [{ from: ids[i]!, to: id, motion: [] }, { from: id, to: ids[i]!, motion: [] }]);
const scenarios = ["intact", "skip-every-other", "dropout-three", "low-local-features", "no-graph", "wrong-graph"];
const output: unknown[] = [];
for (const scenario of scenarios) {
	const edges = scenario === "no-graph" ? [] : scenario === "wrong-graph" ? chain.map(edge => ({ ...edge, to: ids[(ids.indexOf(edge.to) + 7) % ids.length]! })) : chain;
	const filter = new TopologicalFilter(ids, edges);
	const input = baseline.evidenceRows.filter((_, i) => scenario !== "skip-every-other" || i % 2 === 0);
	const decisions = input.map((row, i) => {
		const dropout = scenario === "dropout-three" && i >= 8 && i <= 10;
		const scores = scenario === "low-local-features" ? row.scores.map(score => ({ ...score, inliers: Math.floor(score.inliers * 0.2) })) : row.scores;
		const belief = filter.update(visualPotentials(ids, scores, !dropout && row.available), [], false, true);
		const decision = decideBelief(belief, !dropout && row.available);
		// A failed sensor must never produce a claimed localization from prior alone.
		return { window: row.index + 1, ...decision, dropout, top: [...belief].sort((a,b) => b[1]-a[1]).slice(0,3) };
	});
	const diagnostics = decisions.map(decision => {
		const target = rows[decision.window - 1]!.endPose;
		const expected = rows.slice(0,20).flatMap((row,i) => Math.hypot(row.endPose.x-target.x,row.endPose.z-target.z) <= 0.05 ? [ids[i]!] : []);
		return { ...decision, expected, correct: decision.id !== null && expected.includes(decision.id) };
	});
	const returns = diagnostics.filter(row => row.expected.length);
	const summary = { scenario, windows: decisions.length, returns: returns.length, correct: returns.filter(row => row.correct).length, wrong: returns.filter(row => row.id !== null && !row.correct).length, unresolved: returns.filter(row => row.id === null).length, acceptedWithoutExactReference: diagnostics.filter(row => !row.expected.length && row.id !== null).length };
	console.log(JSON.stringify(summary)); output.push({ ...summary, diagnostics });
}
await writeFile(resolve(dir,"topological-stress.json"), JSON.stringify({ note: "Synthetic evidence/graph perturbations on same static recording, not new real-world complexity. Downscaled inlier counts are sensitivity tests, not actual image degradation. Exact reference position is evaluation-only, not Place/Space ground truth. Motion disabled.", scenarios: output },null,2));
