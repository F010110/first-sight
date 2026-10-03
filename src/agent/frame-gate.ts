import { Buffer } from "node:buffer";
import type { AttentionMode, FrameGateResult, FrameRef, MovementSummary } from "./types.js";
import type { RealtimeMotionReport } from "../realtime-motion.js";

type FrameBudgetClass = FrameGateResult["budgetClass"];

const FRAME_BUDGET: Record<AttentionMode, Record<FrameBudgetClass, number>> = {
	quiet: { still: 1, ordered: 3, irregular: 5, unknown: 1 },
	awareness: { still: 1, ordered: 4, irregular: 6, unknown: 1 },
	task: { still: 4, ordered: 4, irregular: 4, unknown: 4 },
	explore: { still: 12, ordered: 12, irregular: 12, unknown: 12 },
};

const POSITION_CHANGE_M = 0.12;
const POSITION_STABLE_PATH_M = 0.35;
const POSITION_RELIABLE_VIEW_SPREAD_DEG = 18;
const HEADING_CHANGE_DEG = 15;
const DIRECTION_STABLE_COHERENCE = 0.58;
const DIRECTION_CHANGED_COHERENCE = 0.4;

function spread<T>(items: T[], limit: number): T[] {
	if (items.length <= limit) return items;
	if (limit <= 1) return [items[items.length - 1]!];
	const indexes = Array.from({ length: limit }, (_, index) => Math.round(index * (items.length - 1) / (limit - 1)));
	return [...new Set(indexes)].map((index) => items[index]!);
}

function quality(frame: FrameRef): number | null {
	if (!frame.quality) return null;
	return Math.max(0, Math.min(1, frame.quality.sharpness)) * 0.85
		+ Math.max(0, Math.min(1, frame.quality.exposure)) * 0.15;
}

function motionEvidence(frame: FrameRef): number {
	const motion = frame.motionContext;
	if (!motion) return 0;
	let score = 0;
	if ((motion.rotationPathDeg ?? 0) * (motion.rotationDirectionCoherence ?? 0) >= 15) score += 0.4;
	if ((motion.estimatedDisplacementM ?? 0) >= 0.12 && (motion.translationDirectionCoherence ?? 0) >= 0.58) score += 0.45;
	if (motion.accelerationVariance !== null && motion.accelerationVariance !== undefined) {
		score += Math.min(0.15, Math.sqrt(Math.max(0, motion.accelerationVariance)) / 10);
	}
	return Math.min(1, score);
}

function signature(frame: FrameRef): Buffer | null {
	if (!frame.quality?.visualSignature) return null;
	try { return Buffer.from(frame.quality.visualSignature, "base64"); } catch { return null; }
}

function visualDifference(a: FrameRef, b: FrameRef): number | null {
	const left = signature(a);
	const right = signature(b);
	if (!left || !right || left.length === 0 || left.length !== right.length) return null;
	let total = 0;
	for (let index = 0; index < left.length; index++) total += Math.abs(left[index]! - right[index]!);
	return total / (left.length * 255);
}

function classifyBudgetClass(summary: MovementSummary): FrameBudgetClass {
	const factors = [summary.positionChange, summary.viewHeadingChange, summary.travelDirectionChange];
	const changedCount = factors.filter((factor) => factor === "significant_change").length;
	if (changedCount >= 2) return "irregular";
	if (changedCount === 1) return "ordered";
	if (summary.positionChange === "no_significant_change" && summary.viewHeadingChange === "no_significant_change") return "still";
	return "unknown";
}

