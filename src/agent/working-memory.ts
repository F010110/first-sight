import type { AttentionMode, FrameRef, ObservationDelta, WorkingState } from "./types.js";

export function createWorkingState(goal: string | null = null, initialState?: Partial<WorkingState>): WorkingState {
	const now = new Date().toISOString();
	const initialGoal = initialState?.activeTask?.goal ?? goal;
	return {
		goal: initialGoal,
		activeTask: initialState?.activeTask ?? { status: initialGoal ? "active" : "idle", phase: initialGoal ? "searching" : "done", goal: initialGoal, startedAt: initialGoal ? now : null, updatedAt: initialGoal ? now : null },
		activeWatch: initialState?.activeWatch ?? { status: "idle", condition: null, startedAt: null, lastCheckedAt: null },
		scene: initialState?.scene ? { ...initialState.scene, frameIds: [...initialState.scene.frameIds] } : { current: null, previous: null, changed: null, changeConfidence: null, confidence: null, frameIds: [], updatedAtMs: null },
		recentEvents: initialState?.recentEvents?.slice(-20) ?? [],
		recentSpeech: initialState?.recentSpeech?.slice(-10) ?? [],
		userKnownFacts: initialState?.userKnownFacts?.slice(-40) ?? [],
		entities: { ...(initialState?.entities ?? {}) },
	};
}

export function endTask(state: WorkingState): void {
	state.goal = null;
	state.activeTask = { status: "idle", phase: "done", goal: null, startedAt: null, updatedAt: new Date().toISOString() };
}

export function startWatch(state: WorkingState, condition: string): void {
	state.activeWatch = { status: "watching", condition, startedAt: new Date().toISOString(), lastCheckedAt: null };
}

export function stopWatch(state: WorkingState): void {
	state.activeWatch = { status: "idle", condition: null, startedAt: null, lastCheckedAt: null };
}

export function updateWatch(state: WorkingState, conditionMatch: "not_met" | "suspected" | "confirmed" | null, timestampMs: number): void {
	const watch = state.activeWatch;
	if (watch.status === "idle" || !watch.condition) return;
	watch.lastCheckedAt = timestampMs;
	if (conditionMatch === "not_met") watch.status = "watching";
	else if (conditionMatch === "suspected") watch.status = "suspected";
	else if (conditionMatch === "confirmed") watch.status = "confirmed";
}

export function updateTaskPhase(state: WorkingState, phase: WorkingState["activeTask"]["phase"]): void {
	if (state.activeTask.status === "active") {
		state.activeTask.phase = phase;
		state.activeTask.updatedAt = new Date().toISOString();
	}
}

export function applyObservation(state: WorkingState, delta: ObservationDelta, frames: FrameRef[], sceneConfidenceThreshold = 0.65): void {
	const byId = new Map(frames.map((frame) => [frame.id, frame]));
	state.scene.changed = null;
	state.scene.changeConfidence = null;
	const sceneUpdate = delta.stateUpdate.scene;
	const hasCurrentSceneEvidence = sceneUpdate && sceneUpdate.frameIds.length > 0
		&& sceneUpdate.frameIds.some((id) => byId.get(id)?.source !== "visual_memory");
	if (sceneUpdate && sceneUpdate.confidence >= sceneConfidenceThreshold && hasCurrentSceneEvidence) {
		const previous = state.scene.current;
		const comparisonIsConfident = sceneUpdate.changed !== null && sceneUpdate.changeConfidence >= sceneConfidenceThreshold;
		if (previous !== null && comparisonIsConfident && sceneUpdate.changed === true) state.scene.previous = previous;
		state.scene.current = sceneUpdate.value;
		state.scene.changed = previous === null || !comparisonIsConfident ? null : sceneUpdate.changed;
		state.scene.changeConfidence = previous === null || !comparisonIsConfident ? null : sceneUpdate.changeConfidence;
		state.scene.confidence = sceneUpdate.confidence;
		state.scene.frameIds = [...sceneUpdate.frameIds];
		state.scene.updatedAtMs = Math.max(...sceneUpdate.frameIds.map((id) => byId.get(id)?.timestampMs ?? 0));
	}
	for (const event of delta.stateUpdate.events) {
		if (!event.frameIds.some((id) => byId.get(id)?.source !== "visual_memory")) continue;
		const timestampMs = Math.max(...event.frameIds.map((id) => byId.get(id)?.timestampMs ?? 0));
		if (!state.recentEvents.some((existing) => existing.description === event.description && existing.frameIds.join() === event.frameIds.join())) state.recentEvents.push({ ...event, timestampMs });
	}
	state.recentEvents = state.recentEvents.slice(-20);
	for (const entity of delta.stateUpdate.entities) {
		if (entity.frameIds.length === 0) continue;
		const lastSeenMs = Math.max(...entity.frameIds.map((id) => byId.get(id)?.timestampMs ?? 0));
		const key = entity.name.toLocaleLowerCase();
		if (!state.entities[key] || lastSeenMs >= state.entities[key]!.lastSeenMs) state.entities[key] = { ...entity, lastSeenMs };
	}
}

export function recordSpeech(state: WorkingState, text: string, timestampMs: number, frameIds: string[], attentionMode: AttentionMode): void {
	state.recentSpeech.push({ text, timestampMs, frameIds, mode: attentionMode });
	state.recentSpeech = state.recentSpeech.slice(-10);
}

export function recordPresentedFacts(state: WorkingState, facts: ObservationDelta["observations"], timestampMs: number): void {
	for (const fact of facts) {
		if (!fact.frameIds.length) continue;
		state.userKnownFacts = state.userKnownFacts.filter((known) => known.content !== fact.content);
		state.userKnownFacts.push({ content: fact.content, presentedAtMs: timestampMs });
	}
	state.userKnownFacts = state.userKnownFacts.slice(-40);
}
