import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import { decideSpeech } from "./attention-policy.js";
import { selectFrames } from "./frame-gate.js";
import { SYSTEM_PROMPT, PROMPT_VERSION } from "./prompts.js";
import { createQwenModel } from "./qwen-provider.js";
import type { RealtimeMotionReport } from "../realtime-motion.js";
import { applyObservation, createWorkingState, endTask, recordPresentedFacts, recordSpeech, startWatch, stopWatch, updateTaskPhase, updateWatch } from "./working-memory.js";
import type {
	AnalysisMode, AttentionMode, FrameRef, InferenceBudget, MotionTimelineSegment, ObservationDelta,
	ObservationItem, ObserveResult, WorkingState,
} from "./types.js";

export { PROMPT_VERSION };
export const MONITOR_MAX_OUTPUT_TOKENS = 768;
export const DEEP_MAX_OUTPUT_TOKENS = 2048;
export const DEEP_THINKING_BUDGET = 1024;
export const MIN_ANSWER_CONFIDENCE = 0.65;

export function outputTokensForMode(mode: AnalysisMode): number {
	return mode === "monitor" ? MONITOR_MAX_OUTPUT_TOKENS : DEEP_MAX_OUTPUT_TOKENS;
}

export function thinkingEnabledForModel(modelId: string, mode: AnalysisMode): boolean | null {
	if (/^qwen3-vl-(?:plus|flash)(?:-|$)/i.test(modelId)) return mode === "deep";
	return null;
}

interface StoredVisualKeyframe {
	id: string;
	timestampMs: number;
	mimeType: string;
	data: string;
	summary: string;
}

function visualTokens(text: string): Set<string> {
	const tokens = new Set((text.toLocaleLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((word) => !["where", "just", "did", "see", "the", "my", "before", "earlier", "previously"].includes(word)));
	const runs = text.toLocaleLowerCase().match(/[\u3400-\u9fff]+/g) ?? [];
	for (const run of runs) {
		if (run.length === 2) tokens.add(run);
		for (let index = 0; index < run.length - 1; index++) tokens.add(run.slice(index, index + 2));
	}
	return tokens;
}

export function answerConfidenceThreshold(): number {
	const configured = process.env.VLM_ANSWER_CONFIDENCE_THRESHOLD;
	if (!configured) return MIN_ANSWER_CONFIDENCE;
	const value = Number(configured);
	if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("VLM_ANSWER_CONFIDENCE_THRESHOLD must be between 0 and 1");
	return value;
}

function mimeTypeFor(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".jpg": case ".jpeg": return "image/jpeg";
		case ".png": return "image/png";
		case ".webp": return "image/webp";
		case ".gif": return "image/gif";
		default: throw new Error(`Unsupported image type: ${path}`);
	}
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`VLM response field '${label}' must be an object`);
	return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
	if (typeof value !== "string") throw new Error(`VLM response field '${label}' must be a string`);
	return value;
}

function asFrameIds(value: unknown, allowed: Set<string>): string[] {
	if (!Array.isArray(value) || !value.every((id) => typeof id === "string")) throw new Error("observation.frameIds must be a string array");
	return [...new Set(value.filter((id) => allowed.has(id)))];
}

