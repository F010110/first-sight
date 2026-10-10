/** Frozen first-half visual-anchor map; held-out second-half localization, no VLM. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { matchImages } from "../agent/image-match.js";
import { TopologicalFilter, normalize, visualPotentials, motionTokens, decideBelief, type VisualEvidence, type TopologicalEdge } from "../agent/topological-filter.js";

const dir = resolve(process.argv[2] ?? "run/sim/multiview-val5-clean-20261007");
const frontOnly = process.argv.includes("--front");
const testMotion = process.argv.includes("--test-motion");
const rows = (await readFile(resolve(dir, "windows.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
const trainCount = 20;
const reference = rows.slice(0, trainCount);
const ids = reference.map((_, i) => `anchor-${i + 1}`);
const motion = (row: typeof rows[number], mode: string): string[] => motionTokens(mode === "none" ? null : row[mode === "noisy" ? "motionNoisy" : "motionPerfect"] ?? null);
// Explicitly inspect the dataset motion keys rather than silently invent sensors.
console.log(`motion fields: ${Object.keys(rows[0]!).filter(key => /motion/i.test(key)).join(",")}`);
const imagePaths = (tick: number) => (frontOnly ? ["frames"] : ["frames", "left", "right"]).map(folder => resolve(dir, folder, `${String(tick).padStart(4, "0")}.jpg`));
const candidates = reference.flatMap((row, i) => imagePaths(row.endTick).map(path => ({ id: ids[i]!, path })));
const evidenceRows: Array<{ index: number; available: boolean; scores: VisualEvidence[] }> = [];
for (let index = trainCount; index < Math.min(rows.length, 40); index++) {
	const result = await matchImages(imagePaths(rows[index]!.endTick), candidates, { minInliers: 15, maxDim: 640, timeoutMs: 120000 });
	if (!result.ok) throw new Error(`Matcher failed at window ${index + 1}: ${result.error}`);
	const best = new Map<string, VisualEvidence>();
	for (const entry of result.results) {
		const previous = best.get(entry.id);
		if (!previous || entry.inliers > previous.inliers || (entry.inliers === previous.inliers && entry.similarity > previous.similarity)) best.set(entry.id, { id: entry.id, inliers: entry.inliers, similarity: entry.similarity });
	}
	evidenceRows.push({ index, available: result.ok, scores: [...best.values()] });
	console.log(`matched held-out window ${index + 1}`);
}
const experiments: unknown[] = [];
for (const mode of testMotion ? ["none", "perfect", "noisy"] : ["none"]) {
	const edges: TopologicalEdge[] = [];
	for (let i = 1; i < reference.length; i++) {
		edges.push({ from: ids[i - 1]!, to: ids[i]!, motion: motion(reference[i], mode) });
		// Connectivity is reversible; inverse action sequence is NOT known.
		edges.push({ from: ids[i]!, to: ids[i - 1]!, motion: [] });
	}
	for (const variant of ["visual", "visual-path", "sequence", "sequence-path"]) {
		const filter = new TopologicalFilter(ids, edges);
		const decisions = evidenceRows.map(row => {
			const emission = visualPotentials(ids, row.scores, row.available);
			const belief = variant === "visual" ? normalize(emission) : filter.update(emission, motion(rows[row.index], mode), variant.includes("path"), variant.startsWith("sequence"));
			return { window: row.index + 1, motion: motion(rows[row.index], mode), ...decideBelief(belief), top: [...belief].sort((a,b) => b[1]-a[1]).slice(0, 4) };
		});
		// GT is consulted only after localization; exact-position pairs are diagnostics,
		// not activity-region annotations. Never feed coordinates into the filter.
		const pairs = decisions.flatMap(decision => {
			const target = rows[decision.window - 1]!.endPose;
			const expected = reference.flatMap((row,i) => Math.hypot(row.endPose.x-target.x,row.endPose.z-target.z) <= 0.05 ? [ids[i]!] : []);
			return expected.length ? [{ window: decision.window, expected, selected: decision.id, correct: decision.id !== null && expected.includes(decision.id) }] : [];
		});
		const summary = { mode, variant, localized: decisions.filter(row => row.id !== null).length, exactPositionReturns: pairs.length, correct: pairs.filter(row => row.correct).length, wrong: pairs.filter(row => row.selected !== null && !row.correct).length, unresolved: pairs.filter(row => row.selected === null).length };
		console.log(JSON.stringify(summary)); experiments.push({ ...summary, pairs, decisions });
	}
}
await writeFile(resolve(dir, frontOnly ? "topological-baseline-front.json" : "topological-baseline.json"), JSON.stringify({ motionEnabled: testMotion, views: frontOnly ? "front" : "triple", note: "Experimental SIFT/global-score potentials, NOT trained VPR or calibrated probabilities. Reference nodes are observation anchors, NOT validated activity-region Places. Frozen first 20 windows, evaluation windows 21–40; no GT creates nodes/edges. Bidirectional chain graph, reverse motion unknown. Sequence is recursive HMM evidence accumulation, NOT full SeqSLAM alignment. No discovery/merging/Space changes; unresolved stays pending. Exact-position metrics are diagnostics only, not false-merge/Place accuracy.", evidenceRows, experiments }, null, 2));
