/** Oracle annotations supply only cuts, never historical region identity. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { segmentExperience, type BoundaryEvent } from "../../agent/experience-segments.js";
const [directory, boundaryFile, output] = process.argv.slice(2);
if (!directory || !boundaryFile || !output) throw new Error("Usage: experience-segment-eval dataset boundaries.json output.json");
const windows = (await readFile(resolve(directory, "windows.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
const annotations = JSON.parse(await readFile(resolve(boundaryFile), "utf8")) as { protocol: string; revision: number; reviewed: boolean; boundaries: BoundaryEvent[] };
if (annotations.protocol !== "boundary-events-v1" || annotations.reviewed !== true || !Array.isArray(annotations.boundaries)) throw new Error("Require reviewed boundary-events-v1 annotations");
// Strip oracle room/pose/action fields before segmentation.
const observations = windows.map((row, i) => ({ id: `observation-${i + 1}`, atMs: row.endTick * 1000, frames: [row.frame ?? `frames/${String(row.endTick).padStart(4, "0")}.jpg`] }));
await writeFile(resolve(output), JSON.stringify(segmentExperience(observations, annotations.boundaries, annotations.revision), null, 2), { flag: "wx" });
