/** Analyst-evidence pilot, NOT automatic perception or independent evaluation. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { partitionRegions, type RegionEvidence } from "../agent/region-partition.js";
const dir = resolve(process.argv[2] ?? "run/sim/multiview-val5-clean-20261007");
const refine = process.argv.includes("--refine");
const outputPrefix = refine ? "region-partition-refined" : "region-partition";
// Deliberately project away simulator annotations before evidence construction.
const ticks: number[] = (await readFile(resolve(dir, "windows.jsonl"), "utf8")).trim().split(/\r?\n/).slice(0, 40).map(line => JSON.parse(line).endTick);
const ids = ticks.map((_, i) => `observation-${i + 1}`);
const frame = (w: number) => `triple/${String(ticks[w - 1]).padStart(4, "0")}.jpg`;
const evidence: RegionEvidence[] = [];
function add(a: number, b: number, relation: RegionEvidence["relation"], reason: string, weight = 1) {
	evidence.push({ id: `review-${a}-${b}`, a: ids[a - 1]!, b: ids[b - 1]!, relation, weight,
		source: "assistant-manual-image-layout-review", reason, frames: [frame(a), frame(b)] });
}
const counter = "Soft coarse-scope support: counter and adjacent floor/opening layout remain compatible across panels. Not a verified object track or motion estimate.";
for (const [a, b] of [[1, 2], [2, 3], [3, 4]]) add(a!, b!, "same", counter);
const bed = "Soft coarse bed-side scope support: bed, side cabinet/window and opening-frame layout are compatible. Observer displacement and exact activity boundary are not measured.";
for (const [a, b] of [[8, 9], [9, 10], [10, 11], [11, 12], [8, 38], [9, 37], [10, 36], [11, 35], [12, 34]]) add(a!, b!, "same", bed);
const toilet = "Soft toilet-side support: toilet, nearby wall picture/plunger and adjoining floor layout are compatible. Specific instance continuity remains a review hypothesis.";
for (const [a, b] of [[16, 17], [17, 19], [19, 23], [23, 24], [24, 25], [25, 26], [26, 27], [27, 28], [28, 29], [29, 30], [16, 30]]) add(a!, b!, "same", toilet);
const sink = "Soft sink-side support: basin and nearby open floor/doorframe layout are compatible despite wall-dominated panels. Does not prove pure rotation.";
for (const [a, b] of [[18, 20], [20, 21], [21, 22], [22, 24]]) add(a!, b!, "same", sink);
add(4, 8, "different", "Soft separating-scope hypothesis: counter-side versus bed-side layout, with framed opening and floor transition visible in intervening W5-W7. No confirmed traversal event.", 2);
add(12, 16, "different", "Soft separating-scope hypothesis: bed-side versus fixture-side layout, with opening/floor transition in W13-W15. No confirmed traversal event.", 2);
for (const [a, b] of [[4, 5], [5, 6], [6, 7], [7, 8], [12, 13], [13, 14], [14, 15], [15, 16], [30, 31], [31, 32], [32, 33], [33, 34], [38, 39], [39, 40], [22, 23]])
	add(a!, b!, "unknown", "Endpoint images alone do not establish crossing, local motion, or same activity region. Missing observations cannot be treated as no boundary.", 0);
const experiments = [
	{ name: "review-evidence", evidence },
	{ name: "remove-W24-bridge", evidence: evidence.filter(edge => edge.a !== ids[23] && edge.b !== ids[23]) },
	{ name: "unknown-only", evidence: evidence.filter(edge => edge.relation === "unknown") },
].map(trial => ({ name: trial.name, ...partitionRegions(ids, trial.evidence, { refine }) }));
const note = "Manual layout-evidence pilot only. No automated masks, instance tracks, geometry, rotation detector, or boundary-crossing detector. Evidence and resulting partition are not independent labels; zero objective cost is consistency, not accuracy. Does not reproduce RoboHop/Prior-SG. No simulator GT, motion descriptions, image similarities, or old node memberships used for inference.";
await writeFile(resolve(dir, `${outputPrefix}-review-evidence.json`), JSON.stringify({ note, evidence }, null, 2));
await writeFile(resolve(dir, `${outputPrefix}-eval.json`), JSON.stringify({ note, experiments }, null, 2));
const html = experiments.map(trial => `<h2>${trial.name}: ${trial.groups.length} supported proposals, ${trial.unresolvedObservationIds.length} unresolved</h2>${trial.groups.map(group => `<section><h3>${group.id}</h3>${group.observationIds.map(id => { const w = ids.indexOf(id) + 1; return `<figure><img loading="lazy" src="${frame(w)}"><figcaption>W${w}</figcaption></figure>`; }).join("")}</section>`).join("")}<p>Unresolved: ${trial.unresolvedObservationIds.map(id => `W${ids.indexOf(id) + 1}`).join(", ")}</p>`).join("");
await writeFile(resolve(dir, `${outputPrefix}-inspection.html`), `<!doctype html><meta charset="utf-8"><title>Manual evidence partition pilot</title><style>body{background:#222;color:#eee;font-family:sans-serif}section{border:1px solid #777;margin:12px}figure{display:inline-block;width:46%}img{width:100%}</style><h1>Manual evidence pilot — NOT automatic region perception</h1><p>${note}</p>${html}`);
for (const trial of experiments) console.log(JSON.stringify({ name: trial.name, groups: trial.groups.map(group => group.observationIds.map(id => ids.indexOf(id) + 1).sort((a, b) => a - b)), unresolved: trial.unresolvedObservationIds.map(id => ids.indexOf(id) + 1), objectiveCost: trial.objectiveCost }));
