import type { MotionTimelineSegment } from "./agent/types.js";
import { analyzeActivityMotion } from "./activity-motion.js";
import type { MotionCalibration } from "./dead-reckoning.js";

/** Whole-window travelled path required to count as an action (matches the classifier). */
const MIN_ACTION_PATH_M = 1.5;
const TURN_REPORT_NET_DEG = 40;
/** Upper bound on the number of motion events reported per window. */
export const MAX_MOTION_EVENTS = 6;

type TranslationDirection = NonNullable<MotionTimelineSegment["translationDirection"]>;
type SpeedBucket = NonNullable<MotionTimelineSegment["speed"]>;

/**
 * A single motion event inside the live window. Events are independent, so a
 * window can contain several (e.g. walk forward, turn in place, walk back).
 */
export type MotionEvent =
	| { kind: "translation"; startMs: number; endMs: number; direction: TranslationDirection; speed: SpeedBucket }
	| { kind: "turn"; startMs: number; endMs: number; netDeg: number; direction: "left" | "right" | "mixed"; inPlace: boolean };

/**
 * Compact, real-time motion report for the last window (default 10 s), built
 * from the same classifier used offline. The VLM receives semantics, not raw
 * trajectory, speeds or absolute positions.
 */
export interface RealtimeMotionReport {
	windowMs: number;
	/** Phone-clock epoch (ms) of the window end, so events can be matched to frames. */
	windowEndMs: number;
	/** Independent motion events inside the window, oldest first (at most MAX_MOTION_EVENTS). */
	events: MotionEvent[];
	/** Latest travel event, kept as a convenience summary. */
	action: { active: true; direction: TranslationDirection; speed: SpeedBucket } | null;
	/** Latest turn event, kept as a convenience summary. */
	turn: { active: true; netDeg: number; direction: "left" | "right" | "mixed"; inPlace: boolean } | null;
	headingChange: "significant_change" | "no_significant_change" | "unknown";
	/** True when calibration looked stable (the report can be trusted more). */
	reliable: boolean;
}

export function summarizeRealtimeMotion(motionRows: Array<Record<string, unknown>>, windowMs: number, calibration?: MotionCalibration, windowEndMs = Date.now()): RealtimeMotionReport {
	const analysis = analyzeActivityMotion(motionRows, [], windowMs, calibration ? { calibration } : undefined);
	const pathM = analysis.trajectorySummary.totalPathM;
	const durationSec = Math.max(0.001, windowMs / 1000);
	const actionActive = pathM >= MIN_ACTION_PATH_M;

	const events: MotionEvent[] = [
		...analysis.segments
			.filter((segment) => segment.translationEvidence === "possible")
			.map((segment): MotionEvent => ({
				kind: "translation",
				startMs: segment.startMs,
				endMs: segment.endMs,
				direction: segment.translationDirection ?? "mixed",
				speed: segment.speed ?? "slow",
			})),
		...analysis.turnEvents.map((turn): MotionEvent => ({
			kind: "turn",
			startMs: turn.startMs,
			endMs: turn.endMs,
			netDeg: turn.netDeg,
			direction: turn.direction,
			inPlace: turn.inPlace,
		})),
	].sort((a, b) => a.startMs - b.startMs);
	const cappedEvents = events.length > MAX_MOTION_EVENTS ? events.slice(-MAX_MOTION_EVENTS) : events;

	const lastTranslation = cappedEvents.filter((event): event is Extract<MotionEvent, { kind: "translation" }> => event.kind === "translation").at(-1);
	const lastTurn = cappedEvents.filter((event): event is Extract<MotionEvent, { kind: "turn" }> => event.kind === "turn").at(-1);

	// The action summary also uses the whole-window path, so a short walk that the
	// span splitter dropped is still reported as travel.
	const avgSpeed = pathM / durationSec;
	const wholeWindowSpeed: SpeedBucket = avgSpeed < 0.4 ? "slow" : avgSpeed < 0.9 ? "moderate" : "fast";
	const actionDirection = lastTranslation?.direction
		?? analysis.segments.filter((segment) => segment.translationEvidence === "possible").at(-1)?.translationDirection
		?? "mixed";
	const action: RealtimeMotionReport["action"] = actionActive ? { active: true, direction: actionDirection, speed: lastTranslation?.speed ?? wholeWindowSpeed } : null;
	const turn: RealtimeMotionReport["turn"] = lastTurn
		? { active: true, netDeg: lastTurn.netDeg, direction: lastTurn.direction, inPlace: lastTurn.inPlace }
		: null;
	const headingChange: RealtimeMotionReport["headingChange"] = lastTurn && Math.abs(lastTurn.netDeg) >= TURN_REPORT_NET_DEG
		? "significant_change"
		: lastTurn
			? "unknown"
			: "no_significant_change";

	return {
		windowMs,
		windowEndMs,
		events: cappedEvents,
		action,
		turn,
		headingChange,
		reliable: analysis.calibration.stable,
	};
}

/** Human-readable one-liner for logs / debugging. */
export function describeRealtimeMotion(report: RealtimeMotionReport): string {
	const parts: string[] = [];
	if (report.action) parts.push(`travelling ${report.action.direction} (${report.action.speed})`);
	else parts.push("not travelling");
	if (report.turn) parts.push(`turned ${report.turn.direction} ~${Math.abs(report.turn.netDeg)}°${report.turn.inPlace ? " in place" : " while moving"}`);
	parts.push(`${report.events.length} events`, `heading ${report.headingChange}`);
	return parts.join("; ");
}
