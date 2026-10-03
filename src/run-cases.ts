import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { appendRun, argValue, executeCase, readCases, readFeedback, readRunRecords, safeName, sessionSummary, writeSessionManifest } from "./experiment.js";

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const modelName = argValue(args, "--model", "");
	if (modelName) process.env.QWEN_MODEL = modelName;
	const casesPath = argValue(args, "--cases", "");
	if (!casesPath) throw new Error("Usage: harness:cases --cases cases.json --session exp-name [--profile baseline]");
	const cases = await readCases(resolve(casesPath));
	const sessionId = safeName(argValue(args, "--session", ""));
	const profile = safeName(argValue(args, "--profile", "default"));
	const root = resolve(argValue(args, "--root", "run/experiments"));
	await writeSessionManifest(root, sessionId, profile);
	for (const [index, testCase] of cases.entries()) {
		const record = await executeCase(sessionId, testCase);
		const path = await appendRun(root, record);
		process.stdout.write(`[${index + 1}/${cases.length}] ${testCase.caseId}: ${record.status}${record.result ? ` / ${record.result.decision} / ${record.result.latencyMs}ms` : ` / ${record.error?.message}`}\n`);
		if (index === cases.length - 1) process.stdout.write(`Records: ${path}\n`);
	}
	const records = await readRunRecords(sessionId, root);
	const summary = sessionSummary(records, await readFeedback(sessionId, root));
	await mkdir(resolve(root, sessionId), { recursive: true });
	await writeFile(resolve(root, sessionId, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
	process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
	if (summary.failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
	process.stderr.write(`Experiment failed: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
