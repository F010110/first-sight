import { mkdir, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, resolve } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import { createQwenModel } from "./qwen-provider.js";
import { detectChanges } from "./image-change.js";
import type { FrameRef } from "./types.js";

/**
 * SceneChangeAgent (role 2 of 3): detects *new changes inside a place*.
 *
 * The SceneAgent decides which place the user is in. When that place is a known
 * scene, this agent compares the current view with the scene's *canonical first
 * view* (its first stored representative), not with a continuously-updated view —
 * otherwise a change would be absorbed into the baseline and forgotten.
 *
 * Two paths:
 *  - Pixel path (preferred): register baseline/current with a homography and look
 *    for significant local residual blobs. Framing/angle differences are removed
 *    by the registration, so only real content changes remain.
 *  - VLM fallback: when the two views cannot be registered well (large pose
 *    change, texture-poor scene), the pixel diff is untrustworthy; ask the VLM to
 *    compare the two views semantically instead (rate-limited), ignoring
 *    viewpoint/framing.
 */

export interface SceneChangeEvent {
	atMs: number;
	sceneId: string;
	what: string;
	candidateUtterance: string | null;
	confidence: number;
	frameId: string;
	regionCount: number;
	changedRatio: number;
	via: "pixels" | "vlm-fallback";
}

export interface SceneChangeResult {
	changed: boolean;
	what: string | null;
	candidateUtterance: string | null;
	confidence: number;
	frameIds: string[];
	baselineSet: boolean;
	sceneId: string | null;
	detection: { aligned: boolean; inliers: number; overlapRatio: number; changedRatio: number; regionCount: number } | null;
	via: "pixels" | "vlm-fallback" | null;
	reason: string | null;
	raw: string;
}

interface Baseline {
	framePath: string;
	timestampMs: number;
	frameId: string;
	label: string | null;
	/** Last time the VLM compared this scene (to rate-limit checks). */
	lastVlmMs?: number;
}

const MIN_OVERLAP_RATIO = 0.5;
const MIN_INLIERS = 25;
const MIN_CHANGE_RATIO = 0.005;
const MIN_REGION_FRACTION = 0.004;
const VLM_MIN_CONFIDENCE = 0.6;
const MIN_VLM_INTERVAL_MS = 10_000;

const SYSTEM_PROMPT = [
	"You compare an EARLIER view of a place with the CURRENT view of the SAME place.",
	"Decide whether the SCENE ITSELF changed: an object was added, removed or moved, a person appeared or left, or a door / light / screen changed state.",
	"Do NOT report pure viewpoint, framing, camera-angle or exposure differences — the two views may be from different angles, that is not a change.",
	"When regions are boxed on the current image, a local-change detector already flagged them; they are candidates only (parallax, reflections or blur can cause them).",
	"Be conservative: only changed=true when the evidence is clear.",
	'Reply with ONLY JSON: {"changed": boolean, "what": string|null, "candidateUtterance": string|null, "confidence": number}. candidateUtterance is one short sentence the assistant could say, or null. No markdown.',
].join(" ");

function mimeTypeFor(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".jpg": case ".jpeg": return "image/jpeg";
		case ".png": return "image/png";
		case ".webp": return "image/webp";
		default: return "image/jpeg";
	}
}

interface ParsedChange {
	changed: boolean;
	what: string | null;
	candidateUtterance: string | null;
	confidence: number;
}

function parseChange(text: string): ParsedChange {
	const jsonText = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
	const root = JSON.parse(jsonText) as Record<string, unknown>;
	if (typeof root.changed !== "boolean") throw new Error("sceneChange.changed must be boolean");
	const confidence = typeof root.confidence === "number" && root.confidence >= 0 && root.confidence <= 1 ? root.confidence : 0.5;
	return {
		changed: root.changed,
		what: typeof root.what === "string" && root.what.trim() ? root.what.trim().slice(0, 200) : null,
		candidateUtterance: typeof root.candidateUtterance === "string" && root.candidateUtterance.trim() ? root.candidateUtterance.trim().slice(0, 200) : null,
		confidence,
	};
}

