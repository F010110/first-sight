import type { AnswerDecision, AttentionMode, ObservationItem } from "./types.js";

interface PolicyInput {
	attentionMode: AttentionMode;
	userInitiated: boolean;
	goal: string | null;
	watchCondition: string | null;
	watchStatus: "not_met" | "suspected" | "confirmed" | null;
	watchAlreadyConfirmed: boolean;
	historicalQuery: boolean;
	changed: boolean | null;
	latestFrameMs: number;
	observations: ObservationItem[];
	candidateResponse: string | null;
	threshold: number;
	recentSpeech: Array<{ text: string; timestampMs: number }>;
	knownFacts: Array<{ content: string; presentedAtMs: number }>;
	now: number;
}

export interface SpeakingDecision {
	decision: AnswerDecision;
	response: string | null;
	guard: string;
}

const REPEAT_WINDOW_MS: Record<AttentionMode, number> = {
	quiet: 180_000,
	awareness: 45_000,
	task: 30_000,
	explore: 0,
};

const FACT_AGE_MS: Record<AttentionMode, Record<ObservationItem["kind"], number>> = {
	quiet: { scene: 300_000, object: 20_000, text: 300_000, person: 15_000, change: 10_000, activity: 10_000, uncertainty: 10_000 },
	awareness: { scene: 120_000, object: 8_000, text: 30_000, person: 8_000, change: 8_000, activity: 8_000, uncertainty: 8_000 },
	task: { scene: 120_000, object: 60_000, text: 120_000, person: 30_000, change: 15_000, activity: 15_000, uncertainty: 15_000 },
	explore: { scene: 120_000, object: 120_000, text: 120_000, person: 60_000, change: 60_000, activity: 60_000, uncertainty: 60_000 },
};

function normalizeSpeech(text: string): string {
	return text.replace(/[\s，。！？；：,.!?;:、]/g, "").toLocaleLowerCase();
}

/** Prevent image-coordinate language from leaking into speech the user cannot map to their surroundings. */
function containsFrameRelativeDirection(text: string): boolean {
	const direction = "(?:左|右|上|下)(?:边|側|侧|方|角)?";
	const imageReference = "(?:图片|画面|图像|照片|截图|屏幕|image|picture|frame|screen)";
	return new RegExp(`${imageReference}.{0,10}${direction}|${direction}.{0,10}${imageReference}`, "i").test(text)
		|| /(?:你|用户)(?:的)?(?:左|右)(?:手)?(?:边|侧)|(?:to|on)\s+(?:your|the user's)\s+(?:left|right)(?:\s+side)?/i.test(text);
}

function silent(guard: string): SpeakingDecision {
	return { decision: "silent", response: null, guard };
}

export function decideSpeech(input: PolicyInput): SpeakingDecision {
	const fresh = input.observations.filter((fact) => {
		const relativeAgeMs = input.latestFrameMs - fact.observedAtMs;
		const wallClockAgeMs = input.now - fact.observedAtMs;
		const isLiveTimestamp = fact.observedAtMs >= 1_000_000_000_000;
		const isRecalledFrame = input.historicalQuery && fact.frameIds.some((id) => id.startsWith("memory-"));
		const maxAgeMs = isRecalledFrame ? 4 * 60 * 60 * 1000 : FACT_AGE_MS[input.attentionMode][fact.kind];
		return relativeAgeMs >= 0 && relativeAgeMs <= maxAgeMs
			&& (!isLiveTimestamp || (wallClockAgeMs >= 0 && wallClockAgeMs <= maxAgeMs));
	});
	const supported = fresh
		.filter((fact) => fact.confidence >= input.threshold && fact.frameIds.length > 0)
		.filter((fact) => (!input.goal && !input.watchCondition) || fact.goalRelevant)
		.sort((a, b) => b.observedAtMs - a.observedAtMs);
	const novelSupported = input.userInitiated || input.attentionMode === "awareness"
		? supported
		: supported.filter((fact) => !input.knownFacts.some((known) => normalizeSpeech(known.content) === normalizeSpeech(fact.content)));
	const fact = novelSupported[0];
	if (!fact) {
		if (supported.length > 0) return silent("fact_already_presented_to_user");
		if (input.attentionMode === "task" && input.userInitiated && input.goal) {
			return { decision: "clarify", response: "我暂时无法从当前画面确认这个目标。请让画面更清晰，或缓慢转向可能的位置后再试。", guard: "task_needs_better_view" };
		}
		if (input.observations.length > 0 && fresh.length === 0) return silent("evidence_stale");
		return silent(input.goal ? "no_supported_goal_relevant_fact" : "no_supported_fact");
	}
	const candidate = input.candidateResponse?.trim() || null;
	const safeCandidate = candidate && !containsFrameRelativeDirection(candidate) ? candidate : null;
	const safeFact = !containsFrameRelativeDirection(fact.content) ? fact.content : null;
	const response = safeCandidate ?? (input.userInitiated || input.attentionMode === "awareness" ? safeFact : null);
	if (candidate && !safeCandidate && !safeFact) return silent("frame_relative_direction_blocked");
	if (!response) return silent("candidate_response_missing");

	if (input.attentionMode === "quiet" && !input.userInitiated) return silent("quiet_mode_blocks_proactive_output");
	if (input.attentionMode === "awareness" && !input.userInitiated) {
		if (!input.watchCondition) return silent("awareness_requires_explicit_watch_condition");
		if (input.watchStatus === "suspected") return silent("watch_condition_needs_recheck");
		if (input.watchStatus !== "confirmed") return silent("watch_condition_not_met");
		if (input.watchAlreadyConfirmed) return silent("watch_condition_already_announced");
	}
	if (input.attentionMode === "task" && !input.goal) return silent("task_mode_requires_active_goal");
	if (input.attentionMode === "task" && !input.userInitiated && input.changed !== true) return silent("no_new_task_evidence");

	if (!input.userInitiated) {
		const repeatWindow = REPEAT_WINDOW_MS[input.attentionMode];
		const normalized = normalizeSpeech(response);
		const duplicate = repeatWindow > 0 && input.recentSpeech.some((item) =>
			input.now - item.timestampMs >= 0 && input.now - item.timestampMs < repeatWindow && normalizeSpeech(item.text) === normalized);
		if (duplicate) return silent("recent_speech_duplicate");
	}

	return {
		decision: "answer",
		response,
		guard: input.userInitiated ? "user_initiated_supported_response" : `${input.attentionMode}_policy_allowed`,
	};
}
