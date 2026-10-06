import { readFile } from "node:fs/promises";
import { copyFile, mkdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import { createQwenModel } from "./qwen-provider.js";
import { matchImages } from "./image-match.js";
import { PlaceMemory, type PlaceNode } from "./place-memory.js";
import type { FrameRef } from "./types.js";

/**
 * SceneAgent (role 1 of 3): place recognition.
 *
 * Answers one question: "is this the place I have been to before?". It does NOT
 * output coordinates. Pipeline:
 *
 *   current frames
 *     → candidate places (graph neighbours first, then recent)
 *     → cheap CV: SIFT match against their representative frames (a score, not a rule)
 *     → VLM verifies the top candidate ("same place as this one?") or proposes a new place
 *     → update Place Memory (node labels, representatives, visit, transition edge)
 *
 * Position/motion is never an input coordinate: only the qualitative MOTION line.
 */

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
	/** Cheap-CV evidence: best candidate place and its match score (inliers). */
	match: { sceneId: string; inliers: number } | null;
	provisional: boolean;
	frameIds: string[];
	raw: string;
}

const SYSTEM_PROMPT = [
	"You perform PLACE RECOGNITION for a first-person assistant: decide which place the user is in now.",
	"You are shown the current camera frames (chronological), the PREVIOUS place, a short list of CANDIDATE places, how the phone moved (MOTION), and sometimes a MATCH hint from local-feature matching.",
	"Judge by the images and the candidates. Prefer reusing a candidate or the previous place when the view could be the same place from a different angle. Turning the camera in one place does NOT create a new place; passing a doorway or clearly relocating does.",
	"When a MATCH line is present, the LAST image is a stored representative of that candidate (not the current view); if it shows the same place, reuse that candidate.",
	"If nothing fits, propose a NEW place.",
	'Reply with ONLY JSON: {"place": string, "summary": string, "objects": string[], "samePlaceAsPrevious": true|false|null, "seenBeforeSceneId": string|null, "confidence": number}. seenBeforeSceneId must be an id from CANDIDATE_PLACES, or null for a new place. No markdown. summary under 25 words.',
].join(" ");

const MAX_CANDIDATES = 5;
const REPS_PER_CANDIDATE = 3;
const CLEAR_MATCH_INLIERS = 15;
const DUPLICATE_INLIERS = 60;
const NEW_PLACE_MIN_CONFIDENCE = 0.6;

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

function parseScene(text: string, candidateIds: Set<string>): ParsedScene {
	const jsonText = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
	const root = JSON.parse(jsonText) as Record<string, unknown>;
	const label = typeof root.place === "string" ? root.place : root.label;
	if (typeof label !== "string" || !label.trim()) throw new Error("scene place must be a non-empty string");
	if (typeof root.summary !== "string") throw new Error("scene.summary must be a string");
	const objects = Array.isArray(root.objects) ? root.objects.filter((value) => typeof value === "string").slice(0, 8).map((value) => (value as string).slice(0, 60)) : [];
	const rawMatched = typeof root.seenBeforeSceneId === "string" ? root.seenBeforeSceneId : root.matchedSceneId;
	const seenBeforeSceneId = typeof rawMatched === "string" && candidateIds.has(rawMatched) ? rawMatched : null;
	const samePlaceAsPrevious = typeof root.samePlaceAsPrevious === "boolean"
		? root.samePlaceAsPrevious
		: typeof root.changed === "boolean" ? !root.changed : null;
	const confidence = typeof root.confidence === "number" && root.confidence >= 0 && root.confidence <= 1 ? root.confidence : 0.5;
	return { label: label.trim().slice(0, 120), summary: root.summary.trim().slice(0, 300), objects, seenBeforeSceneId, samePlaceAsPrevious, confidence };
}

/** Picks the frame with the most local features (falls back to the sharpest). */
function richestFrame(ordered: FrameRef[], featureCounts: Map<string, number>): FrameRef {
	if (featureCounts.size === 0) {
		let best = ordered[ordered.length - 1]!;
		let bestSharpness = -1;
		for (const frame of ordered) {
			const sharpness = typeof frame.quality?.sharpness === "number" ? frame.quality.sharpness : -1;
			if (sharpness > bestSharpness) { bestSharpness = sharpness; best = frame; }
		}
		return best;
	}
	let best = ordered[ordered.length - 1]!;
	let bestCount = -1;
	for (const frame of ordered) {
		const count = featureCounts.get(frame.path) ?? 0;
		if (count > bestCount) { bestCount = count; best = frame; }
	}
	return best;
}

export class SceneAgent {
	private readonly model: Model<"openai-completions">;
	private readonly streamFn: Agent["streamFunction"];
	private readonly memory: PlaceMemory;
	private loaded = false;
	private repCounter = 1;

	constructor(private readonly memoryDir: string | null = null, storePath: string | null = null) {
		const configured = createQwenModel(512);
		this.model = configured.model;
		this.streamFn = configured.streamFn;
		this.memory = new PlaceMemory(storePath);
	}

	async load(): Promise<void> {
		if (this.loaded) return;
		await this.memory.load();
		this.loaded = true;
	}

	getState() { return this.memory.getState(); }

