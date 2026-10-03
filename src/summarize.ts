import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { argValue, readFeedback, readRunRecords, safeName, sessionSummary } from "./experiment.js";

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const sessionsArg = argValue(args, "--sessions", argValue(args, "--session", ""));
	const sessions = sessionsArg.split(",").map((name) => safeName(name.trim())).filter(Boolean);
	if (!sessions.length) throw new Error("Usage: harness:summary --session ID or --sessions baseline,variant");
	const root = resolve(argValue(args, "--root", "run/experiments"));
	const reports = [];
	type CaseRow = { decision: string; response: string | null; latencyMs: number | null; status: string; goal: string | null; frameHashes: Array<string | null> };
	const rowsBySession = new Map<string, Map<string, CaseRow>>();
	for (const session of sessions) {
		const records = await readRunRecords(session, root);
		const feedback = await readFeedback(session, root);
		const summary = sessionSummary(records, feedback);
		reports.push({ sessionId: session, summary });
		const rowMap = new Map<string, CaseRow>();
		for (const record of records) rowMap.set(record.caseId, {
			decision: record.result?.decision ?? "error", response: record.result?.response ?? null,
			latencyMs: record.result?.latencyMs ?? null, status: record.status,
			goal: record.input.goal, frameHashes: record.input.frames.map((frame) => frame.sha256),
		});
		rowsBySession.set(session, rowMap);
		await writeFile(resolve(root, session, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
	}
	const comparisons = new Set<string>();
	for (const map of rowsBySession.values()) for (const id of map.keys()) comparisons.add(id);
	const caseComparison = [...comparisons].sort().map((caseId) => {
		const rows = Object.fromEntries(sessions.map((session) => [session, rowsBySession.get(session)?.get(caseId) ?? null]));
		const signatures = sessions.map((session) => {
			const row = rowsBySession.get(session)?.get(caseId);
			return row ? JSON.stringify([row.goal, row.frameHashes]) : null;
		}).filter((value): value is string => value !== null);
		return { caseId, sameInput: new Set(signatures).size <= 1, sessions: rows };
	});
	const report = { generatedAt: new Date().toISOString(), sessions: reports, caseComparison };
	const output = resolve(argValue(args, "--out", "run/experiments/comparison.json"));
	await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	process.stdout.write(`${JSON.stringify(report, null, 2)}\nSaved comparison: ${output}\n`);
}

main().catch((error: unknown) => {
	process.stderr.write(`Summary failed: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
