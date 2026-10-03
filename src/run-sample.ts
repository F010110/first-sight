import { readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { appendRun, argValue, executeCase, safeName, writeSessionManifest, type CaseInput } from "./experiment.js";

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const modelName = argValue(args, "--model", "");
	if (modelName) process.env.QWEN_MODEL = modelName;
	const positional = args.filter((arg, index) => !arg.startsWith("--") && index === 0);
	const framesDir = resolve(positional[0] ?? "run/frames");
	const goalValue = argValue(args, "--goal", "").trim() || null;
	const count = Number(argValue(args, "--count", "4"));
	const intervalSeconds = Number(argValue(args, "--interval", "5"));
	if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error("--count must be an integer from 1 to 8");
	if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) throw new Error("--interval must be greater than zero");
	const files = (await readdir(framesDir)).filter((name) => /\.(jpe?g|png|webp|gif)$/i.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	if (files.length === 0) throw new Error(`No image files found in ${framesDir}`);
	const selected = files.slice(-count);
	const testCase: CaseInput = {
		caseId: argValue(args, "--case-id", "sample"), goal: goalValue,
		frames: selected.map((file, index) => {
			const match = file.match(/(\d+)(?=\.[^.]+$)/);
			const sequence = match ? Number(match[1]) : files.length - selected.length + index;
			return { id: file.replace(/\.[^.]+$/, ""), timestampMs: sequence * intervalSeconds * 1000, path: join(framesDir, file) };
		}),
	};
	const sessionId = safeName(argValue(args, "--session", `sample-${new Date().toISOString().replace(/[:.]/g, "-")}`));
	const root = resolve(argValue(args, "--root", "run/experiments"));
	await writeSessionManifest(root, sessionId, safeName(argValue(args, "--profile", "default")));
	const record = await executeCase(sessionId, testCase);
	const saved = await appendRun(root, record);
	await writeFile(resolve("run/harness-observation.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
	process.stdout.write(`${JSON.stringify(record, null, 2)}\nSaved run: ${saved}\n`);
	if (record.status === "error") process.exitCode = 1;
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`Harness failed: ${message}\n`);
	process.exitCode = 1;
});