/** Parse model perception into facts. The model no longer emits a speak/silence decision. */
function parseObservation(text: string, frames: FrameRef[]): ObservationDelta {
	const jsonText = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
	const root = asRecord(JSON.parse(jsonText) as unknown, "root");
	const changed = root.changed === null ? null : root.changed;
	if (changed !== null && typeof changed !== "boolean") throw new Error("changed must be boolean or null");

	const allowed = new Set(frames.map((frame) => frame.id));
	const rawObservations = Array.isArray(root.observations)
		? root.observations
		: root.observation === null || root.observation === undefined ? [] : [root.observation];
	if (rawObservations.length > 12) throw new Error("VLM returned more than 12 observations");
	const byId = new Map(frames.map((frame) => [frame.id, frame]));
	const observations: ObservationItem[] = [];
	for (const value of rawObservations) {
		const row = asRecord(value, "observation");
		const rawKind = asString(row.kind, "observation.kind");
		const kindAliases: Record<string, ObservationItem["kind"]> = {
			motion: "activity",
			movement: "activity",
			sensor: "activity",
			transition: "change",
			environment: "scene",
		};
		const kind = kindAliases[rawKind] ?? rawKind;
		if (!["scene", "object", "text", "person", "change", "activity", "uncertainty"].includes(kind)) throw new Error(`Invalid observation kind: ${rawKind}`);
		if (typeof row.confidence !== "number" || row.confidence < 0 || row.confidence > 1) throw new Error("confidence must be between 0 and 1");
		const frameIds = asFrameIds(row.frameIds, allowed);
		if (frameIds.length > 0) {
			const observedAtMs = Math.max(...frameIds.map((id) => byId.get(id)?.timestampMs ?? 0));
			const onlyHistoricalFrames = frameIds.every((id) => byId.get(id)?.source === "visual_memory");
			observations.push({
				kind: kind as ObservationItem["kind"],
				content: asString(row.content, "observation.content"),
				location: row.location === null ? null : asString(row.location, "observation.location"),
				status: kind === "change" || kind === "activity" ? "new" : kind === "uncertainty" || onlyHistoricalFrames ? "uncertain" : "present",
				goalRelevant: row.goalRelevant === true,
				confidence: row.confidence,
				frameIds,
				observedAtMs,
			});
		}
	}
	let scene: ObservationDelta["stateUpdate"]["scene"] = null;
	if (root.scene !== null && root.scene !== undefined) {
		const row = asRecord(root.scene, "scene");
		const value = asString(row.value, "scene.value");
		const sceneChanged = row.changed === null ? null : row.changed;
		if (sceneChanged !== null && typeof sceneChanged !== "boolean") throw new Error("scene.changed must be boolean or null");
		if (typeof row.changeConfidence !== "number" || row.changeConfidence < 0 || row.changeConfidence > 1) throw new Error("scene.changeConfidence must be between 0 and 1");
		if (typeof row.confidence !== "number" || row.confidence < 0 || row.confidence > 1) throw new Error("scene.confidence must be between 0 and 1");
		const frameIds = asFrameIds(row.frameIds, allowed);
		scene = { value, changed: sceneChanged, changeConfidence: row.changeConfidence, confidence: row.confidence, goalRelevant: row.goalRelevant === true, frameIds };
	} else {
		const sceneFact = [...observations].reverse().find((item) => item.kind === "scene");
		if (sceneFact) scene = { value: sceneFact.content, changed: null, changeConfidence: 0, confidence: sceneFact.confidence, goalRelevant: sceneFact.goalRelevant, frameIds: sceneFact.frameIds };
	}
	if (scene && scene.frameIds.length > 0 && !observations.some((item) => item.kind === "scene" && item.content === scene!.value
		&& item.confidence === scene!.confidence && item.goalRelevant === scene!.goalRelevant
		&& item.frameIds.some((id) => scene!.frameIds.includes(id)))) {
		const observedAtMs = Math.max(...scene.frameIds.map((id) => byId.get(id)?.timestampMs ?? 0));
		observations.push({ kind: "scene", content: scene.value, location: null, status: scene.frameIds.every((id) => byId.get(id)?.source === "visual_memory") ? "uncertain" : "present", goalRelevant: scene.goalRelevant, confidence: scene.confidence, frameIds: scene.frameIds, observedAtMs });
	}
	const events = observations.filter((item) => item.kind === "change").map((item) => ({ description: item.content, frameIds: item.frameIds }));
	const entities = observations.filter((item) => ["object", "person", "text"].includes(item.kind))
		.map((item) => ({ name: item.content, location: item.location, frameIds: item.frameIds }));
	return {
		changed,
		conditionMatch: root.conditionMatch === null || root.conditionMatch === undefined ? null : (() => {
			if (!["not_met", "suspected", "confirmed"].includes(String(root.conditionMatch))) throw new Error("conditionMatch must be not_met, suspected, confirmed, or null");
			return root.conditionMatch as ObservationDelta["conditionMatch"];
		})(),
		observations,
		stateUpdate: { scene, events, entities },
		response: root.response === null ? null : asString(root.response, "response"),
	};
}

function defaultAttentionMode(mode: AnalysisMode, goal: string | null): AttentionMode {
	if (goal?.trim()) return "task";
	return mode === "deep" ? "explore" : "awareness";
}

export class VlmAgent {
	private readonly model: Model<"openai-completions">;
	private readonly streamFn: Agent["streamFunction"];
	private readonly state: WorkingState;
	private visualKeyframes: StoredVisualKeyframe[] = [];

	constructor(goal: string | null = null, initialState?: Partial<WorkingState>) {
		const configured = createQwenModel(DEEP_MAX_OUTPUT_TOKENS);
		this.model = configured.model;
		this.streamFn = configured.streamFn;
		this.state = createWorkingState(goal, initialState);
	}

	getWorkingState(): WorkingState { return structuredClone(this.state); }

