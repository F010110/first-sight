import { readFile, writeFile } from "node:fs/promises";
import { scoreGroupingCorrectness, scoreGroupingStability, scoreGroupContentRecognition, type GroupContentQuery } from "../../agent/grouping-evaluation.js";
const [reportPath, labelsPath, output] = process.argv.slice(2);
if (!reportPath || !labelsPath || !output) throw new Error("Usage: grouping-scorecard executed-prefix-report reviewed-core-labels NEW-output");
const report = JSON.parse(await readFile(reportPath, "utf8")), labels = JSON.parse(await readFile(labelsPath, "utf8"));
if (labels.protocol !== "core-boundary-v1") throw new Error("Unsupported reviewed label protocol");
const truth: Record<string, string | null> = {};
for (const row of labels.labels) {
	if (!row.observationId || row.observationId in truth || !Array.isArray(row.regions)) throw new Error("Invalid reviewed labels");
	truth[row.observationId] = row.kind === "core" && row.regions.length === 1 ? row.regions[0] : null;
}
const snapshots = report.online.snapshots;
const prediction = snapshots.at(-1)?.assignments;
if (!prediction) throw new Error("Missing executed prefix predictions");
const queries: GroupContentQuery[] = [];
const seen = new Set<string>();
for (const snapshot of snapshots) {
	// Inventory is strictly earlier than this executed prefix.
	const current = Object.keys(snapshot.assignments).filter(id => !seen.has(id));
	const eligible = [...seen].filter(id => truth[id] != null);
	for (const id of current) {
		if (truth[id] == null) continue;
		const relevant = eligible.filter(other => truth[other] === truth[id]);
		if (!relevant.length) continue;
		const group = snapshot.assignments[id];
		queries.push({ id: `historical-content-${id}`, queryObservationId: id, eligibleHistoricalObservationIds: eligible,
			relevantHistoricalObservationIds: relevant, returnedObservationIds: group === null ? [] : eligible.filter(other => snapshot.assignments[other] === group) });
	}
	for (const id of current) seen.add(id);
}
const result = { protocol: "grouping-three-capabilities-v1", predictionSource: "executed online prefix baseline association, not Oracle segmentation", labelSource: labelsPath,
	labelReview: { reviewer: labels.reviewer, blind: labels.blind, note: labels.note },
	granularity: "existing reviewed local core regions; subregion labels not yet available", stability: scoreGroupingStability(snapshots, truth),
	correctness: scoreGroupingCorrectness(truth, prediction), contentRecognition: scoreGroupContentRecognition(queries),
	contentQueryDefinition: "Each reviewed core observation with earlier same-core observations is a query. Retrieve earlier reviewed observations sharing its actual prefix node. This tests group membership retrieval, not object semantics. Correlated adjacent frames, not independent revisit events.",
	queries, limitations: "Single AI-reviewed nonblind recording. Boundary observations excluded. No invented val5 full labels or physical/subregion truth; existing legacy mini benchmark remains separate." };
await writeFile(output, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify({ stability: { persistence: result.stability.decisionPersistence, repairs: result.stability.repairs, regressions: result.stability.regressions }, correctness: result.correctness, contentRecognition: result.contentRecognition }, null, 2));
