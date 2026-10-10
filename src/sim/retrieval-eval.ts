/** Isolate candidate retrieval from VLM. Poses are used only after matching. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { matchImages } from "../agent/image-match.js";
const dir = resolve(process.argv[2] ?? "run/sim/multiview-val5-clean-20261007");
const rows = (await readFile(resolve(dir, "windows.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line) as { endTick: number; endPose: { x: number; z: number; yaw: number } });
const output: unknown[] = [];
for (const index of [32, 37, 38, 39]) {
	const target = rows[index];
	if (!target) continue;
	for (const mode of ["front", "multi"] as const) {
		const folders = mode === "front" ? ["frames"] : ["frames", "left", "right"];
		const paths = (tick: number) => folders.map(folder => resolve(dir, folder, `${String(tick).padStart(4, "0")}.jpg`));
		const candidates = rows.slice(0, index).flatMap((row, i) => paths(row.endTick).map(path => ({ id: `window-${i + 1}`, path })));
		const result = await matchImages(paths(target.endTick), candidates, { minInliers: 15, maxDim: 640, timeoutMs: 120000 });
		const scores = new Map<string, { id: string; inliers: number; similarity: number }>();
		for (const entry of result.results) {
			const old = scores.get(entry.id);
			if (!old || entry.inliers > old.inliers || (entry.inliers === old.inliers && entry.similarity > old.similarity)) scores.set(entry.id, entry);
		}
		const ranked = [...scores.values()].sort((a, b) => b.inliers - a.inliers || b.similarity - a.similarity);
		// GT lookup happens AFTER feature matching; IDs/paths alone went to matcher.
		const expected = rows.slice(0, index).flatMap((row, i) => Math.hypot(row.endPose.x - target.endPose.x, row.endPose.z - target.endPose.z) <= 0.05 ? [`window-${i + 1}`] : []);
		const rank = ranked.findIndex(item => expected.includes(item.id));
		const summary = { window: index + 1, mode, available: result.ok, expected, firstExpectedRank: rank < 0 ? null : rank + 1, top3: ranked.slice(0, 3).map(item => ({ id: item.id, inliers: item.inliers, similarity: item.similarity })) };
		output.push(summary); console.log(JSON.stringify(summary));
	}
}
await writeFile(resolve(dir, "retrieval-comparison.json"), JSON.stringify({ note: "Raw historical endpoint snapshots, not production Place representatives. Four targeted same-position returns; not identity ground truth or a general retrieval benchmark. All-view SIFT compares directions freely but establishes surface overlap only.", results: output }, null, 2));
