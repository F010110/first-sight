import { appendFeedback, argValue, safeName } from "./experiment.js";
import { resolve } from "node:path";

function boolArg(args: string[], name: string): boolean | null {
	const value = argValue(args, name, "").toLowerCase();
	if (!value || value === "null" || value === "na") return null;
	if (["true", "1", "yes", "y"].includes(value)) return true;
	if (["false", "0", "no", "n"].includes(value)) return false;
	throw new Error(`${name} must be true, false, or omitted`);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const sessionId = safeName(argValue(args, "--session", ""));
	const runId = argValue(args, "--run-id", "");
	if (!runId) throw new Error("Usage: harness:feedback --session ID --run-id ID --useful true|false [other labels]");
	const annotator = argValue(args, "--annotator", "");
	const path = await appendFeedback(resolve(argValue(args, "--root", "run/experiments")), sessionId, {
		runId,
		useful: boolArg(args, "--useful"),
		perceptionCorrect: boolArg(args, "--perception-correct"),
		positionCorrect: boolArg(args, "--position-correct"),
		decisionCorrect: boolArg(args, "--decision-correct"),
		responseCorrect: boolArg(args, "--response-correct"),
		notes: argValue(args, "--notes", "") || null,
		...(annotator ? { annotator } : {}),
	});
	process.stdout.write(`Feedback appended: ${path}\n`);
}

main().catch((error: unknown) => {
	process.stderr.write(`Feedback failed: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