function summarizeMovement(frames: FrameRef[]): MovementSummary {
	const contexts = frames.map((frame) => frame.motionContext).filter((context): context is NonNullable<FrameRef["motionContext"]> => Boolean(context));
	const unknown: MovementSummary = {
		positionChange: "unknown",
		viewHeadingChange: "unknown",
		travelDirectionChange: "unknown",
		confidence: "low",
	};
	if (contexts.length === 0) return unknown;
	const metricMedian = (values: Array<number | null | undefined>): number | null => {
		const sorted = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
		if (!sorted.length) return null;
		const middle = Math.floor(sorted.length / 2);
		return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
	};
	const orientationSpread = metricMedian(contexts.map((context) => context.orientationSpreadDeg));
	const rotationPath = metricMedian(contexts.map((context) => context.rotationPathDeg));
	const rotationCoherence = metricMedian(contexts.map((context) => context.rotationDirectionCoherence));
	const rotationNet = (rotationPath ?? 0) * (rotationCoherence ?? 0);
	const displacement = metricMedian(contexts.map((context) => context.estimatedDisplacementM));
	const pathLength = metricMedian(contexts.map((context) => context.estimatedPathLengthM));
	const translationCoherence = metricMedian(contexts.map((context) => context.translationDirectionCoherence));
	const boundedOrientation = orientationSpread !== null && orientationSpread <= POSITION_RELIABLE_VIEW_SPREAD_DEG;
	const viewHeadingChange = boundedOrientation && rotationNet < HEADING_CHANGE_DEG
		? "no_significant_change"
		: rotationNet >= HEADING_CHANGE_DEG && (rotationCoherence ?? 0) >= 0.5
			? "significant_change"
			: "unknown";
	let positionChange: MovementSummary["positionChange"] = "unknown";
	if (boundedOrientation && displacement !== null && pathLength !== null) {
		if (displacement >= POSITION_CHANGE_M) positionChange = "significant_change";
		else if (displacement < POSITION_CHANGE_M && pathLength < POSITION_STABLE_PATH_M) positionChange = "no_significant_change";
	}
	let travelDirectionChange: MovementSummary["travelDirectionChange"] = "unknown";
	if (positionChange === "significant_change" && pathLength !== null && translationCoherence !== null) {
		if (pathLength >= POSITION_CHANGE_M && translationCoherence >= DIRECTION_STABLE_COHERENCE) travelDirectionChange = "no_significant_change";
		else if (pathLength >= POSITION_STABLE_PATH_M && translationCoherence < DIRECTION_CHANGED_COHERENCE) travelDirectionChange = "significant_change";
	}
	return { positionChange, viewHeadingChange, travelDirectionChange, confidence: "low" };
}

function chooseDiverse(frames: FrameRef[], limit: number): FrameRef[] {
	if (frames.length <= limit) return frames;
	if (frames.some((frame) => !frame.quality?.visualSignature)) return spread(frames, limit);
	const chosen = [frames.at(-1)!];
	while (chosen.length < limit) {
		let next: FrameRef | null = null;
		let nextScore = -Infinity;
		for (const candidate of frames) {
			if (chosen.includes(candidate)) continue;
			const diversity = Math.min(...chosen.map((selected) => visualDifference(candidate, selected) ?? 0));
			const temporalGap = Math.min(...chosen.map((selected) => Math.abs(candidate.timestampMs - selected.timestampMs)))
				/ Math.max(1, frames.at(-1)!.timestampMs - frames[0]!.timestampMs);
			const score = 0.45 * (quality(candidate) ?? 0.5) + 0.25 * diversity + 0.10 * temporalGap + 0.20 * motionEvidence(candidate);
			if (score > nextScore) { next = candidate; nextScore = score; }
		}
		if (!next) break;
		chosen.push(next);
	}
	return chosen.sort((a, b) => a.timestampMs - b.timestampMs);
}

/**
 * Derives the frame-budget movement summary from the live 10s MOTION report
 * (authoritative) instead of the legacy per-frame sensor context.
 */
function summarizeMovementFromReport(report: RealtimeMotionReport): MovementSummary {
	const positionChange: MovementSummary["positionChange"] = report.action
		? "significant_change"
		: report.reliable ? "no_significant_change" : "unknown";
	const viewHeadingChange: MovementSummary["viewHeadingChange"] = report.headingChange;
	let travelDirectionChange: MovementSummary["travelDirectionChange"] = "unknown";
	if (report.action) {
		travelDirectionChange = report.turn && !report.turn.inPlace ? "significant_change" : "no_significant_change";
	}
	return { positionChange, viewHeadingChange, travelDirectionChange, confidence: report.reliable ? "medium" : "low" };
}

/**
 * Picks one representative frame per motion event (as few as possible), capped
 * by the mode budget. Events are matched to frames via the report's phone-clock
 * window end, preferring the sharpest frame inside the event interval.
 */
