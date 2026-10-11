/** Evaluation-only: labels/poses are never passed to the inference pipeline. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { scoreTransitions } from "../agent/region-event-evaluation.js";
import { scorePlaceBenchmark } from "../agent/place-benchmark.js";
const [output] = process.argv.slice(2);
if (!output) throw new Error("Usage: visual-pipeline-scorecard NEW-output-json");
const hashes: Record<string, string> = {};
async function text(path: string) { const bytes = await readFile(path); hashes[path] = createHash("sha256").update(bytes).digest("hex"); return bytes.toString("utf8"); }
async function json(path: string) { return JSON.parse(await text(path)); }
const mini = await json("docs/experiments/place-mini-benchmark-v1.json");
await json("docs/experiments/visual-pipeline-dataset-v1.json");
const datasets = [];
for (const [id, directory, scopeSequence] of [
	["val4", "region-val4-multiview", [0, 1, 2, 3, 2, 1, 0]],
	["val5", "multiview-val5-clean-20261007", [0, 1, 2, 3, 2, 1]],
] as const) {
	const dir = `run/sim/${directory}`;
	const pipeline = await json(`${dir}/visual-pipeline-v1/pipeline.json`);
	const vo = await json(`${dir}/three-view-vo-v1.json`);
	const actions = (await text(`${dir}/observations.jsonl`)).trim().split(/\r?\n/).map(line => JSON.parse(line));
	const windows = (await text(`${dir}/windows.jsonl`)).trim().split(/\r?\n/).map(line => JSON.parse(line));
	const oracle = await json(`docs/experiments/${directory}-oracle-boundaries-v1.json`);
	const priorOracle = await json(`${dir}/segment-oracle-pipeline-v1.json`);
	const oldBaseline = (await json(`${dir}/vlm-verifier-all-eval.json`)).baseline;
	const benchmark = mini.datasets.find((row: any) => row.id === id);
	const byTick = new Map(actions.map(row => [row.tick, row]));
	const move = vo.trace.filter((row: any) => byTick.get(Number(row.afterFrame.split(".")[0]))?.action === "MoveAhead");
	const turn = vo.trace.filter((row: any) => byTick.get(Number(row.afterFrame.split(".")[0]))?.action.startsWith("Rotate"));
	const rate = (n: number, d: number) => d ? 100 * n / d : null;
	const detected = move.filter((row: any) => row.status === "movement-candidate").length;
	const falseMoveOnTurns = turn.filter((row: any) => row.status === "movement-candidate").length;
	const ids = windows.map((_: any, i: number) => `observation-${i + 1}`);
	// No supported historical identity => unresolved, NOT one huge region.
	if (pipeline.interpretation.association.hypotheses.some((row: any) => row.status === "supported")) throw new Error("Scorecard v1 needs explicit supported-assignment scoring before accepting new output");
	const current = scorePlaceBenchmark({ groups: [], unresolvedObservationIds: ids }, benchmark);
	const boundary = scoreTransitions(oracle.transitionIntervals, pipeline.continuity.boundaries.map((row: any) => ({ id: row.id, atMs: windows[Number(row.beforeObservationId.split("-").at(-1)) - 1].endTick * 1000 })), 3000);
	const oracleCondition = priorOracle.conditions.find((row: any) => row.name === "oracle-boundaries");
	let expectedReturns = 0, correctReturns = 0, wrongReturns = 0;
	for (let i = 1; i < scopeSequence.length; i++) if (scopeSequence.slice(0, i).includes(scopeSequence[i]!)) expectedReturns++;
	for (const hypothesis of oracleCondition.associations.hypotheses) if (hypothesis.status === "supported") {
		const a = Number(hypothesis.segmentId.split("-").at(-1)) - 1, b = Number(hypothesis.targetSegmentId.split("-").at(-1)) - 1;
		if (scopeSequence[a] === scopeSequence[b]) correctReturns++; else wrongReturns++;
	}
	datasets.push({ id, split: "AI-reviewed development", frames: actions.length, observationWindows: windows.length,
		motion: { straightMoveDetectionScore: rate(detected, move.length), detected, actualMoveSteps: move.length, turnFalseMovementRate: rate(falseMoveOnTurns, turn.length), falseMoveOnTurns, actualTurnSteps: turn.length, staticFalseAlarmScore: null, note: "No stationary negative events. Pure turns are mostly unknown, not successfully classified rotation. Actions correlated." },
		integrated: { boundaryF1Score: boundary.f1 === null ? null : boundary.f1 * 100, boundaryEvents: boundary.truthEvents, predictedBoundaries: boundary.predictedEvents, missedBoundaries: boundary.missed, confirmedRegionCoverageScore: 0, regionConsistencyScore: current.summary.stability === null ? null : current.summary.stability * 100, historicalLookupProxyScore: current.summary.historicalLookupProxy === null ? null : current.summary.historicalLookupProxy * 100, severeCrossRegionErrors: current.summary.crossRegionFalseMerges, unknownObservationWindows: ids.length, replayMs: pipeline.replayMs, endToEndLatencyMs: null, acceptance: "not-passed: boundary producer absent; all identities unresolved" },
		oracleDiagnostic: { expectedReturns, correctReturns, wrongReturns, returnRecoveryScore: rate(correctReturns, expectedReturns), note: "Fresh oracle-cuts replay with current matcher; conditional result only; cuts never include identity." },
		legacyBaseline: scorePlaceBenchmark(oldBaseline, benchmark).summary });
}
for (const path of ["sim/three_view_vo.py", "src/agent/visual-experience-pipeline.ts", "src/agent/temporal-region-continuity.ts", "src/agent/segment-association.ts", "src/agent/segment-interpretation-store.ts", "src/sim/visual-experience-replay.ts", "src/sim/visual-pipeline-scorecard.ts"]) await text(path);
const report = { protocol: "visual-pipeline-scorecard-v1", scale: "Scores are percentages 0–100 with individual denominators, NOT a weighted overall accuracy.", frozenInputHashes: hashes, thresholds: { voRatio: .65, rotationDegrees: 3, minMatches: 20, poseInlierFraction: .6, medianParallaxPixels: 2, requiredBearings: 2, pipelineGapMs: 4000, confirmationFrames: 2, eventToleranceMs: 3000 }, limitations: "Two development houses, no blind human labels, no stationary/dynamic negatives, synthetic tick timing. New VO pipeline is connected in independent experiment replay only, not production migration. Missing boundary detector explicitly scores zero recovery; zero errors at zero coverage is NOT safety. Cached replay timing excludes feature extraction; real latency unmeasured.", datasets };
await writeFile(resolve(output), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(datasets, null, 2));
