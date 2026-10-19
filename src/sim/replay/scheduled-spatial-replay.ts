import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IncrementalSpatialMemory } from "../../agent/incremental-spatial-memory.js";
import { createIncrementalSpatialVlm } from "../../agent/incremental-spatial-vlm.js";

const [schedulePath, output] = process.argv.slice(2);
if (!schedulePath || !output) throw new Error("Usage: schedule.json NEW-output-directory");
const schedule = JSON.parse(await readFile(schedulePath, "utf8")) as { calls: Array<{ id: string; atMs: number; frames: string[]; scheduledAtMs: number; evidence?: Array<{ id: string; atMs: number; path: string }> }> };
await mkdir(output);
const memory = new IncrementalSpatialMemory(join(output, "memory.json"), createIncrementalSpatialVlm(join(output, "requests")));
const results: unknown[] = [];
let status = "finished";
for (const call of schedule.calls) {
	const start = Date.now();
	try {
		const result = await memory.enqueue({ id: call.id, atMs: call.atMs, frames: call.frames, ...(call.evidence ? { evidence: call.evidence } : {}) });
		results.push({ ...result, scheduledAtMs: call.scheduledAtMs, elapsedMs: Date.now() - start });
		console.log(JSON.stringify(results.at(-1)));
	} catch (error) { results.push({ id: call.id, errorType: (error as Error).name }); status = "failed"; break; }
	await writeFile(join(output, "summary.json"), JSON.stringify({ schedulePath, status: "running", planned: schedule.calls.length, results }, null, 2));
}
await writeFile(join(output, "summary.json"), JSON.stringify({ schedulePath, status, planned: schedule.calls.length, results }, null, 2));
