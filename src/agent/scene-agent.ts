import { copyFile, mkdir, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import { createQwenModel } from "./qwen-provider.js";
import { matchImages } from "./image-match.js";
import type { FrameRef } from "./types.js";

/**
 * SceneAgent (role 1 of 3): updates the *scene memory*, including an out-of-band
 * image memory.
 *
 * Memory keeps, per scene, a few representative frames on disk plus their labels.
 * The memory images are NOT handed to the VLM by default. Before each
 * observation the local feature matcher (`image-match.ts`) compares the current
 * view against the stored representatives; only when it finds a clear overlap
 * (same surface/objects, e.g. a close-up vs a wide shot) does the agent attach the
 * matched stored image + label to the prompt, so the VLM can confirm "same place".
 * Otherwise the VLM works from the current frames alone.
 */

export interface SceneRepresentative {
	id: string;
	path: string;
}

export interface KnownScene {
	id: string;
	label: string;
	summary: string;
	objects: string[];
	visits: number;
	firstSeenMs: number;
	lastSeenMs: number;
	frameId: string | null;
	/** Representative views stored for image matching (not sent to the VLM unless matched). */
	frames: SceneRepresentative[];
}

export interface SceneResult {
	sceneId: string;
	label: string;
	summary: string;
	objects: string[];
	isNew: boolean;
	sameAsPrevious: boolean;
	revisited: boolean;
	matchedSceneId: string | null;
	changed: boolean;
	confidence: number;
	/** Local-feature match against memory, when one was strong enough to use. */
	match: { sceneId: string; inliers: number } | null;
	frameIds: string[];
	raw: string;
}

const SYSTEM_PROMPT = [
	"You maintain a memory of PLACES (scenes) for a first-person assistant.",
	"You are shown the current camera frames (in chronological order), how the phone moved (MOTION), PREVIOUS_SCENE, and KNOWN_SCENES recorded earlier.",
	"When an IMAGE_MATCH line is present, the LAST image is a stored representative of a previously recorded scene (not the current view). Local-feature matching says the current view and that stored image share a surface, so they are probably the same place.",
	"Decide the single place the user is in now. A place is a location such as 'desk area' or 'kitchen'.",
	"Turning the camera, looking around, or shifting a little inside the same place does NOT create a new place. Passing a doorway, or clearly relocating, does.",
	"Prefer reusing an existing label: if the current place is the PREVIOUS_SCENE or one of KNOWN_SCENES, reuse that scene's label and id.",
	"If different frames during the motion show different areas, judge by the place the user ends in.",
	'Reply with ONLY JSON: {"place": string, "summary": string, "objects": string[], "samePlaceAsPrevious": true|false|null, "seenBeforeSceneId": string|null, "confidence": number}. seenBeforeSceneId must be an id from KNOWN_SCENES, or null when this place was never recorded. No markdown. summary under 25 words.',
].join(" ");

const MAX_REPS_PER_SCENE = 5;
const MAX_CANDIDATE_SCENES = 5;
const REPS_PER_CANDIDATE = 2;
const CLEAR_MATCH_INLIERS = 15;
/** Above this, the current view is essentially a duplicate of a stored rep. */
const DUPLICATE_INLIERS = 60;

function mimeTypeFor(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".jpg": case ".jpeg": return "image/jpeg";
		case ".png": return "image/png";
		case ".webp": return "image/webp";
		default: return "image/jpeg";
	}
}

interface ParsedScene {
	label: string;
	summary: string;
	objects: string[];
	seenBeforeSceneId: string | null;
	samePlaceAsPrevious: boolean | null;
	confidence: number;
}

function parseScene(text: string, knownIds: Set<string>): ParsedScene {
	const jsonText = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
	const root = JSON.parse(jsonText) as Record<string, unknown>;
	const label = typeof root.place === "string" ? root.place : root.label;
	if (typeof label !== "string" || !label.trim()) throw new Error("scene place must be a non-empty string");
	if (typeof root.summary !== "string") throw new Error("scene.summary must be a string");
	const objects = Array.isArray(root.objects) ? root.objects.filter((value) => typeof value === "string").slice(0, 8).map((value) => (value as string).slice(0, 60)) : [];
	const rawMatched = typeof root.seenBeforeSceneId === "string" ? root.seenBeforeSceneId : root.matchedSceneId;
	const seenBeforeSceneId = typeof rawMatched === "string" && knownIds.has(rawMatched) ? rawMatched : null;
	const samePlaceAsPrevious = typeof root.samePlaceAsPrevious === "boolean"
		? root.samePlaceAsPrevious
		: typeof root.changed === "boolean" ? !root.changed : null;
	const confidence = typeof root.confidence === "number" && root.confidence >= 0 && root.confidence <= 1 ? root.confidence : 0.5;
	return { label: label.trim().slice(0, 120), summary: root.summary.trim().slice(0, 300), objects, seenBeforeSceneId, samePlaceAsPrevious, confidence };
}