	async observe(frames: FrameRef[], motionDescription: string | null): Promise<SceneResult> {
		await this.load();
		if (frames.length === 0) throw new Error("SceneAgent needs at least one frame");
		const ordered = frames.slice().sort((a, b) => a.timestampMs - b.timestampMs).slice(-4);
		const imageContents: ImageContent[] = await Promise.all(ordered.map(async (frame) => ({
			type: "image" as const, data: (await readFile(frame.path)).toString("base64"), mimeType: mimeTypeFor(frame.path),
		})));

		// Candidate narrowing: graph neighbours first, then recent places.
		const previousSceneId = this.memory.getState().currentSceneId;
		const candidateScenes: PlaceNode[] = this.memory.candidates(previousSceneId, MAX_CANDIDATES);
		const candidates = candidateScenes.flatMap((scene) => scene.frames.slice(-REPS_PER_CANDIDATE).map((rep) => ({ id: scene.id, path: rep.path })));

		let match: { sceneId: string; inliers: number } | null = null;
		let matchedRepPath: string | null = null;
		const featureCounts = new Map<string, number>();
		if (this.memoryDir && candidates.length) {
			const response = await matchImages(ordered.map((frame) => frame.path), candidates, { minInliers: CLEAR_MATCH_INLIERS, maxDim: 900 });
			for (const query of response.queries) featureCounts.set(query.path, query.keypoints);
			if (response.ok && response.best) { match = { sceneId: response.best.id, inliers: response.best.inliers }; matchedRepPath = response.best.path ?? null; }
		} else if (this.memoryDir) {
			const response = await matchImages(ordered.map((frame) => frame.path), [], { maxDim: 900 });
			for (const query of response.queries) featureCounts.set(query.path, query.keypoints);
		}
		const matchedScene = match ? candidateScenes.find((scene) => scene.id === match!.sceneId) ?? null : null;

		const previous = previousSceneId ? this.memory.getScene(previousSceneId) : null;
		const candidateList = candidateScenes.map((scene) => ({ id: scene.id, label: scene.label, summary: scene.summary }));
		const promptLines = [
			"Identify the place the user is in now. Image blocks are in chronological order (the current frames), followed by at most one stored candidate image when MATCH is present.",
			`PREVIOUS_PLACE: ${previous ? JSON.stringify({ id: previous.id, label: previous.label, summary: previous.summary }) : "none"}`,
			`CANDIDATE_PLACES: ${JSON.stringify(candidateList)}`,
			`MOTION (approximate, how the phone moved since the previous observation): ${motionDescription ?? "none"}`,
		];
		if (matchedScene && matchedRepPath) {
			const repPath = matchedScene.frames.find((frame) => frame.path === matchedRepPath)?.path ?? matchedScene.frames.at(-1)?.path ?? matchedRepPath;
			try {
				imageContents.push({ type: "image", data: (await readFile(repPath)).toString("base64"), mimeType: mimeTypeFor(repPath) });
				promptLines.push(`MATCH: local-feature matching found about ${match!.inliers} matching points between the current view and the LAST image, a stored representative of candidate ${matchedScene.id} ("${matchedScene.label}"). They likely show the same place — confirm, or correct with another candidate.`);
			} catch { /* fall back to text-only */ }
		}
		promptLines.push("Reply with only the JSON object.");
		const prompt = promptLines.join("\n\n");

		const agent = new Agent({ initialState: { systemPrompt: SYSTEM_PROMPT, model: this.model, tools: [] }, streamFn: this.streamFn });
		await agent.prompt(prompt, imageContents);
		if (agent.state.errorMessage) throw new Error(`SceneAgent request failed: ${agent.state.errorMessage}`);
		const assistant = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
		if (!assistant || assistant.role !== "assistant") throw new Error("SceneAgent returned no assistant message");
		const raw = assistant.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
		const candidateIds = new Set(candidateScenes.map((scene) => scene.id));
		const parsed = parseScene(raw, candidateIds);

		const now = Date.now();
		let sceneId: string;
		let isNew: boolean;
		if (parsed.samePlaceAsPrevious === true && previousSceneId && this.memory.getScene(previousSceneId)) {
			sceneId = previousSceneId; isNew = false;
		} else if (parsed.seenBeforeSceneId) {
			sceneId = parsed.seenBeforeSceneId; isNew = false;
		} else {
			sceneId = ""; isNew = true; // id assigned by ensureScene
		}
		const provisional = isNew && parsed.confidence < NEW_PLACE_MIN_CONFIDENCE;
		const stored = this.memory.ensureScene(isNew ? null : sceneId, parsed.label, parsed.summary, parsed.objects, now, provisional);
		sceneId = stored.id;

		const representative = richestFrame(ordered, featureCounts);
		await this.rememberFrames(sceneId, ordered, featureCounts, match);
		await this.memory.onSceneResolved(sceneId, representative.id, motionDescription, now);

		const sameAsPrevious = previousSceneId !== null && sceneId === previousSceneId;
		const changed = previousSceneId === null ? false : !sameAsPrevious;
		const revisited = !isNew && !sameAsPrevious;
		return {
			sceneId, label: stored.label, summary: stored.summary, objects: stored.objects,
			isNew, sameAsPrevious, revisited, matchedSceneId: isNew ? null : sceneId,
			changed, confidence: parsed.confidence, match, provisional, frameIds: [representative.id], raw,
		};
	}

	private async rememberFrames(sceneId: string, ordered: FrameRef[], featureCounts: Map<string, number>, match: { sceneId: string; inliers: number } | null): Promise<void> {
		if (!this.memoryDir) return;
		if (match && match.sceneId === sceneId && match.inliers >= DUPLICATE_INLIERS) return;
		const scene = this.memory.getScene(sceneId);
		if (scene && scene.frames.length >= 5) return;
		const picks = [richestFrame(ordered, featureCounts), ordered[ordered.length - 1]!];
		for (const frame of picks) {
			try {
				const directory = resolve(this.memoryDir, sceneId);
				await mkdir(directory, { recursive: true });
				const path = resolve(directory, `rep-${this.repCounter++}${extname(frame.path) || ".jpg"}`);
				await copyFile(frame.path, path);
				this.memory.addRepresentative(sceneId, { id: `rep-${this.repCounter}`, path });
			} catch { /* best effort */ }
		}
	}
}