	private relevantVisualKeyframe(goal: string | null): StoredVisualKeyframe | null {
		if (!goal || this.visualKeyframes.length === 0) return null;
		const goalTokens = visualTokens(goal);
		let best: StoredVisualKeyframe | null = null;
		let bestScore = 0;
		for (const frame of this.visualKeyframes) {
			const summaryTokens = visualTokens(frame.summary);
			const overlap = [...goalTokens].filter((token) => summaryTokens.has(token)).length;
			const score = overlap * 1_000_000 + frame.timestampMs;
			if (overlap > 0 && score > bestScore) { best = frame; bestScore = score; }
		}
		if (best) return best;
		if (/(?:之前|刚才|刚刚|刚才看到|earlier|previously|where did i .*see)/i.test(goal)) return this.visualKeyframes.at(-1)!;
		return null;
	}

	private rememberVisualEvidence(delta: ObservationDelta, frames: FrameRef[], imageContents: ImageContent[]): void {
	const contentById = new Map(frames.map((frame, index) => [frame.id, imageContents[index]!]));
	const descriptionsById = new Map<string, string[]>();
	for (const fact of delta.observations) {
		if (!(fact.kind === "object" || fact.kind === "text") || fact.confidence < answerConfidenceThreshold()) continue;
		for (const id of fact.frameIds) descriptionsById.set(id, [...(descriptionsById.get(id) ?? []), fact.content]);
	}
	for (const [id, descriptions] of descriptionsById) {
		const frame = frames.find((item) => item.id === id);
		const content = contentById.get(id);
		if (!frame || !content || content.data.length > 450_000) continue;
		const summary = [...new Set(descriptions)].join("；");
		const same = this.visualKeyframes.findIndex((item) => item.summary === summary);
		if (same >= 0) this.visualKeyframes.splice(same, 1);
		this.visualKeyframes.push({ id, timestampMs: frame.timestampMs, mimeType: content.mimeType, data: content.data, summary });
	}
	this.visualKeyframes.sort((a, b) => a.timestampMs - b.timestampMs);
	while (this.visualKeyframes.length > 4 || this.visualKeyframes.reduce((sum, frame) => sum + frame.data.length, 0) > 1_000_000) this.visualKeyframes.shift();
	}

	endTask(): WorkingState {
		endTask(this.state);
		return this.getWorkingState();
	}

	startWatch(condition: string): WorkingState {
		if (this.state.activeTask.status === "active") throw new Error("Finish the active task before starting a watch condition");
		startWatch(this.state, condition);
		return this.getWorkingState();
	}

	stopWatch(): WorkingState {
		stopWatch(this.state);
		return this.getWorkingState();
	}

