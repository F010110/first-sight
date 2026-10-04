import { mkdir, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, resolve } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import { createQwenModel } from "./qwen-provider.js";
import { detectChanges, type ChangeRegion } from "./image-change.js";
import type { FrameRef } from "./types.js";

/**
 * SceneChangeAgent (role 2 of 3): detects *new changes inside a place*.
 *
 * The SceneAgent decides which place the user is in. Only when that place is a
 * known scene (same or revisited) does this agent compare the current view with
 * that scene's stored baseline. The comparison is registration-based: feature
 * matching aligns the two views, so differences in framing / camera angle do
 * NOT count; only content that actually changed (an object added/removed/moved,
 * a screen/light changed state) shows up as a local residual blob.
 *
 * The local-change detector is the trigger and the filter. The VLM is called
 * only when real candidate blobs are found, and is shown the baseline plus the
 * current view with those blobs boxed; it decides whether they are a genuine
 * scene change or just parallax / reflection / exposure.
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
	reason: string | null;
	raw: string;
}

interface Baseline {
	framePath: string;
	timestampMs: number;
	frameId: string;
	label: string | null;
}

const MIN_OVERLAP_RATIO = 0.5;
const MIN_CHANGE_RATIO = 0.005;
const MIN_REGION_FRACTION = 0.004;
const VLM_MIN_CONFIDENCE = 0.6;

const SYSTEM_PROMPT = [
	"You compare an EARLIER view of a place with the CURRENT view of the SAME place.",
	"The two images are already geometrically aligned by feature matching, and a local-change detector has flagged the listed regions as different; the boxes on the current image mark them.",
	"These flags are candidates, not proof: parallax, reflections, blur or exposure changes can cause them.",
	"Decide whether the SCENE ITSELF changed: an object was added, removed or moved, a person appeared or left, or a door / light / screen changed state.",
	"Do NOT report pure viewpoint, framing, camera-angle or exposure differences — those are already accounted for by the alignment.",
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

function describeRegions(regions: ChangeRegion[]): string {
	return regions.slice(0, 5).map((region, index) => `#${index + 1} ${region.w}x${region.h}px area=${region.area} diff=${region.meanDiff}`).join("; ");
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

	/** Drops a scene's baseline (e.g. after that scene was re-created). */
	resetBaseline(sceneId?: string): void {
		if (sceneId) this.baselines.delete(sceneId);
		else this.baselines.clear();
	}

	async observe(frames: FrameRef[], motionDescription: string | null, sceneId: string | null, sceneLabel: string | null = null): Promise<SceneChangeResult> {
		if (frames.length === 0) throw new Error("SceneChangeAgent needs at least one frame");
		const ordered = frames.slice().sort((a, b) => a.timestampMs - b.timestampMs).slice(-3);
		const latest = ordered[ordered.length - 1]!;
		const key = sceneId ?? "default";
		const baseline = this.baselines.get(key);

		if (!baseline) {
			this.baselines.set(key, { framePath: latest.path, timestampMs: latest.timestampMs, frameId: latest.id, label: sceneLabel });
			return { changed: false, what: null, candidateUtterance: null, confidence: 0, frameIds: [latest.id], baselineSet: true, sceneId: key, detection: null, reason: "baseline established", raw: "" };
		}

		let boxesPath: string | null = null;
		if (this.workDir) {
			try { await mkdir(this.workDir, { recursive: true }); boxesPath = resolve(this.workDir, `change-${randomUUID()}.jpg`); }
			catch { boxesPath = null; }
		}
		const detection = await detectChanges(baseline.framePath, latest.path, { minArea: 250, maxDim: 640, ...(boxesPath ? { boxesPath } : {}) });
		const summary = { aligned: detection.aligned, inliers: detection.inliers, overlapRatio: detection.overlapRatio, changedRatio: detection.changedRatio, regionCount: detection.regions.length };
		const quiet = (reason: string): SceneChangeResult => ({ changed: false, what: null, candidateUtterance: null, confidence: 0, frameIds: [latest.id], baselineSet: false, sceneId: key, detection: summary, reason, raw: "" });

		// Cannot compare reliably: the view/framing differs too much. This is NOT a
		// scene change; move the baseline forward so we compare like with like next.
		if (!detection.ok || !detection.aligned || detection.overlapRatio < MIN_OVERLAP_RATIO) {
			this.baselines.set(key, { framePath: latest.path, timestampMs: latest.timestampMs, frameId: latest.id, label: sceneLabel });
			if (boxesPath) await unlink(boxesPath).catch(() => {});
			return quiet(detection.reason ?? (detection.aligned ? "insufficient overlap" : "views could not be aligned"));
		}

		// Same scene: only proceed when a change is *significant* (a large-enough
		// blob). This filters the small parallax/edge residue left after alignment
		// so camera movement inside the place is not mistaken for a scene change.
		const compareArea = detection.compareArea ?? 0;
		const largest = detection.regions[0]?.area ?? 0;
		const significant = compareArea > 0 && largest >= MIN_REGION_FRACTION * compareArea && detection.changedRatio >= MIN_CHANGE_RATIO;
		if (!detection.regions.length || !significant) {
			if (boxesPath) await unlink(boxesPath).catch(() => {});
			return quiet("no significant local change");
		}

		// Candidate local changes -> let the VLM confirm and name them.
		const images = await this.buildImages(baseline.framePath, boxesPath ?? latest.path);
		if (boxesPath) await unlink(boxesPath).catch(() => {});
		const prompt = [
			"The first image is the EARLIER aligned view of the place; the second is the CURRENT view (flagged regions boxed).",
			`SCENE: ${sceneLabel ?? key}`,
			`MOTION (approximate, how the phone moved between the two views): ${motionDescription ?? "none"}`,
			`FLAGGED_REGIONS (${detection.regions.length}, changed ${(detection.changedRatio * 100).toFixed(1)}% of the compared area): ${describeRegions(detection.regions)}`,
			"Did the scene itself change, or are these just parallax / reflection / exposure? Reply with only the JSON object.",
		].join("\n\n");
		const parsed = await this.ask(prompt, images);
		const changed = parsed.changed && parsed.confidence >= VLM_MIN_CONFIDENCE;
		if (changed) {
			this.events.push({ atMs: Date.now(), sceneId: key, what: parsed.what ?? "unspecified change", candidateUtterance: parsed.candidateUtterance, confidence: parsed.confidence, frameId: latest.id, regionCount: detection.regions.length, changedRatio: detection.changedRatio });
		}
		// Advance the baseline after a comparison with candidates so the same
		// flags are not re-examined on every tick.
		this.baselines.set(key, { framePath: latest.path, timestampMs: latest.timestampMs, frameId: latest.id, label: sceneLabel });
		return {
			changed, what: changed ? parsed.what : null, candidateUtterance: changed ? parsed.candidateUtterance : null,
			confidence: parsed.confidence, frameIds: [latest.id], baselineSet: false, sceneId: key,
			detection: summary, reason: changed ? null : "flagged regions judged not a scene change", raw: parsed.raw,
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
