/** Backward-compatible public entry point; new code should depend on src/agent modules. */
export {
	VlmAgent as VlmHarness,
	PROMPT_VERSION,
	MONITOR_MAX_OUTPUT_TOKENS,
	DEEP_MAX_OUTPUT_TOKENS,
	DEEP_THINKING_BUDGET,
	MIN_ANSWER_CONFIDENCE,
	answerConfidenceThreshold,
	outputTokensForMode,
	thinkingEnabledForModel,
} from "./agent/agent.js";
export type {
	FrameRef,
	MotionContext,
	MotionTimelineSegment,
	ObservationItem,
	ObservationDelta,
	AnswerDecision,
	AnalysisMode,
	InferenceBudget,
	AttentionMode,
	EntityMemory,
	WorkingState,
	FrameGateResult,
	ObserveResult,
} from "./agent/types.js";
