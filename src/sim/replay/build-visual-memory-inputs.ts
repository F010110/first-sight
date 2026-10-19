/** Cold-start inputs from ordered triples, with optional reusable visual caches. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { matchImages } from "../../agent/image-match.js";
import { ExperienceGraph } from "../../agent/experience-graph.js";
import { ExperienceAssociation, type CorrespondenceEvidence } from "../../agent/experience-association.js";
const [directory, output] = process.argv.slice(2);
if (!directory || !output) throw new Error("Usage: build-visual-memory-inputs triples-and-windows NEW-output-dir");
const dir = resolve(directory), out = resolve(output);
const rows = (await readFile(resolve(dir, "windows.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
if (!rows.length || rows.some((row: any, i: number) => !Number.isInteger(row.endTick) || row.endTick < 0 || i > 0 && row.endTick <= rows[i - 1].endTick)) throw new Error("Invalid chronological observation endpoints");
const frames = (i: number) => ["frames", "left", "right"].map(view => ({ direction: view, frame: resolve(dir, view, `${String(rows[i].endTick).padStart(4, "0")}.jpg`) }));
let pairs: CorrespondenceEvidence[];
try { pairs = JSON.parse(await readFile(resolve(dir, "experience-directional-evidence.json"), "utf8")); }
catch (error) {
	if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	const directional = new Map<string, number[]>();
	for (let i = 0; i < rows.length; i++) {
		const query = frames(i), candidates = rows.flatMap((_: any, j: number) => i === j ? [] : frames(j).map(view => ({ id: `observation-${j + 1}`, path: view.frame })));
		if (!candidates.length) continue;
		const result = await matchImages(query.map(view => view.frame), candidates, { minInliers: 15, maxDim: 640, timeoutMs: 120000 });
		if (!result.ok) throw new Error(`Feature extraction failed: ${result.error}`);
		for (let j = 0; j < rows.length; j++) if (j !== i) {
			const scores = [0, 0, 0];
			for (const entry of result.results.filter(entry => entry.id === `observation-${j + 1}`)) {
				const index = query.findIndex(view => view.frame === entry.queryPath);
				if (index >= 0) scores[index] = Math.max(scores[index]!, Math.min(entry.inliers / 60, 1));
			}
			directional.set(`${i}:${j}`, scores);
		}
	}
	pairs = [];
	for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) pairs.push({ a: `observation-${i + 1}`, b: `observation-${j + 1}`, bearings: directional.get(`${i}:${j}`)!, backwardBearings: directional.get(`${j}:${i}`)!, views: [...frames(i), ...frames(j)], source: "fresh image-only bidirectional SIFT inliers/60; original baseline protocol" });
}
const graph = new ExperienceGraph(), association = new ExperienceAssociation(graph, true);
for (let i = 0; i < rows.length; i++) {
	graph.addObservation({ id: `observation-${i + 1}`, atMs: rows[i].endTick * 1000, visitId: "episode-1", frames: frames(i).map(view => view.frame), objects: [], description: "", semanticSource: null });
	const known = new Set(graph.getState().observations.map(row => row.id));
	for (const pair of pairs.filter(pair => (pair.a === `observation-${i + 1}` || pair.b === `observation-${i + 1}`) && known.has(pair.a) && known.has(pair.b))) association.addEvidence(pair);
	association.reconsider();
}
await mkdir(out, { recursive: false });
await association.persist(resolve(out, "experience-sequence-bundle.json"));
await writeFile(resolve(out, "experience-directional-evidence.json"), JSON.stringify(pairs), { flag: "wx" });
let geometry;
try { geometry = JSON.parse(await readFile(resolve(dir, "local-rotation-evidence.json"), "utf8")); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; geometry = { pairs: [], note: "No cached geometric evidence; produce it separately, never invent structural support" }; }
await writeFile(resolve(out, "local-rotation-evidence.json"), JSON.stringify(geometry), { flag: "wx" });
