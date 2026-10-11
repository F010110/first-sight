import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { segmentExperience } from "../agent/experience-segments.js";
import { associateSegments } from "../agent/segment-association.js";
const [directory, boundaryPath, evidencePath, output] = process.argv.slice(2);
if (!directory || !boundaryPath || !evidencePath || !output) throw new Error("Usage: expanded-oracle-eval dataset oracle-boundaries evidence output");
const rows = (await readFile(resolve(directory, "windows.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
const boundary = JSON.parse(await readFile(boundaryPath, "utf8"));
if (!boundary.reviewed || boundary.protocol !== "boundary-events-v1") throw new Error("Reviewed event annotations required");
const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
const observations = rows.map((row, i) => ({ id: `observation-${i + 1}`, atMs: row.endTick * 1000, frames: [row.frame] }));
const segmentation = segmentExperience(observations, boundary.boundaries, 1);
const started = performance.now();
// Older extraction files can reconstruct the used inventory from link endpoints;
// keep the fixed eight-per-batch budget even if some anchors have zero features.
const candidates = segmentation.segments.map(segment => ({ ...segment, anchorObservationIds: evidence.anchorObservationIds
	? evidence.anchorObservationIds.filter((id: string) => segment.observationIds.includes(id))
	: Array.from(new Set(Array.from({ length: Math.min(8, segment.observationIds.length) }, (_, j) => segment.observationIds[Math.round(j * (segment.observationIds.length - 1) / Math.max(1, Math.min(8, segment.observationIds.length) - 1))]!))) }));
const association = associateSegments(candidates, evidence.links, [], 1);
await writeFile(output, JSON.stringify({ note: "Oracle cuts + automatic sparse multi-anchor historical hypotheses. Correct-return scoring must run separately with evaluation labels. No claim of core coverage or automatic boundary detection.", segmentation, association, matchingMs: performance.now() - started }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ segments: segmentation.segments.length, supported: association.hypotheses.filter(row => row.status === "supported").length, ambiguous: association.hypotheses.filter(row => row.status === "ambiguous").length }));
