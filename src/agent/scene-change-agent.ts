import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import { createQwenModel } from "./qwen-provider.js";
import type { FrameRef } from "./types.js";

/**
 * SceneChangeAgent (role 2 of 3): detects changes *inside* a scene that are not
 * explained by the camera moving — an object was added/removed/moved, a person
 * appeared, a light/door changed. It keeps the last representative view and asks
 * the model to compare, discounting the ego-motion described in MOTION.
 *
 * It never decides whether to speak; it emits a change event + candidate wording.
 */

export interface SceneChangeEvent {
	atMs: number;
	what: string;
	candidateUtterance: string | null;
	confidence: number;
	frameId: string;
}

export interface SceneChangeResult {
	changed: boolean;
	what: string | null;
	candidateUtterance: string | null;
	confidence: number;
	frameIds: string[];
	baselineSet: boolean;
	raw: string;
}

interface Baseline {
	frameId: string;
	timestampMs: number;
	data: string;
	mimeType: string;
	label: string | null;
}

const SYSTEM_PROMPT = [
	"You compare an earlier view of a scene with the current view of the same place.",
	"Decide whether the SCENE ITSELF changed — an object was added, removed or moved, a person appeared or left, a door/light changed, or similar.",
	"Discount changes caused only by the camera moving or turning (MOTION describes that). A new viewpoint is NOT a scene change.",
	"Ignore blur, exposure and compression differences.",
	"Be conservative: only report changed=true when the evidence is clear; otherwise changed=false.",
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

function parseChange(text: string): Omit<SceneChangeResult, "frameIds" | "baselineSet" | "raw"> {
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
	private baseline: Baseline | null = null;
	private events: SceneChangeEvent[] = [];

	constructor() {
		const configured = createQwenModel(512);
		this.model = configured.model;
		this.streamFn = configured.streamFn;
	}

	getState(): { events: SceneChangeEvent[]; baselineFrameId: string | null } {
		return { events: this.events.slice(-20), baselineFrameId: this.baseline?.frameId ?? null };
	}

	/** Resets the comparison baseline, e.g. after the SceneAgent reports a new scene. */
	resetBaseline(): void { this.baseline = null; }

	async observe(frames: FrameRef[], motionDescription: string | null, sceneLabel: string | null = null): Promise<SceneChangeResult> {
		if (frames.length === 0) throw new Error("SceneChangeAgent needs at least one frame");
		const ordered = frames.slice().sort((a, b) => a.timestampMs - b.timestampMs).slice(-3);
		const latest = ordered[ordered.length - 1]!;
		const latestData = (await readFile(latest.path)).toString("base64");
		const latestMime = mimeTypeFor(latest.path);

		if (!this.baseline) {
			this.baseline = { frameId: latest.id, timestampMs: latest.timestampMs, data: latestData, mimeType: latestMime, label: sceneLabel };
			return { changed: false, what: null, candidateUtterance: null, confidence: 0, frameIds: [latest.id], baselineSet: true, raw: "" };
		}

		const imageContents: ImageContent[] = [
			{ type: "image", data: this.baseline.data, mimeType: this.baseline.mimeType },
			{ type: "image", data: latestData, mimeType: latestMime },
		];
		const prompt = [
			"The first image is the EARLIER view; the following image(s) are the CURRENT view.",
			`SCENE: ${sceneLabel ?? "unknown"}`,
			`MOTION (approximate, how the phone moved between the two views): ${motionDescription ?? "none"}`,
			"Did the scene itself change (beyond the camera moving)? Reply with only the JSON object.",
		].join("\n\n");
		const agent = new Agent({ initialState: { systemPrompt: SYSTEM_PROMPT, model: this.model, tools: [] }, streamFn: this.streamFn });
		await agent.prompt(prompt, imageContents);
		if (agent.state.errorMessage) throw new Error(`SceneChangeAgent request failed: ${agent.state.errorMessage}`);
		const assistant = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
		if (!assistant || assistant.role !== "assistant") throw new Error("SceneChangeAgent returned no assistant message");
		const raw = assistant.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
		const parsed = parseChange(raw);
		const frameIds = [latest.id];
		if (parsed.changed && parsed.confidence >= 0.6) {
			this.events.push({ atMs: Date.now(), what: parsed.what ?? "unspecified change", candidateUtterance: parsed.candidateUtterance, confidence: parsed.confidence, frameId: latest.id });
			this.baseline = { frameId: latest.id, timestampMs: latest.timestampMs, data: latestData, mimeType: latestMime, label: sceneLabel };
		}
		return { ...parsed, frameIds, baselineSet: false, raw };
	}
}
