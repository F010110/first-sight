export interface FrameRef {
	id: string;
	timestampMs: number;
	path: string;
	source?: "current" | "visual_memory";
	quality?: { sharpness: number; exposure: number; visualSignature?: string };
	motionContext?: MotionContext;
}

export type ActivityMotionPattern = "low_motion" | "rotation_dominant" | "translation_candidate" | "stationary_jitter_candidate" | "mixed_or_unknown";

export interface MotionTimelineSegment {
	startMs: number;
	endMs: number;
	pattern: ActivityMotionPattern;
	viewHeadingChange: "significant_change" | "no_significant_change" | "unknown";
	translationEvidence: "possible" | "not_detected" | "unknown";
	motionVariance: "elevated" | "low" | "unknown";
	confidence: "medium" | "low";
	representativeFrameIds: string[];
	/** Which rotation axis dominates: yaw is a real turn, tilt is just aiming the phone. */
	rotationAxis?: "yaw" | "tilt" | "mixed" | "none";
	/** Coarse travel direction relative to where the phone (camera) is pointing. */
	translationDirection?: "forward" | "backward" | "left" | "right" | "mixed";
	/** Coarse speed bucket, only meaningful when translationEvidence is "possible". */
	speed?: "slow" | "moderate" | "fast";
}

export interface MotionContext {
	windowMs: number;
	sampleCount: number;
	angularMotion: "rotating" | "quiet" | "unknown";
	linearAcceleration: "active" | "quiet" | "unknown";
	visualViewChange: "high" | "low" | "unknown";
	translationLikelihood: "possible" | "unknown";
	stability: "moving" | "settling" | "stable" | "unknown";
	rotationRateDps: number | null;
	linearAccelerationMps2: number | null;
	/** Robust p90 orientation spread over windowMs. */
	orientationSpreadDeg?: number | null | undefined;
	/** Cumulative orientation path and net/path ratio over windowMs. */
	rotationPathDeg?: number | null | undefined;
	rotationDirectionCoherence?: number | null | undefined;
	/** Variance of acceleration magnitude; units are (m/s²)². */
	accelerationVariance?: number | null | undefined;
	/** Approximate device-frame double-integration; never an absolute position measurement. */
	estimatedDisplacementM?: number | null | undefined;
	estimatedPathLengthM?: number | null | undefined;
	translationDirectionCoherence?: number | null | undefined;
}

export type AnswerDecision = "answer" | "clarify" | "silent";
export type AnalysisMode = "monitor" | "deep"; // Compatibility name for the inference budget.
export type InferenceBudget = "economy" | "deep";
export type AttentionMode = "quiet" | "awareness" | "task" | "explore";

export interface ObservationItem {
	kind: "scene" | "object" | "text" | "person" | "change" | "activity" | "uncertainty";
	content: string;
	location: string | null;
	status: "new" | "present" | "uncertain";
	goalRelevant: boolean;
	confidence: number;
	frameIds: string[];
	observedAtMs: number;
}

export interface ObservationDelta {
	changed: boolean | null;
	conditionMatch: "not_met" | "suspected" | "confirmed" | null;
	observations: ObservationItem[];
	stateUpdate: {
		scene: { value: string; changed: boolean | null; changeConfidence: number; confidence: number; goalRelevant: boolean; frameIds: string[] } | null;
		events: Array<{ description: string; frameIds: string[] }>;
		entities: Array<{ name: string; location: string | null; frameIds: string[] }>;
	};
	/** Model-proposed wording only; the attention policy decides whether it is shown. */
	response: string | null;
}

export interface EntityMemory {
	name: string;
	lastSeenMs: number;
	location: string | null;
	frameIds: string[];
}

export interface WorkingState {
	goal: string | null;
	activeTask: { status: "idle" | "active"; phase: "searching" | "possible_target" | "need_better_view" | "confirmed" | "guiding" | "lost" | "reacquired" | "historical_match" | "done"; goal: string | null; startedAt: string | null; updatedAt: string | null };
	activeWatch: { status: "idle" | "watching" | "suspected" | "confirmed"; condition: string | null; startedAt: string | null; lastCheckedAt: number | null };
	scene: { current: string | null; previous: string | null; changed: boolean | null; changeConfidence: number | null; confidence: number | null; frameIds: string[]; updatedAtMs: number | null };
	recentEvents: Array<{ description: string; timestampMs: number; frameIds: string[] }>;
	recentSpeech: Array<{ text: string; timestampMs: number; frameIds: string[]; mode: AttentionMode }>;
	userKnownFacts: Array<{ content: string; presentedAtMs: number }>;
	entities: Record<string, EntityMemory>;
}

export interface FrameGateResult {
	inputCount: number;
	frameBudget: number;
	budgetClass: "still" | "ordered" | "irregular" | "unknown";
	movementSummary: MovementSummary;
	selectedIds: string[];
	qualityById: Record<string, { sharpness: number | null; exposure: number | null }>;
	rejected: Array<{ id: string; reason: "duplicate_timestamp" | "attention_budget" | "low_quality" | "duplicate_visual" }>;
}

export interface MovementSummary {
	positionChange: "no_significant_change" | "significant_change" | "unknown";
	viewHeadingChange: "no_significant_change" | "significant_change" | "unknown";
	travelDirectionChange: "no_significant_change" | "significant_change" | "unknown";
	confidence: "medium" | "low";
}

export interface ObserveResult {
	/** Compatibility field. Prefer attentionMode and inferenceBudget. */
	mode: AnalysisMode;
	inferenceBudget: InferenceBudget;
	attentionMode: AttentionMode;
	userInitiated: boolean;
	frameGate: FrameGateResult;
	visualMemoryFrameIds: string[];
	changed: boolean | null;
	inputWindowMs: number;
	delta: ObservationDelta;
	decision: AnswerDecision;
	policyAction: "ANSWER" | "CLARIFY" | "SILENCE" | "SPEAK";
	response: string | null;
	decisionGuard: string;
	state: WorkingState;
	model: string;
	thinkingEnabled: boolean | null;
	promptVersion: string;
	latencyMs: number;
	rawResponse: string;
}
