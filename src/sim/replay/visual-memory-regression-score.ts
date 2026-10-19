import { readFile, writeFile } from "node:fs/promises";
import { scorePlaceBenchmark } from "../../agent/place-benchmark.js";
const [output, runName = "visual-pipeline-v2"] = process.argv.slice(2);
if (!output) throw new Error("Usage: visual-memory-regression-score NEW-output-json");
const mini = JSON.parse(await readFile("docs/experiments/place-mini-benchmark-v1.json", "utf8"));
const reports = [];
for (const [id, name] of [["val4", "region-val4-multiview"], ["val5", "multiview-val5-clean-20261007"]]) {
	const directory = `run/sim/${name}`;
	const bundle = JSON.parse(await readFile(`${directory}/experience-sequence-bundle.json`, "utf8"));
	const integrated = JSON.parse(await readFile(`${directory}/${runName}/integrated-memory.json`, "utf8"));
	const prediction = JSON.parse(await readFile(`${directory}/${runName}/pipeline.json`, "utf8"));
	const baseline = { groups: bundle.graph.nodes, unresolvedObservationIds: bundle.graph.observations.filter((row: any) => row.nodeId === null).map((row: any) => row.id) };
	const benchmark = mini.datasets.find((row: any) => row.id === id);
	const oldScore = scorePlaceBenchmark(baseline, benchmark), newScore = scorePlaceBenchmark(prediction.effective, benchmark);
	const unchangedBundle = JSON.stringify(bundle) === JSON.stringify(integrated.baseline);
	if (!unchangedBundle || JSON.stringify(oldScore) !== JSON.stringify(newScore)) throw new Error(`Baseline regression in ${id}`);
	reports.push({ id, baselineBundlePreservedExactly: unchangedBundle, effectiveScoreUnchanged: true, effective: newScore.summary,
		associatedObservations: bundle.graph.observations.filter((row: any) => row.nodeId !== null).length,
		observations: bundle.graph.observations.length, automaticBatchProposals: prediction.visualChanges?.boundaries.length ?? 0, confirmedCrossings: prediction.continuity.boundaries.length, automaticBoundaryRecovery: "Physical crossing tracker still absent; temporal layer must not erase baseline identity", provenance: "Scores inherited from preserved old baseline, NOT new-algorithm improvement" });
}
await writeFile(output, JSON.stringify({ protocol: "visual-memory-regression-v1", reports }, null, 2), { flag: "wx" });
console.log(JSON.stringify(reports, null, 2));
