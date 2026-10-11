/** Strict local-identity proposal; not a complete activity-region algorithm. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const [directory, output] = process.argv.slice(2);
if (!directory || !output) throw new Error("Usage: local-geometry-replay dataset output");
const dir = resolve(directory);
const evidence = JSON.parse(await readFile(resolve(dir, "local-rotation-evidence.json"), "utf8"));
const windows = (await readFile(resolve(dir, "windows.jsonl"), "utf8")).trim().split(/\r?\n/);
const ids = windows.map((_, i) => `observation-${i + 1}`);
const key = (a: string, b: string) => [a, b].sort().join("\0");
const supported = new Set<string>(evidence.pairs.map((pair: { a: string; b: string }) => key(pair.a, pair.b)));
// Keep ambiguous local hypotheses distinct instead of choosing arbitrary best
// saturated scores. Only complete geometric compatibility permits contraction.
let groups = ids.map(id => [id]);
let changed = true;
while (changed) {
	changed = false;
	for (let a = 0; a < groups.length && !changed; a++) for (let b = a + 1; b < groups.length; b++) {
		if (groups[a]!.every(x => groups[b]!.every(y => supported.has(key(x, y))))) {
			groups[a]!.push(...groups[b]!); groups.splice(b, 1); changed = true; break;
		}
	}
}
const prediction = { groups: groups.filter(group => group.length >= 2).map((observationIds, i) => ({ id: `geometric-identity-${i}`, observationIds })), unresolvedObservationIds: groups.filter(group => group.length === 1).flat() };
await writeFile(output, JSON.stringify({ note: "Experimental calibrated local geometry identity baseline, no VLM/labels/poses/room IDs. No global map, motion distances, forced connectivity or activity-region claims. Complete compatibility avoids transitive drift, but ambiguous partition choices and incomplete region layer remain. Original memory unchanged.", baseline: prediction, evidence }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ observations: ids.length, groups: prediction.groups.length, unresolved: prediction.unresolvedObservationIds.length, positivePairs: supported.size }));
