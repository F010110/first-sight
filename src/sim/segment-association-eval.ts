/** Oracle cuts + automatic historical matching; labels never enter matching. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { segmentExperience, type BoundaryEvent } from "../agent/experience-segments.js";
import { associateSegments, type SegmentLink } from "../agent/segment-association.js";
import { scoreTransitions } from "../agent/region-event-evaluation.js";
const [directory, annotationsPath, output] = process.argv.slice(2);
if (!directory || !annotationsPath || !output) throw new Error("Usage: segment-association-eval dataset oracle-annotations output");
const dir = resolve(directory);
const windows = (await readFile(resolve(dir, "windows.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
const annotations = JSON.parse(await readFile(annotationsPath, "utf8"));
if (annotations.protocol !== "boundary-events-v1" || annotations.reviewed !== true || !Array.isArray(annotations.boundaries)) throw new Error("Require reviewed oracle boundary events");
const pairs = JSON.parse(await readFile(resolve(dir, "experience-directional-evidence.json"), "utf8"));
const geometry = JSON.parse(await readFile(resolve(dir, "local-rotation-evidence.json"), "utf8"));
const observations = windows.map((row, i) => ({ id: `observation-${i + 1}`, atMs: row.endTick * 1000, frames: [`frames/${String(row.endTick).padStart(4, "0")}.jpg`] }));
const second = (scores: number[]) => [...scores].sort((a, b) => b - a)[1] ?? 0;
const links: SegmentLink[] = pairs.map((row: any, i: number) => ({ id: `visual-${i}`, a: row.a, b: row.b, kind: "visual", confidence: Math.min(second(row.bearings), second(row.backwardBearings ?? row.bearings)), source: "cached-bidirectional-features", frames: row.views.map((view: any) => view.frame) }));
for (const [i, row] of geometry.pairs.entries()) links.push({ id: `geometry-${i}`, a: row.a, b: row.b, kind: "geometric", confidence: 1, source: row.source, frames: row.matches.flatMap((match: any) => match.frames) });
const byPair = new Map(pairs.map((row: any) => [[row.a, row.b].sort().join("\0"), row]));
// Weak visual-change baseline is NOT a spatial crossing detector. It may
// split candidates, but never supplies negative physical-region evidence.
const changes: BoundaryEvent[] = [];
let weak = 0;
for (let i = 1; i < observations.length; i++) {
	const pair: any = byPair.get([observations[i - 1]!.id, observations[i]!.id].sort().join("\0"));
	if (pair && Math.min(second(pair.bearings), second(pair.backwardBearings ?? pair.bearings)) < .4) weak++; else weak = 0;
	if (weak === 2) changes.push({ id: `weak-change-${i}`, beforeObservationId: observations[i]!.id, source: "automatic", reason: "Two weak adjacent visual correspondences: diagnostic change-point proposal, not verified crossing", frames: [...observations[i - 1]!.frames, ...observations[i]!.frames] });
}
const conditions = [{ name: "no-boundaries", boundaries: [] }, { name: "oracle-boundaries", boundaries: annotations.boundaries }, { name: "weak-visual-change", boundaries: changes }].map(condition => {
	const segmentation = segmentExperience(observations, condition.boundaries, 1);
	const started = performance.now();
	const associations = associateSegments(segmentation.segments, links, [], 1);
	const matchingMs = performance.now() - started;
	const truth = annotations.transitionIntervals ?? annotations.boundaries.map((event: BoundaryEvent) => { const row = observations.find(item => item.id === event.beforeObservationId)!; return { id: event.id, earliestMs: row.atMs, latestMs: row.atMs }; });
	const boundaryScore = scoreTransitions(truth, condition.boundaries.map((event: BoundaryEvent) => ({ id: event.id, atMs: observations.find(row => row.id === event.beforeObservationId)!.atMs })), 3000);
	return { name: condition.name, segmentation, associations, matchingMs, boundaryScore };
});
await writeFile(output, JSON.stringify({ note: "AI-reviewed development oracle diagnostic. Oracle supplies cuts only, not historical region IDs. No metric poses/room labels enter matcher. Weak visual change is a diagnostic baseline, not a claimed boundary algorithm. Region accuracy requires separate evaluation labels; supported segment matching does not validate within-segment scope.", conditions }, null, 2), { flag: "wx" });
console.log(JSON.stringify(conditions.map(row => ({ name: row.name, segments: row.segmentation.segments.length, supportedReturns: row.associations.hypotheses.filter(item => item.status === "supported").length, proposedCandidates: row.associations.hypotheses.reduce((n, item) => n + item.candidates.filter(candidate => candidate.status === "proposed").length, 0), boundaryF1: row.boundaryScore.f1, matchingMs: row.matchingMs })), null, 2));
