import { readFile, writeFile } from "node:fs/promises";
import { scorePlaceBenchmark } from "../../agent/place-benchmark.js";
const [setPath, output, condition = "baseline"] = process.argv.slice(2);
if (!setPath || !output || !["baseline", "verified"].includes(condition)) throw new Error("Usage: place-benchmark-score set output [baseline|verified]");
const set = JSON.parse(await readFile(setPath, "utf8"));
const reports = [];
for (const dataset of set.datasets) {
	const data = JSON.parse(await readFile(dataset.prediction, "utf8"));
	const prediction = condition === "verified" ? data.revised : data.baseline;
	if (!prediction) throw new Error("Missing partition");
	reports.push({ dataset: dataset.id, ...scorePlaceBenchmark(prediction, dataset) });
}
const score = reports.every(row => row.summary.score !== null) ? reports.reduce((sum, row) => sum + row.summary.score!, 0) / reports.length : null;
await writeFile(output, JSON.stringify({ protocol: set.protocol, scoreVersion: "v2-weighted-40S-40D-20U", note: "Development diagnostic; lookup is group-based historical lookup proxy, not object retrieval or online prefix stability. Dataset macro-average; unknown counts as incomplete. Score formula changed: compare old and new algorithms only after rescoring under this same version.", condition, score, reports }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ score, reports: reports.map(row => ({ dataset: row.dataset, ...row.summary })) }, null, 2));