export class SceneChangeAgent {
	private readonly model: Model<"openai-completions">;
	private readonly streamFn: Agent["streamFunction"];
	private baselines = new Map<string, Baseline>();
	private events: SceneChangeEvent[] = [];

	constructor(private readonly workDir: string | null = null) {
		const configured = createQwenModel(512);
		this.model = configured.model;
		this.streamFn = configured.streamFn;
	}

	getState(): { events: SceneChangeEvent[]; baselines: Array<{ sceneId: string; frameId: string; label: string | null }> } {
		return {
			events: this.events.slice(-20),
			baselines: [...this.baselines.entries()].map(([sceneId, baseline]) => ({ sceneId, frameId: baseline.frameId, label: baseline.label })),
		};
	}

	resetBaseline(sceneId?: string): void {
		if (sceneId) this.baselines.delete(sceneId);
		else this.baselines.clear();
	}

	/**
	 * @param sceneBaselinePath the scene's canonical first view (from the scene
	 * memory). Used when this agent has no baseline for the scene yet, so the very
	 * first comparison is against the *pre-change* state.
	 */
	async observe(frames: FrameRef[], motionDescription: string | null, sceneId: string | null, sceneLabel: string | null = null, sceneBaselinePath: string | null = null): Promise<SceneChangeResult> {
		if (frames.length === 0) throw new Error("SceneChangeAgent needs at least one frame");
		const ordered = frames.slice().sort((a, b) => a.timestampMs - b.timestampMs).slice(-3);
		const latest = ordered[ordered.length - 1]!;
		const key = sceneId ?? "default";

		let baseline = this.baselines.get(key);
		if (!baseline && sceneBaselinePath) {
			baseline = { framePath: sceneBaselinePath, timestampMs: 0, frameId: "scene-baseline", label: sceneLabel };
			this.baselines.set(key, baseline);
		}
		if (!baseline) {
			this.baselines.set(key, { framePath: latest.path, timestampMs: latest.timestampMs, frameId: latest.id, label: sceneLabel });
			return { changed: false, what: null, candidateUtterance: null, confidence: 0, frameIds: [latest.id], baselineSet: true, sceneId: key, detection: null, via: null, reason: "baseline established", raw: "" };
		}

		let boxesPath: string | null = null;
		if (this.workDir) {
			try { await mkdir(this.workDir, { recursive: true }); boxesPath = resolve(this.workDir, `change-${randomUUID()}.jpg`); }
			catch { boxesPath = null; }
		}
		const detection = await detectChanges(baseline.framePath, latest.path, { minArea: 250, maxDim: 640, ...(boxesPath ? { boxesPath } : {}) });
		const summary = { aligned: detection.aligned, inliers: detection.inliers, overlapRatio: detection.overlapRatio, changedRatio: detection.changedRatio, regionCount: detection.regions.length };
		const quiet = (reason: string): SceneChangeResult => ({ changed: false, what: null, candidateUtterance: null, confidence: 0, frameIds: [latest.id], baselineSet: false, sceneId: key, detection: summary, via: null, reason, raw: "" });

		const aligned = detection.ok && detection.aligned && detection.inliers >= MIN_INLIERS && detection.overlapRatio >= MIN_OVERLAP_RATIO;
		const compareArea = detection.compareArea ?? 0;
		const largest = detection.regions[0]?.area ?? 0;
		const significant = compareArea > 0 && largest >= MIN_REGION_FRACTION * compareArea && detection.changedRatio >= MIN_CHANGE_RATIO;

		// The pixel detector is only a trigger and a hint: a significant blob
		// triggers a check immediately, otherwise we check on a fixed interval.
		// Either way the VLM is the one that decides whether the place changed.
		const now = Date.now();
		if (!significant && baseline.lastVlmMs && now - baseline.lastVlmMs < MIN_VLM_INTERVAL_MS) {
			if (boxesPath) await unlink(boxesPath).catch(() => {});
			return quiet("within the change-check interval");
		}
		baseline.lastVlmMs = now;

		const useBoxes = aligned && boxesPath && detection.regions.length > 0;
		const images = await this.buildImages(baseline.framePath, useBoxes ? boxesPath! : latest.path);
		if (boxesPath) await unlink(boxesPath).catch(() => {});
		const via: "pixels" | "vlm-fallback" = useBoxes ? "pixels" : "vlm-fallback";
		const promptLines = [
			"The first image is an EARLIER view of the place; the second is the CURRENT view. They are the same place but may be from different angles.",
			`SCENE: ${sceneLabel ?? key}`,
			`MOTION (approximate, how the phone moved between the two views): ${motionDescription ?? "none"}`,
		];
		if (via === "pixels") {
			promptLines.push(`FLAGGED_REGIONS (${detection.regions.length}, changed ${(detection.changedRatio * 100).toFixed(1)}% of the compared area; boxed on the current image): ${detection.regions.slice(0, 5).map((region, index) => `#${index + 1} ${region.w}x${region.h}px area=${region.area} diff=${region.meanDiff}`).join("; ")}`);
			promptLines.push("Did the scene itself change, or are these just parallax / reflection / exposure? Reply with only the JSON object.");
		} else {
			promptLines.push("The local-change detector found no clear pixel difference (or could not register the two views), so rely on what you can see: ignore viewpoint, framing and exposure, and decide whether the content of the place itself changed (an object moved, or a screen / light changed). Reply with only the JSON object.");
		}
		const parsed = await this.ask(promptLines.join("\n\n"), images);
		const changed = parsed.changed && parsed.confidence >= VLM_MIN_CONFIDENCE;
		if (changed) {
			this.events.push({ atMs: Date.now(), sceneId: key, what: parsed.what ?? "unspecified change", candidateUtterance: parsed.candidateUtterance, confidence: parsed.confidence, frameId: latest.id, regionCount: detection.regions.length, changedRatio: detection.changedRatio, via });
			// The new state becomes the reference for the next comparison.
			this.baselines.set(key, { framePath: latest.path, timestampMs: latest.timestampMs, frameId: latest.id, label: sceneLabel, ...(baseline.lastVlmMs !== undefined ? { lastVlmMs: baseline.lastVlmMs } : {}) });
		}
		return {
			changed, what: changed ? parsed.what : null, candidateUtterance: changed ? parsed.candidateUtterance : null,
			confidence: parsed.confidence, frameIds: [latest.id], baselineSet: false, sceneId: key,
			detection: summary, via, reason: changed ? null : "compared, judged not a scene change", raw: parsed.raw,
		};
	}

	private async buildImages(baselinePath: string, currentPath: string): Promise<ImageContent[]> {
		const images: ImageContent[] = [];
		for (const path of [baselinePath, currentPath]) {
			try { images.push({ type: "image", data: (await readFile(path)).toString("base64"), mimeType: mimeTypeFor(path) }); }
			catch { /* skip unreadable frame */ }
		}
		return images;
	}

	private async ask(prompt: string, images: ImageContent[]): Promise<ParsedChange & { raw: string }> {
		const agent = new Agent({ initialState: { systemPrompt: SYSTEM_PROMPT, model: this.model, tools: [] }, streamFn: this.streamFn });
		await agent.prompt(prompt, images);
		if (agent.state.errorMessage) throw new Error(`SceneChangeAgent request failed: ${agent.state.errorMessage}`);
		const assistant = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
		if (!assistant || assistant.role !== "assistant") throw new Error("SceneChangeAgent returned no assistant message");
		const raw = assistant.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
		return { ...parseChange(raw), raw };
	}
}
