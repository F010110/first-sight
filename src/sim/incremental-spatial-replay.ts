import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, basename, join } from "node:path";
import { IncrementalSpatialMemory } from "../agent/incremental-spatial-memory.js";
import { createIncrementalSpatialVlm } from "../agent/incremental-spatial-vlm.js";

const [capture, output, limitArg = "8"] = process.argv.slice(2);
if (!capture || !output) throw new Error("Usage: capture-directory NEW-output-directory [limit=8]");
const limit = Number(limitArg);
if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid limit");
await mkdir(output); // Never silently overwrite an earlier trial.
const rows = (await readFile(join(capture, "windows.jsonl"), "utf8")).trim().split(/\r?\n/).map(s => JSON.parse(s) as { timestampMs?: number; endTick: number; frame: string });
const memory = new IncrementalSpatialMemory(join(output, "memory.json"), createIncrementalSpatialVlm(join(output, "requests")));
const summary: Record<string, unknown> = { protocol: "incremental-spatial-v1", capture, planned: Math.min(limit, rows.length), model: "qwen3.8-flash", status: "running", results: [], failures: [] };
for (let i = 0; i < Math.min(limit, rows.length); i++) {
	const row = rows[i]!, started = Date.now();
	try {
		const record = await memory.enqueue({ id: `observation-${i + 1}`, atMs: row.timestampMs ?? row.endTick * 1000, frames: [resolve(capture, "triple", basename(row.frame))] });
		(summary.results as unknown[]).push({ id: record.observation.id, placeId: record.placeId, decision: record.decision, elapsedMs: Date.now() - started });
		console.log(JSON.stringify((summary.results as unknown[]).at(-1)));
	} catch (error) {
		(summary.failures as unknown[]).push({ id: `observation-${i + 1}`, errorType: (error as Error).name });
		// Stop rather than silently skip observations and claim full coverage.
		summary.status = "failed";
		break;
	}
	await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
}
if (summary.status === "running") summary.status = "finished";
await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
