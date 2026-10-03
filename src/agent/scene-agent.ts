import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import { createQwenModel } from "./qwen-provider.js";
import type { FrameRef } from "./types.js";

/**
 * SceneAgent (role 1 of 3): updates the *scene memory*.
 *
 * It is given the current frames, the motion-mode summary (how the phone has
 * moved), the previous scene, and the list of scenes already recorded. The model
 * decides (a) which place the user is in now, (b) whether it is the same place as
 * the previous observation, and (c) whether it matches a scene seen before.
 *
 * The model owns the *judgement*; this module owns memory *consistency*: when a
 * place is matched to a known scene it keeps that scene's canonical label (so a
 * new area cannot silently rename an old scene), and it derives "changed" from
 * the scene identity transition, so `changed` and `matchedSceneId` can never
 * contradict each other.
 *
 * Position is not stored as a named variable: the motion summary is an input,
 * and the memory is a set of scenes (with visit counts) plus the order visited.
 */

export interface KnownScene {
	id: string;
	label: string;
	summary: string;
	objects: string[];
	visits: number;
	firstSeenMs: number;
	lastSeenMs: number;
	frameId: string | null;
}

export interface SceneResult {
	sceneId: string;
	label: string;
	summary: string;
	objects: string[];
	/** True when this scene was not in memory before. */
	isNew: boolean;
	/** True when the observed place is the previously current scene. */
	sameAsPrevious: boolean;
	/** True when the place matched an existing scene that is not the previous one. */
	revisited: boolean;
	/** The scene the place was resolved to, or null when a new scene was created. */
	matchedSceneId: string | null;
	/** Whether the place changed vs the previous observation. Derived from scene identity. */
	changed: boolean;
	confidence: number;
	frameIds: string[];
	raw: string;
}

const SYSTEM_PROMPT = [
	"You maintain a memory of PLACES (scenes) for a first-person assistant.",
	"You are shown the current camera frames (in chronological order), how the phone moved (MOTION), PREVIOUS_SCENE, and KNOWN_SCENES recorded earlier.",
	"Decide the single place the user is in now. A place is a location such as 'desk area' or 'kitchen'.",
	"Turning the camera, looking around, or shifting a little inside the same place does NOT create a new place. Passing a doorway, or clearly relocating, does.",
	"Prefer reusing an existing label: if the current place is the PREVIOUS_SCENE or one of KNOWN_SCENES, reuse that scene's label and id.",
	"If different frames during the motion show different areas, judge by the place the user ends in.",
	'Reply with ONLY JSON: {"place": string, "summary": string, "objects": string[], "samePlaceAsPrevious": true|false|null, "seenBeforeSceneId": string|null, "confidence": number}. seenBeforeSceneId must be an id from KNOWN_SCENES, or null when this place was never recorded. No markdown. summary under 25 words.',
].join(" ");

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
	// Accept either the explicit field or the legacy `changed` flag (samePlace = !changed).
	const samePlaceAsPrevious = typeof root.samePlaceAsPrevious === "boolean"
		? root.samePlaceAsPrevious
		: typeof root.changed === "boolean" ? !root.changed : null;
	const confidence = typeof root.confidence === "number" && root.confidence >= 0 && root.confidence <= 1 ? root.confidence : 0.5;
	return { label: label.trim().slice(0, 120), summary: root.summary.trim().slice(0, 300), objects, seenBeforeSceneId, samePlaceAsPrevious, confidence };
}

export class SceneAgent {
	private readonly model: Model<"openai-completions">;
	private readonly streamFn: Agent["streamFunction"];
	private scenes = new Map<string, KnownScene>();
	private currentSceneId: string | null = null;
	private history: Array<{ sceneId: string; atMs: number; motion: string | null }> = [];
	private nextId = 1;

	constructor() {
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
			type: "image", data: (await readFile(frame.path)).toString("base64"), mimeType: mimeTypeFor(frame.path),
		})));
		const knownScenes = [...this.scenes.values()].slice(-15).map((scene) => ({ id: scene.id, label: scene.label, summary: scene.summary }));
		const previous = this.currentSceneId ? this.scenes.get(this.currentSceneId) : null;
		const prompt = [
			"Identify the place the user is in now, and update the scene memory. Image blocks are in chronological order.",
			`PREVIOUS_SCENE: ${previous ? JSON.stringify({ id: previous.id, label: previous.label, summary: previous.summary }) : "none"}`,
			`KNOWN_SCENES: ${JSON.stringify(knownScenes)}`,
			`MOTION (approximate, how the phone moved since the previous observation): ${motionDescription ?? "none"}`,
			"Reply with only the JSON object.",
		].join("\n\n");
		const agent = new Agent({ initialState: { systemPrompt: SYSTEM_PROMPT, model: this.model, tools: [] }, streamFn: this.streamFn });
		await agent.prompt(prompt, imageContents);
		if (agent.state.errorMessage) throw new Error(`SceneAgent request failed: ${agent.state.errorMessage}`);
		const assistant = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
		if (!assistant || assistant.role !== "assistant") throw new Error("SceneAgent returned no assistant message");
		const raw = assistant.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
		const knownIds = new Set(this.scenes.keys());
		const parsed = parseScene(raw, knownIds);

		const now = Date.now();
		const frameId = ordered[ordered.length - 1]!.id;
		const previousSceneId = this.currentSceneId;

		// Resolve the place to a scene id. Prefer the model's explicit identity:
		// same-as-previous, then a known scene, else a brand new scene.
		let sceneId: string;
		let isNew: boolean;
		if (parsed.samePlaceAsPrevious === true && previousSceneId && this.scenes.has(previousSceneId)) {
			sceneId = previousSceneId;
			isNew = false;
			const scene = this.scenes.get(sceneId)!;
			this.scenes.set(sceneId, { ...scene, summary: parsed.summary, objects: parsed.objects, visits: scene.visits + 1, lastSeenMs: now, frameId });
		} else if (parsed.seenBeforeSceneId) {
			sceneId = parsed.seenBeforeSceneId;
			isNew = false;
			const scene = this.scenes.get(sceneId)!;
			this.scenes.set(sceneId, { ...scene, summary: parsed.summary, objects: parsed.objects, visits: scene.visits + 1, lastSeenMs: now, frameId });
		} else {
			sceneId = `scene-${this.nextId++}`;
			isNew = true;
			this.scenes.set(sceneId, { id: sceneId, label: parsed.label, summary: parsed.summary, objects: parsed.objects, visits: 1, firstSeenMs: now, lastSeenMs: now, frameId });
		}
		// Canonical stored values (matched scenes keep their original label).
		const stored = this.scenes.get(sceneId)!;
		const sameAsPrevious = previousSceneId !== null && sceneId === previousSceneId;
		const changed = previousSceneId === null ? false : !sameAsPrevious;
		const revisited = !isNew && !sameAsPrevious;
		if (!sameAsPrevious) this.history.push({ sceneId, atMs: now, motion: motionDescription });
		this.currentSceneId = sceneId;
		return {
			sceneId, label: stored.label, summary: stored.summary, objects: stored.objects,
			isNew, sameAsPrevious, revisited, matchedSceneId: isNew ? null : sceneId,
			changed, confidence: parsed.confidence, frameIds: [frameId], raw,
		};
	}
}