	async observe(frames: FrameRef[], options: {
		/** Legacy inference-budget selector. */
		mode?: AnalysisMode;
		inferenceBudget?: InferenceBudget;
		attentionMode?: AttentionMode;
		goal?: string | null;
		userInitiated?: boolean;
		motionTimeline?: MotionTimelineSegment[];
		motionReport?: RealtimeMotionReport;
		motionDescription?: string;
		maxOutputTokens?: number;
	} = {}): Promise<ObserveResult> {
		if (frames.length === 0) throw new Error("At least one frame is required");
		if (frames.length > 12) throw new Error("Pass at most 12 recent frames per observation");

		const requestedGoal = options.goal === undefined
			? (this.state.activeTask.status === "active" ? this.state.activeTask.goal : this.state.goal)
			: options.goal;
		const legacyMode = options.mode ?? (requestedGoal?.trim() ? "deep" : "monitor");
		const inferenceBudget = options.inferenceBudget ?? (legacyMode === "deep" ? "deep" : "economy");
		const mode: AnalysisMode = inferenceBudget === "deep" ? "deep" : "monitor";
		const activeGoal = requestedGoal?.trim() || null;
		const attentionMode = options.attentionMode ?? defaultAttentionMode(mode, activeGoal);
		const userInitiated = options.userInitiated ?? (mode === "deep");

		if (activeGoal) {
			const isNewTask = this.state.activeTask.status !== "active" || this.state.activeTask.goal !== activeGoal;
			const now = new Date().toISOString();
			this.state.activeTask = { status: "active", phase: isNewTask ? "searching" : this.state.activeTask.phase, goal: activeGoal, startedAt: isNewTask ? now : this.state.activeTask.startedAt, updatedAt: now };
			if (this.state.activeWatch.status !== "idle") stopWatch(this.state);
		}
		this.state.goal = activeGoal;
		const watchCondition = attentionMode === "awareness" ? this.state.activeWatch.condition : null;

		const startedAt = performance.now();
		const gated = selectFrames(frames, attentionMode, options.motionReport);
		const ordered = gated.frames;
		const currentImageContents: ImageContent[] = await Promise.all(ordered.map(async (frame) => ({
			type: "image", data: (await readFile(frame.path)).toString("base64"), mimeType: mimeTypeFor(frame.path),
		})));
		const visualMemory = attentionMode === "task" ? this.relevantVisualKeyframe(activeGoal) : null;
		const inputItems = ordered.map((frame, index) => ({ frame, content: currentImageContents[index]!, origin: "input" }));
		const memoryFrame: FrameRef | null = visualMemory ? { id: `memory-${visualMemory.id}`, timestampMs: visualMemory.timestampMs, path: "visual-memory", source: "visual_memory" } : null;
		const memoryItems = visualMemory && memoryFrame ? [{
			frame: memoryFrame,
			content: { type: "image" as const, data: visualMemory.data, mimeType: visualMemory.mimeType },
			origin: "visual_memory",
		}] : [];
		const modelItems = [...memoryItems, ...inputItems].sort((a, b) => a.frame.timestampMs - b.frame.timestampMs);
		const modelFrames = modelItems.map((item) => item.frame);
		const imageContents = modelItems.map((item) => item.content);
		const inputWindowMs = Math.max(0, ordered[ordered.length - 1]!.timestampMs - ordered[0]!.timestampMs);
		const firstFrameMs = modelFrames[0]!.timestampMs;
		const listedFrames = modelItems.map(({ frame, origin }) => ({ id: frame.id, timestampMs: frame.timestampMs, secondsFromStart: Number(((frame.timestampMs - firstFrameMs) / 1000).toFixed(2)), origin }));
		const thinkingEnabled = thinkingEnabledForModel(this.model.id, mode);
		const requestModel: Model<"openai-completions"> = {
			...this.model,
			maxTokens: options.maxOutputTokens ?? outputTokensForMode(mode),
			...(thinkingEnabled === null ? {} : { samplingParams: mode === "deep" ? { enable_thinking: true, thinking_budget: DEEP_THINKING_BUDGET } : { enable_thinking: false } }),
		};
		const workingState = {
			activeTask: this.state.activeTask,
			scene: this.state.scene,
			recentEvents: this.state.recentEvents.slice(-5),
			recentSpeech: this.state.recentSpeech.slice(-5),
			userKnownFacts: this.state.userKnownFacts.slice(-12),
			visualMemory: visualMemory ? [{ id: `memory-${visualMemory.id}`, timestampMs: visualMemory.timestampMs, summary: visualMemory.summary }] : [],
			entities: Object.fromEntries(Object.entries(this.state.entities).slice(-20)),
		};
		const prompt = [
			"Interpret the supplied frames in chronological order. Image blocks follow the same order as frameIds.",
			`USER_REQUEST: ${activeGoal ?? "none"}`,
			`WATCH_CONDITION: ${watchCondition ?? "none"}`,
			`WORKING_STATE: ${JSON.stringify(workingState)}`,
			...(options.motionDescription
				? [`MOTION (approximate, from the phone's sensors and camera): ${options.motionDescription}`, "Use this only to help interpret scene changes. It is an approximate relative-motion estimate, not an absolute position; direction is relative to the phone (not necessarily the user's body). A camera-view change alone does not prove the user turned or that the scene changed; do not quote the numbers as exact."]
				: options.motionReport
				? [`MOTION: ${JSON.stringify(options.motionReport)}`, "MOTION is an approximate 10-second sensor summary of how the phone moved: a chronological list of events (each a short travel span with coarse direction/speed, or a turn with net degrees and whether it was in place), plus the latest action/turn and heading-change state. It is a hint for interpreting scene changes, not ground truth and not an absolute position. The selected frames are one representative frame per event. A camera-view change alone does not prove the user turned or that the scene changed; do not quote the numbers as exact."]
				: options.motionTimeline?.length
					? [`MOTION_TIMELINE: ${JSON.stringify(options.motionTimeline)}`, "The timeline is a set of approximate sensor-derived intervals, not ground truth. Return one time-linked activity or uncertainty observation for each listed interval, including short or ambiguous intervals; do not merge separate intervals. Use kind=activity for the estimated invariant pattern and kind=uncertainty when the pattern or its interpretation is inconclusive. Describe visual evidence separately from sensor estimates; treat physical direction and displacement as unknown unless independently supported. A camera-view change alone does not prove the user's physical direction or a scene change."]
					: [`MOTION_INVARIANTS: ${JSON.stringify(gated.result.movementSummary)}`]),
			`FRAME_IDS: ${JSON.stringify(listedFrames)}`,
			"Return the observation and optional candidate wording as JSON. The application applies its own attention policy.",
			"Reply with only that JSON object, no markdown, no extra prose. Keep each observation under ~20 words and do not repeat the same item twice. Prefer omitting low-value details over writing a long answer.",
		].join("\n\n");
		const agent = new Agent({ initialState: { systemPrompt: SYSTEM_PROMPT, model: requestModel, tools: [] }, streamFn: this.streamFn });
		await agent.prompt(prompt, imageContents);
		if (agent.state.errorMessage) throw new Error(`Pi agent request failed: ${agent.state.errorMessage}`);
		const assistant = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
		if (!assistant || assistant.role !== "assistant") throw new Error("Pi agent returned no assistant message");
		const rawResponse = assistant.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
		let delta: ObservationDelta;
		try {
			delta = parseObservation(rawResponse, modelFrames);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const outputTokens = assistant.usage.output;
			throw new Error(`VLM response parsing failed (stopReason=${assistant.stopReason}, outputTokens=${outputTokens}, textChars=${rawResponse.length}): ${message}`);
		}
		this.rememberVisualEvidence(delta, ordered, currentImageContents);
		const timestampMs = Date.now();
		const historicalQuery = Boolean(activeGoal && /(?:之前|刚才|刚刚|刚才看到|earlier|previously|where did i .*see)/i.test(activeGoal));
		const final = decideSpeech({
			attentionMode, userInitiated, goal: activeGoal, watchCondition, watchStatus: delta.conditionMatch,
			watchAlreadyConfirmed: this.state.activeWatch.status === "confirmed",
			historicalQuery,
			changed: delta.changed, latestFrameMs: ordered[ordered.length - 1]!.timestampMs,
			observations: delta.observations, candidateResponse: delta.response,
			threshold: answerConfidenceThreshold(), recentSpeech: this.state.recentSpeech, knownFacts: this.state.userKnownFacts, now: timestampMs,
		});
		applyObservation(this.state, delta, modelFrames, answerConfidenceThreshold());
		if (attentionMode === "awareness") {
			const acceptedMatch = delta.conditionMatch === "confirmed" && final.decision !== "answer" && this.state.activeWatch.status !== "confirmed"
				? "suspected" : delta.conditionMatch;
			updateWatch(this.state, acceptedMatch, ordered[ordered.length - 1]!.timestampMs);
		}
		if (this.state.activeTask.status === "active") {
			const goalFact = delta.observations.filter((item) => item.goalRelevant && item.confidence >= answerConfidenceThreshold())
				.sort((a, b) => b.observedAtMs - a.observedAtMs)[0];
			if (goalFact && historicalQuery && goalFact.frameIds.every((id) => id.startsWith("memory-"))) updateTaskPhase(this.state, "historical_match");
			else if (!goalFact) {
				const wasLocated = ["confirmed", "guiding", "reacquired"].includes(this.state.activeTask.phase);
				updateTaskPhase(this.state, userInitiated ? "need_better_view" : wasLocated && delta.changed === true ? "lost" : "searching");
			} else if (this.state.activeTask.phase === "lost") updateTaskPhase(this.state, "reacquired");
			else updateTaskPhase(this.state, goalFact.confidence >= 0.8 ? "confirmed" : "possible_target");
		}
		if (final.response && final.decision !== "silent") {
			recordSpeech(this.state, final.response, timestampMs, delta.observations.flatMap((fact) => fact.frameIds), attentionMode);
			if (final.decision === "answer") {
				const presented = delta.observations.filter((fact) => fact.confidence >= answerConfidenceThreshold() && fact.frameIds.length > 0 && (!activeGoal && !watchCondition || fact.goalRelevant))
					.sort((a, b) => b.observedAtMs - a.observedAtMs).slice(0, 1);
				recordPresentedFacts(this.state, presented, timestampMs);
			}
		}
		if (this.state.activeTask.status === "active") this.state.activeTask.updatedAt = new Date().toISOString();
		const policyAction = final.decision === "silent" ? "SILENCE" : final.decision === "clarify" ? "CLARIFY" : userInitiated ? "ANSWER" : "SPEAK";
		return {
			mode, inferenceBudget, attentionMode, userInitiated, frameGate: gated.result, visualMemoryFrameIds: visualMemory ? [`memory-${visualMemory.id}`] : [],
			changed: delta.changed, inputWindowMs, delta, decision: final.decision, policyAction,
			response: final.response, decisionGuard: final.guard, state: this.getWorkingState(),
			model: `${requestModel.provider}/${requestModel.id}`, thinkingEnabled, promptVersion: PROMPT_VERSION,
			latencyMs: Math.round(performance.now() - startedAt), rawResponse,
		};
	}
}
