import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Thin bridge to the offline image-overlap matcher (`scripts/image_match.py`).
 *
 * SIFT + RANSAC tells us whether two frames really share a surface (a close-up
 * vs a wide shot, or the same place seen twice), which is what makes an image
 * memory meaningful. All query frames are tried so one bad frame cannot hide a
 * real overlap. If Python/OpenCV is unavailable the call degrades to "no match"
 * so the VLM path keeps working.
 */

export interface ImageMatchCandidate { id: string; path: string }

export interface ImageMatchEntry {
	id: string;
	path?: string;
	queryPath?: string;
	inliers: number;
	good: number;
	ratio: number;
	bbox: { x0: number; y0: number; x1: number; y1: number } | null;
}

export interface ImageMatchQuery { path: string; keypoints: number }

export interface ImageMatchResponse {
	ok: boolean;
	queries: ImageMatchQuery[];
	best: ImageMatchEntry | null;
	results: ImageMatchEntry[];
	error?: string;
}

const EMPTY: ImageMatchResponse = { ok: false, queries: [], best: null, results: [] };

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

export async function matchImages(
	queries: string[],
	candidates: ImageMatchCandidate[],
	options: { minInliers?: number; maxDim?: number; ratio?: number; timeoutMs?: number } = {},
): Promise<ImageMatchResponse> {
	if (queries.length === 0) return EMPTY;
	const script = resolve("scripts", "image_match.py");
	if (!existsSync(script)) return { ...EMPTY, error: "scripts/image_match.py not found" };
	const payload = JSON.stringify({
		queries,
		candidates,
		minInliers: options.minInliers ?? 20,
		maxDim: options.maxDim ?? 900,
		ratio: options.ratio ?? 0.75,
	});

	return new Promise((resolvePromise) => {
		let settled = false;
		const finish = (value: ImageMatchResponse): void => { if (!settled) { settled = true; resolvePromise(value); } };
		let child;
		try {
			child = spawn(pythonPath(), [script], { stdio: ["pipe", "pipe", "pipe"] });
		} catch (error) {
			finish({ ...EMPTY, error: error instanceof Error ? error.message : String(error) });
			return;
		}
		const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } finish({ ...EMPTY, error: "image match timed out" }); }, options.timeoutMs ?? 20_000);
		let out = "";
		let err = "";
		child.stdout.on("data", (chunk) => { out += String(chunk); });
		child.stderr.on("data", (chunk) => { err += String(chunk); });
		child.on("error", (error) => { clearTimeout(timer); finish({ ...EMPTY, error: error.message }); });
		child.on("close", () => {
			clearTimeout(timer);
			const line = out.trim().split(/\r?\n/).filter(Boolean).at(-1);
			if (!line) { finish({ ...EMPTY, error: err.trim() || "empty matcher output" }); return; }
			try { const parsed = JSON.parse(line) as ImageMatchResponse; finish({ ...parsed, queries: parsed.queries ?? [] }); }
			catch { finish({ ...EMPTY, error: "matcher output was not JSON" }); }
		});
		child.stdin.on("error", () => { /* ignore broken pipe */ });
		child.stdin.write(payload);
		child.stdin.end();
	});
}
