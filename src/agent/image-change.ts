import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Bridge to the local change detector (`scripts/image_change.py`).
 *
 * It aligns the baseline view to the current view with a homography (SIFT +
 * RANSAC) and then reports the local residual blobs. Because the two views are
 * registered and only the well-overlapping interior is compared, differences in
 * framing / camera angle do NOT show up as changes — only content that actually
 * changed (an object moved, a screen/light changed) does.
 */

export interface ChangeRegion {
	x: number;
	y: number;
	w: number;
	h: number;
	area: number;
	meanDiff: number;
}

export interface ChangeDetection {
	ok: boolean;
	aligned: boolean;
	inliers: number;
	overlapRatio: number;
	threshold?: number;
	changedRatio: number;
	changed: boolean;
	compareArea?: number;
	width?: number;
	height?: number;
	regions: ChangeRegion[];
	reason?: string;
	error?: string;
}

const EMPTY: ChangeDetection = { ok: false, aligned: false, inliers: 0, overlapRatio: 0, changedRatio: 0, changed: false, regions: [] };

function pythonPath(): string {
	const candidates = [
		process.env.VLM_PYTHON,
		process.platform === "win32" ? resolve(".venv", "Scripts", "python.exe") : resolve(".venv", "bin", "python"),
		"python3",
		"python",
	].filter((value): value is string => Boolean(value));
	for (const candidate of candidates) {
		if (candidate === "python" || candidate === "python3" || existsSync(candidate)) return candidate;
	}
	return "python";
}

export async function detectChanges(
	baselinePath: string,
	currentPath: string,
	options: { minArea?: number; maxDim?: number; k?: number; boxesPath?: string; timeoutMs?: number } = {},
): Promise<ChangeDetection> {
	const script = resolve("scripts", "image_change.py");
	if (!existsSync(script)) return { ...EMPTY, error: "scripts/image_change.py not found" };
	const args = [
		script,
		baselinePath,
		currentPath,
		"--min-area", String(options.minArea ?? 250),
		"--max-dim", String(options.maxDim ?? 640),
		"--k", String(options.k ?? 4),
	];
	if (options.boxesPath) args.push("--boxes", options.boxesPath);

	return new Promise((resolvePromise) => {
		let settled = false;
		const finish = (value: ChangeDetection): void => { if (!settled) { settled = true; resolvePromise(value); } };
		let child;
		try {
			child = spawn(pythonPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
		} catch (error) {
			finish({ ...EMPTY, error: error instanceof Error ? error.message : String(error) });
			return;
		}
		const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } finish({ ...EMPTY, error: "change detection timed out" }); }, options.timeoutMs ?? 20_000);
		let out = "";
		let err = "";
		child.stdout.on("data", (chunk) => { out += String(chunk); });
		child.stderr.on("data", (chunk) => { err += String(chunk); });
		child.on("error", (error) => { clearTimeout(timer); finish({ ...EMPTY, error: error.message }); });
		child.on("close", () => {
			clearTimeout(timer);
			const line = out.trim().split(/\r?\n/).filter(Boolean).at(-1);
			if (!line) { finish({ ...EMPTY, error: err.trim() || "empty change-detector output" }); return; }
			try {
				const parsed = JSON.parse(line) as Partial<ChangeDetection>;
				finish({ ...EMPTY, ...parsed, regions: parsed.regions ?? [] });
			} catch { finish({ ...EMPTY, error: "change-detector output was not JSON" }); }
		});
	});
}