function selectEventFrames(frames: FrameRef[], report: RealtimeMotionReport, limit: number): FrameRef[] {
	if (frames.length === 0 || limit <= 0) return [];
	const windowStart = report.windowEndMs - report.windowMs;
	const picks: FrameRef[] = [];
	const used = new Set<string>();
	for (const event of report.events) {
		const start = windowStart + event.startMs;
		const end = windowStart + event.endMs;
		const inRange = frames.filter((frame) => frame.timestampMs >= start - 500 && frame.timestampMs <= end + 500);
		const pool = inRange.length ? inRange : frames;
		let best: FrameRef | null = null;
		for (const frame of pool) {
			if (used.has(frame.id)) continue;
			if (best === null || (quality(frame) ?? 0.5) > (quality(best) ?? 0.5)) best = frame;
		}
		if (best) { picks.push(best); used.add(best.id); }
		if (picks.length >= limit) break;
	}
	return picks.sort((a, b) => a.timestampMs - b.timestampMs);
}

/** Selects usable, visually distinct evidence while preserving recency and mode budgets. */
export function selectFrames(frames: FrameRef[], attentionMode: AttentionMode, motionReport?: RealtimeMotionReport): { frames: FrameRef[]; result: FrameGateResult } {
	const ordered = frames.slice().sort((a, b) => a.timestampMs - b.timestampMs);
	const unique: FrameRef[] = [];
	const rejected: FrameGateResult["rejected"] = [];
	const seenTimestamps = new Set<number>();
	for (const frame of ordered) {
		if (seenTimestamps.has(frame.timestampMs)) rejected.push({ id: frame.id, reason: "duplicate_timestamp" });
		else { unique.push(frame); seenTimestamps.add(frame.timestampMs); }
	}
	const movementSummary = motionReport ? summarizeMovementFromReport(motionReport) : summarizeMovement(unique);
	const budgetClass = classifyBudgetClass(movementSummary);
	const frameBudget = FRAME_BUDGET[attentionMode][budgetClass];

	let distinct: FrameRef[] = [];
	for (const frame of unique) {
		const duplicateIndex = distinct.findIndex((previous) => (visualDifference(frame, previous) ?? 1) <= 0.008);
		if (duplicateIndex < 0 || (budgetClass !== "still" && budgetClass !== "unknown")) distinct.push(frame);
		else {
			const previous = distinct[duplicateIndex]!;
			if ((quality(frame) ?? 0.5) >= (quality(previous) ?? 0.5)) {
				rejected.push({ id: previous.id, reason: "duplicate_visual" });
				distinct[duplicateIndex] = frame;
			} else rejected.push({ id: frame.id, reason: "duplicate_visual" });
		}
	}
	distinct.sort((a, b) => a.timestampMs - b.timestampMs);

	const hasUsableQuality = distinct.some((frame) => quality(frame) !== null && quality(frame)! >= 0.12);
	const candidates = distinct.filter((frame) => {
		const score = quality(frame);
		if (hasUsableQuality && score !== null && (frame.quality!.sharpness < 0.08 || frame.quality!.exposure < 0.08)) {
			rejected.push({ id: frame.id, reason: "low_quality" });
			return false;
		}
		return true;
	});
	const eventFrames = motionReport?.events.length ? selectEventFrames(candidates, motionReport, frameBudget) : [];
	const selected = eventFrames.length
		? eventFrames
		: attentionMode === "quiet" && budgetClass === "still" ? candidates.slice(-1) : chooseDiverse(candidates, frameBudget);
	const selectedIds = new Set(selected.map((frame) => frame.id));
	for (const frame of candidates) if (!selectedIds.has(frame.id)) rejected.push({ id: frame.id, reason: "attention_budget" });
	return {
		frames: selected.length > 0 ? selected : unique.slice(-1),
		result: {
			inputCount: frames.length,
			frameBudget,
			budgetClass,
			movementSummary,
			selectedIds: selected.length > 0 ? selected.map((frame) => frame.id) : unique.slice(-1).map((frame) => frame.id),
			qualityById: Object.fromEntries(frames.map((frame) => [frame.id, {
				sharpness: frame.quality?.sharpness ?? null,
				exposure: frame.quality?.exposure ?? null,
			}])),
			rejected,
		},
	};
}
