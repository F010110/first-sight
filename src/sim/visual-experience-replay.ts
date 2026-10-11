import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { replayVisualExperience, type VisualMotionStep } from "../agent/visual-experience-pipeline.js";
import type { SegmentLink } from "../agent/segment-association.js";
import { VisualExperienceMemory } from "../agent/visual-experience-memory.js";
import { proposeTemporalBoundaries } from "../agent/temporal-region-continuity.js";
import type { BoundaryEvent } from "../agent/experience-segments.js";

const [directory, outputDirectory, voPath, boundaryPath, baselineDirectory, revisitPath] = process.argv.slice(2);
if (!directory || !outputDirectory) throw new Error("Usage: visual-experience-replay dataset NEW-output-directory [VO-json] [automatic-boundary-tracks-json]");
const dir = resolve(directory), out = resolve(outputDirectory);
const readJson = async (name: string, base = dir) => JSON.parse(await readFile(resolve(base, name), "utf8"));
const windows = (await readFile(resolve(dir, "windows.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
if (!windows.length || windows.some((row: any, i: number) => !Number.isInteger(row.endTick) || row.endTick < 0 || i > 0 && row.endTick <= windows[i - 1].endTick)) throw new Error("Invalid chronological observation endpoints");
const vo = voPath ? JSON.parse(await readFile(resolve(voPath), "utf8")) : await readJson("three-view-vo-v1.json");
if (vo.protocol !== "three-view-vo-v1") throw new Error("Invalid VO protocol");
const memory = new VisualExperienceMemory();
const baselineDir = baselineDirectory ? resolve(baselineDirectory) : dir;
memory.association.restoreBundle(await readJson("experience-sequence-bundle.json", baselineDir));
const originalObservations = memory.association.graph.getState().observations;
const boundaryTracks = boundaryPath ? JSON.parse(await readFile(resolve(boundaryPath), "utf8")) : null;
if (boundaryTracks && (boundaryTracks.protocol !== "automatic-boundary-tracks-v1" || boundaryTracks.quality !== "experimental-inferred-not-certified" || !Array.isArray(boundaryTracks.events))) throw new Error("Invalid automatic boundary track protocol");
const pairs = await readJson("experience-directional-evidence.json", baselineDir), geometry = await readJson("local-rotation-evidence.json", baselineDir);
const second = (values: number[]) => [...values].sort((a, b) => b - a)[1] ?? 0;
const links: SegmentLink[] = pairs.map((row: any, i: number) => ({ id: `visual-${i}`, a: row.a, b: row.b, kind: "visual", confidence: Math.min(second(row.bearings), second(row.backwardBearings ?? row.bearings)), source: "cached-bidirectional-visual", frames: row.views.map((view: any) => view.frame) }));
for (const [i, row] of geometry.pairs.entries()) links.push({ id: `geometry-${i}`, a: row.a, b: row.b, kind: "geometric", confidence: 1, source: row.source, frames: row.matches.flatMap((match: any) => match.frames) });
if (revisitPath) {
	const revisit = JSON.parse(await readFile(resolve(revisitPath), "utf8"));
	if (revisit.protocol !== "revisit-surface-geometry-v1") throw new Error("Invalid revisit geometry protocol");
	for (const [i, row] of revisit.pairs.entries()) links.push({ id: `surface-geometry-${i}`, a: row.a, b: row.b, kind: "geometric", confidence: 1, source: row.source, frames: row.matches.flatMap((match: any) => match.frames) });
}
const observations = windows.map((row: any, i: number) => {
	const previousTick = i > 0 ? windows[i - 1].endTick : row.endTick;
	const steps: VisualMotionStep[] = vo.trace.filter((step: VisualMotionStep) => Number(step.afterFrame.split(".")[0]) > previousTick && Number(step.afterFrame.split(".")[0]) <= row.endTick).map(({ beforeFrame, afterFrame, status }: VisualMotionStep) => ({ beforeFrame, afterFrame, status }));
	if (i > 0 && (steps.length !== row.endTick - previousTick || Number(steps[0]?.beforeFrame.split(".")[0]) !== previousTick)) throw new Error("Incomplete VO interval coverage");
	// Explicit projection discards room, pose, motionPerfect and simulator labels.
	const id = `observation-${i + 1}`, original = originalObservations.find(item => item.id === id);
	if (!original || original.atMs !== row.endTick * 1000) throw new Error("Baseline observation mismatch");
	const boundaryEvidence = (boundaryTracks?.events ?? []).map((event: any, n: number) => ({ event, n })).filter(({ event }: any) => Number(event.atFrame.split(".")[0]) > previousTick && Number(event.atFrame.split(".")[0]) <= row.endTick).map(({ event, n }: any) => ({ id: `auto-track-${n}`, kind: event.kind, boundaryTrackId: event.boundaryTrackId, source: `${event.source}: ${event.reason}`, frames: event.frames.map((frame: string) => resolve(dir, "frames", frame)) }));
	return { id, atMs: row.endTick * 1000, frames: original.frames, motionSteps: steps, boundaryEvidence };
});
const started = performance.now();
// Preserve within-window event ordering: approach and passage may occur in
// the same three-frame observation window. Process native frame events first.
const rawTimeline = vo.trace.map((step: VisualMotionStep, i: number) => {
	const evidence = (boundaryTracks?.events ?? []).map((event: any, n: number) => ({ event, n })).filter(({ event }: any) => event.atFrame === step.afterFrame).map(({ event, n }: any) => ({ id: `native-track-${n}`, kind: event.kind, boundaryTrackId: event.boundaryTrackId, source: `${event.source}: ${event.reason}`, frames: event.frames }));
	if (step.status === "movement-candidate" && i > 0 && vo.trace[i - 1].status === "movement-candidate" && vo.trace[i - 1].afterFrame === step.beforeFrame) evidence.push({ id: `native-motion-${i}`, kind: "movement-support", source: "two consecutive three-view VO candidates; experimental", frames: [step.beforeFrame, step.afterFrame] });
	return { observation: { id: `frame-${step.afterFrame}`, atMs: Number(step.afterFrame.split(".")[0]) * 1000, frames: [step.afterFrame] }, evidence };
});
const nativeContinuity = proposeTemporalBoundaries(rawTimeline, { maxGapMs: 1500, maxCrossingMs: 15000, confirmationFrames: 2 });
const automaticBoundaryProposals = nativeContinuity.boundaries.flatMap(event => {
	const nativeTime = rawTimeline.find((row: any) => row.observation.id === event.beforeObservationId)!.observation.atMs;
	const targetIndex = observations.findIndex(row => row.atMs >= nativeTime);
	const confirmation = nativeContinuity.confirmations.find(row => row.boundaryEventId === event.id)!;
	if (targetIndex <= 0) return [];
	const mapped: BoundaryEvent = { ...event, id: `native-${event.id}`, beforeObservationId: observations[targetIndex]!.id, reason: `${event.reason}; native-frame crossing mapped to observation window; inferred only` };
	return [{ event: mapped, availableAtMs: confirmation.confirmedAtMs }];
});
const pipeline = replayVisualExperience(observations, links, [], undefined, automaticBoundaryProposals.map(row => row.event));
const integrated = memory.interpret({ observations, links, contradictions: [], automaticBoundaryProposals, reason: "Add VO/temporal interpretations without replacing original association or retrieval" });
const replayMs = performance.now() - started;
await mkdir(out, { recursive: false });
await pipeline.store.persist(resolve(out, "interpretation-bundle.json"));
await memory.persist(resolve(out, "integrated-memory.json"));
await writeFile(resolve(out, "pipeline.json"), JSON.stringify({ protocol: "visual-experience-pipeline-v2", ...pipeline.result, nativeContinuity, regions: integrated.regions, effective: integrated.effective, replayMs, extractionMs: { vo: vo.extractionMs ?? null, boundary: boundaryTracks?.extractionMs ?? null }, options: { maxGapMs: 4000, maxCrossingMs: 15000, confirmationFrames: 2 }, boundaryProducer: boundaryTracks ? "image-only-geometric-opening/open-layout-inference; experimental-not-certified" : "automatic-weak-visual-change-only", timing: "synthetic 1000ms/tick; extraction and replay reported separately" }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ observations: observations.length, boundaries: pipeline.result.continuity.boundaries.length, motionSupportedWindows: pipeline.result.motionSummary.filter(row => row.continuousMovement).length, replayMs }));