/** Prefers the sharpest frame (quality.sharpness) so the stored view is usable. */
function bestFrame(ordered: FrameRef[]): FrameRef {
	let best = ordered[ordered.length - 1]!;
	let bestSharpness = -1;
	for (const frame of ordered) {
		const sharpness = typeof frame.quality?.sharpness === "number" ? frame.quality.sharpness : -1;
		if (sharpness > bestSharpness) { bestSharpness = sharpness; best = frame; }
	}
	return best;
}

export class SceneAgent {
	private readonly model: Model<"openai-completions">;
	private readonly streamFn: Agent["streamFunction"];
	private scenes = new Map<string, KnownScene>();
	private currentSceneId: string | null = null;
	private history: Array<{ sceneId: string; atMs: number; motion: string | null }> = [];
	private nextId = 1;
	private repCounter = 1;

	constructor(private readonly memoryDir: string | null = null) {
		const configured = createQwenModel(512);
		this.model = configured.model;
		this.streamFn = configured.streamFn;
	}

	getState(): { currentSceneId: string | null; scenes: KnownScene[]; history: Array<{ sceneId: string; atMs: number; motion: string | null }> } {
		return { currentSceneId: this.currentSceneId, scenes: [...this.scenes.values()], history: this.history.slice(-30) };
	}

	async observe(frames: FrameRef[], motionDescription: string | null): Promise<SceneResult> {
		if (frames.length === 0) throw new Error("SceneAgent needs at least one frame");
		const ordered = frames.slice().sort((a, b) => a.timestampMs - b.timestampMs).slice(-4);
		const imageContents: ImageContent[] = await Promise.all(ordered.map(async (frame) => ({
			type: "image" as const, data: (await readFile(frame.path)).toString("base64"), mimeType: mimeTypeFor(frame.path),
		})));

		// Image memory: run the local matcher (all current frames × stored reps).
		// Only a clear overlap causes the stored image to be attached to the prompt.
		const candidates = [...this.scenes.values()]
			.slice(-MAX_CANDIDATE_SCENES)
			.flatMap((scene) => scene.frames.slice(-REPS_PER_CANDIDATE).map((rep) => ({ id: scene.id, path: rep.path })));
		let match: { sceneId: string; inliers: number } | null = null;
		let matchedRepPath: string | null = null;
		const featureCounts = new Map<string, number>();
		if (this.memoryDir) {
			const response = await matchImages(ordered.map((frame) => frame.path), candidates, { minInliers: CLEAR_MATCH_INLIERS, maxDim: 900 });
			for (const query of response.queries) featureCounts.set(query.path, query.keypoints);
			if (response.ok && response.best) {
				match = { sceneId: response.best.id, inliers: response.best.inliers };
				matchedRepPath = response.best.path ?? null;
			}
		}
		const matchedScene = match ? this.scenes.get(match.sceneId) ?? null : null;

		const knownScenes = [...this.scenes.values()].slice(-15).map((scene) => ({ id: scene.id, label: scene.label, summary: scene.summary }));
		const previous = this.currentSceneId ? this.scenes.get(this.currentSceneId) : null;
		const promptLines = [
			"Identify the place the user is in now, and update the scene memory. Image blocks are in chronological order (the current frames), followed by at most one stored memory image when IMAGE_MATCH is present.",
			`PREVIOUS_SCENE: ${previous ? JSON.stringify({ id: previous.id, label: previous.label, summary: previous.summary }) : "none"}`,
			`KNOWN_SCENES: ${JSON.stringify(knownScenes)}`,
			`MOTION (approximate, how the phone moved since the previous observation): ${motionDescription ?? "none"}`,
		];
		if (matchedScene && matchedRepPath) {
			const repPath = matchedScene.frames.find((frame) => frame.path === matchedRepPath)?.path ?? matchedScene.frames.at(-1)?.path ?? matchedRepPath;
			try {
				const repData = (await readFile(repPath)).toString("base64");
				imageContents.push({ type: "image", data: repData, mimeType: mimeTypeFor(repPath) });
				promptLines.push(`IMAGE_MATCH: local-feature matching found about ${match!.inliers} matching points between the current view and the LAST image, which is a stored representative of scene ${matchedScene.id} ("${matchedScene.label}"). They most likely show the same place — confirm, or correct with a different known id.`);
			} catch { /* if the stored image is unreadable, fall back to text-only memory */ }
		}
		promptLines.push("Reply with only the JSON object.");
		const prompt = promptLines.join("\n\n");

		const agent = new Agent({ initialState: { systemPrompt: SYSTEM_PROMPT, model: this.model, tools: [] }, streamFn: this.streamFn });
		await agent.prompt(prompt, imageContents);
		if (agent.state.errorMessage) throw new Error(`SceneAgent request failed: ${agent.state.errorMessage}`);
		const assistant = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
		if (!assistant || assistant.role !== "assistant") throw new Error("SceneAgent returned no assistant message");
		const raw = assistant.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
		const knownIds = new Set(this.scenes.keys());
		const parsed = parseScene(raw, knownIds);

		const now = Date.now();
		const previousSceneId = this.currentSceneId;
		let sceneId: string;
		let isNew: boolean;
		if (parsed.samePlaceAsPrevious === true && previousSceneId && this.scenes.has(previousSceneId)) {
			sceneId = previousSceneId;
			isNew = false;
			const scene = this.scenes.get(sceneId)!;
			this.scenes.set(sceneId, { ...scene, summary: parsed.summary, objects: parsed.objects, visits: scene.visits + 1, lastSeenMs: now });
		} else if (parsed.seenBeforeSceneId) {
			sceneId = parsed.seenBeforeSceneId;
			isNew = false;
			const scene = this.scenes.get(sceneId)!;
			this.scenes.set(sceneId, { ...scene, summary: parsed.summary, objects: parsed.objects, visits: scene.visits + 1, lastSeenMs: now });
		} else {
			sceneId = `scene-${this.nextId++}`;
			isNew = true;
			this.scenes.set(sceneId, { id: sceneId, label: parsed.label, summary: parsed.summary, objects: parsed.objects, visits: 1, firstSeenMs: now, lastSeenMs: now, frameId: null, frames: [] });
		}
		const stored = this.scenes.get(sceneId)!;
		stored.frameId = this.richestFrame(ordered, featureCounts).id;
		await this.rememberFrames(sceneId, ordered, featureCounts, match);

		const sameAsPrevious = previousSceneId !== null && sceneId === previousSceneId;
		const changed = previousSceneId === null ? false : !sameAsPrevious;
		const revisited = !isNew && !sameAsPrevious;
		if (!sameAsPrevious) this.history.push({ sceneId, atMs: now, motion: motionDescription });
		this.currentSceneId = sceneId;
		return {
			sceneId, label: stored.label, summary: stored.summary, objects: stored.objects,
			isNew, sameAsPrevious, revisited, matchedSceneId: isNew ? null : sceneId,
			changed, confidence: parsed.confidence, match, frameIds: [stored.frameId ?? ordered[ordered.length - 1]!.id], raw,
		};
	}

