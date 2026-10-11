/** All truth remains here, outside inference. Same links for oracle and auto. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { segmentExperience } from "../agent/experience-segments.js";
import { associateSegments } from "../agent/segment-association.js";
import { scoreTransitions } from "../agent/region-event-evaluation.js";
import { scorePlaceBenchmark } from "../agent/place-benchmark.js";
import { scorePrefixStability } from "../agent/region-online-evaluation.js";
import { VisualExperienceMemory } from "../agent/visual-experience-memory.js";
import { evaluateRegionCores } from "../agent/region-core-evaluation.js";

const [directory, artifacts, oraclePath, output, memorySubdirectory = "memory", voOverride] = process.argv.slice(2);
if (!directory || !artifacts || !oraclePath || !output) throw new Error("Usage: visual-complete-evaluation dataset full-artifacts oracle-boundaries NEW-output");
const read = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const pipeline = await read(resolve(artifacts, memorySubdirectory, "pipeline.json")), integrated = await read(resolve(artifacts, memorySubdirectory, "integrated-memory.json"));
const vo = await read(voOverride ? resolve(voOverride) : resolve(artifacts, "vo.json")), oracle = await read(oraclePath);
if (oracle.protocol !== "boundary-events-v1" || !oracle.reviewed) throw new Error("Require reviewed boundary-only truth");
const current = integrated.interpretations.at(-1), observations = current.observations.map(({ id, atMs, frames }: any) => ({ id, atMs, frames }));
const actions = (await readFile(resolve(directory, "observations.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
const byTick = new Map(actions.map(row => [row.tick, row]));
const motionCounts: Record<string, Record<string, number>> = {};
for (const row of vo.trace) {
	const action = byTick.get(Number(row.afterFrame.split(".")[0]))?.action;
	const type = action === "MoveAhead" ? "straight-move" : action?.startsWith("Rotate") ? "turn" : "other";
	const counts = motionCounts[type] ??= {}; counts[row.status] = (counts[row.status] ?? 0) + 1;
}
const hiatusIds = new Set((pipeline.hiatusBoundaries ?? []).map((event: any) => event.id));
const conditions = [{ name: "no-boundary-matcher-control", boundaries: [] }, { name: "oracle-boundaries", boundaries: oracle.boundaries }, { name: "automatic-inferred-boundaries", boundaries: pipeline.interpretation.segmentation.boundaries }].map(condition => {
	const segmentation = segmentExperience(observations, condition.boundaries, 1);
	const start = performance.now();
	const candidates = segmentation.segments.map((segment, i) => ({ ...segment, sharedBoundaryAnchorIds: [...(segmentation.segments[i - 1]?.observationIds.slice(-1) ?? []), ...(segmentation.segments[i + 1]?.observationIds.slice(0, 1) ?? [])] }));
	const association = associateSegments(candidates, current.links, current.contradictions, 1);
	const matchingMs = performance.now() - start;
	const boundaryScore = scoreTransitions(oracle.transitionIntervals, condition.boundaries.filter((event: any) => !hiatusIds.has(event.id)).map((event: any) => ({ id: event.id, atMs: observations.find((row: any) => row.id === event.beforeObservationId).atMs })), 3000);
	return { name: condition.name, segments: segmentation.segments.length, historicalHypotheses: association.hypotheses, supportedHistoricalProposals: association.hypotheses.filter(row => row.status === "supported").length, boundaryScore, matchingMs };
});
const original = integrated.baseline.graph;
const mini = await read("docs/experiments/place-mini-benchmark-v1.json");
const benchmark = mini.datasets.find((row: any) => row.id === (directory.includes("val4") ? "val4" : "val5"));
const baselineScore = scorePlaceBenchmark(pipeline.effective, benchmark);
const baselineAssociated = original.observations.filter((row: any) => row.nodeId !== null).length;
const legacyCoreReview = directory.includes("val4") ? evaluateRegionCores(pipeline.effective, (await read("docs/experiments/region-val4-core-labels-v1.json")).labels) : null;
const sourceBaseline = await read(resolve(directory, "experience-sequence-bundle.json"));
const baselinePreservedExactly = JSON.stringify(sourceBaseline) === JSON.stringify(integrated.baseline);
if (!baselinePreservedExactly) throw new Error("New temporal interpretation modified the original baseline");

// Fresh online replay, NOT a cached final baseline masquerading as a prefix.
const online = new VisualExperienceMemory(), seen = new Set<string>(), usedPairs = new Set<string>(), usedLinks = new Set<string>(), usedBoundaries = new Set<string>();
const snapshots = [], timings = [];
for (const row of current.observations) {
	seen.add(row.id);
	const pairs = integrated.baseline.evidence.filter((pair: any) => seen.has(pair.a) && seen.has(pair.b) && !usedPairs.has([pair.a, pair.b].sort().join("\0")));
	for (const pair of pairs) usedPairs.add([pair.a, pair.b].sort().join("\0"));
	const links = current.links.filter((link: any) => seen.has(link.a) && seen.has(link.b) && !usedLinks.has(link.id));
	for (const link of links) usedLinks.add(link.id);
	const raw = original.observations.find((other: any) => other.id === row.id), { nodeId: _node, status: _status, ...input } = raw;
	const start = performance.now();
	const boundaryProposals = (current.automaticBoundaryProposals ?? []).filter((proposal: any) => proposal.availableAtMs <= row.atMs && !usedBoundaries.has(proposal.event.id));
	for (const proposal of boundaryProposals) usedBoundaries.add(proposal.event.id);
	online.observe(input, row.motionSteps, row.boundaryEvidence, links, pairs, boundaryProposals);
	timings.push(performance.now() - start);
	snapshots.push({ atMs: row.atMs, assignments: Object.fromEntries(online.association.graph.getState().observations.map(item => [item.id, item.nodeId])) });
}
const actualQueries = [...new Set(original.observations.flatMap((row: any) => row.objects))] as string[];
const retrieval = actualQueries.map(query => ({ query, expectedHistoricalObservations: original.observations.filter((row: any) => row.objects.some((object: string) => object.toLowerCase().includes(query.toLowerCase()))).length, returnedHistoricalObservations: online.searchObjects(query).length }));
const sorted = [...timings].sort((a, b) => a - b);
const report = { protocol: "visual-complete-evaluation-v1", note: "Automatic boundaries are revisable geometric/appearance inferences, not certified crossings. Legacy score is inherited, not improvement. Online replay is rebuilt prefix-by-prefix using only arrived endpoint evidence; image features themselves remain pre-extracted. No human blind or real device validation.",
	motionCounts, conditions, effectiveLegacy: baselineScore.summary, baselinePreservedExactly,
	legacyCoreReview,
	coverage: { inheritedVisualIdentityObservations: baselineAssociated, observationCount: observations.length, inheritedVisualIdentityCoverage: baselineAssociated / observations.length, verifiedPhysicalRegionCoverage: null, note: "Visual baseline association is not certified physical-region identity. Temporal/new-region proposals do not count as verified coverage." }, confirmedPhysicalRegionCoverage: null,
	temporalOrganization: { observations: observations.length, provisionalRegions: pipeline.regions.length, note: "Provisional temporal organization does not count as physical region coverage" },
	boundaryConfirmationDelaysMs: [...(pipeline.continuity.confirmations ?? []), ...(pipeline.nativeContinuity?.confirmations ?? [])].map((row: any) => row.confirmationDelayMs),
	online: { relationChanges: scorePrefixStability(snapshots), snapshots, meanCachedUpdateMs: timings.reduce((a,b)=>a+b,0)/timings.length, p95CachedUpdateMs: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)], imageExtractionIncluded: false },
	actualRepairDelayMs: null,
	historicalObjectRetrieval: { queries: retrieval, coverage: retrieval.length ? retrieval.filter(row => row.expectedHistoricalObservations === row.returnedHistoricalObservations).length / retrieval.length : null, note: "Null when no object annotations; observation facts only, no claim of current presence" },
	extractionMs: pipeline.extractionMs, actualDeviceEndToEndLatencyMs: null };
await writeFile(output, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ motionCounts, conditions: conditions.map(row => ({ name: row.name, boundaryF1: row.boundaryScore.f1, supportedReturns: row.supportedHistoricalProposals })), baseline: baselineScore.summary, onlineMeanCachedMs: report.online.meanCachedUpdateMs }, null, 2));