	/** Picks the frame with the most local features (falls back to the sharpest). */
	private richestFrame(ordered: FrameRef[], featureCounts: Map<string, number>): FrameRef {
		if (featureCounts.size === 0) return bestFrame(ordered);
		let best = ordered[ordered.length - 1]!;
		let bestCount = -1;
		for (const frame of ordered) {
			const count = featureCounts.get(frame.path) ?? 0;
			if (count > bestCount) { bestCount = count; best = frame; }
		}
		return best;
	}

	/** Stores up to two representative views per observation (richest + latest) so a
	 * future frame can match this scene from more than one angle. */
	private async rememberFrames(sceneId: string, ordered: FrameRef[], featureCounts: Map<string, number>, match: { sceneId: string; inliers: number } | null): Promise<void> {
		if (!this.memoryDir) return;
		const scene = this.scenes.get(sceneId);
		if (!scene) return;
		// If the current view already matched this scene very strongly, it is a
		// near-duplicate of an existing representative; don't store it again.
		if (match && match.sceneId === sceneId && match.inliers >= DUPLICATE_INLIERS) return;
		const picks: FrameRef[] = [this.richestFrame(ordered, featureCounts), ordered[ordered.length - 1]!];
		for (const frame of picks) {
			if (scene.frames.length >= MAX_REPS_PER_SCENE) break;
			if (scene.frames.some((rep) => rep.path === frame.path)) continue;
			try {
				const directory = resolve(this.memoryDir, sceneId);
				await mkdir(directory, { recursive: true });
				const extension = extname(frame.path) || ".jpg";
				const path = resolve(directory, `rep-${this.repCounter++}${extension}`);
				await copyFile(frame.path, path);
				scene.frames.push({ id: `rep-${this.repCounter}`, path });
			} catch { /* memory is best-effort; never block the observation */ }
		}
	}
}
