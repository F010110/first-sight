/**
 * Structured motion hint for transition edges.
 *
 * The bottom layer (IMU / optical flow / VIO / device orientation) produces
 * qualitative motion; we keep it STRUCTURED in the database (not free text) and
 * only turn it into a sentence when talking to the VLM. Metric displacement is
 * never trusted: bins may be "unknown".
 */

export type Bin3 = "short" | "medium" | "long" | "unknown";
export type TurnDir = "left" | "right" | "straight" | "around" | "unknown";
export type TurnAmount = "small" | "medium" | "large" | "unknown";
export type LevelChange = "same" | "up" | "down" | "unknown";

export interface MotionHint {
	moving: boolean;
	duration: Bin3;
	distance: Bin3;
	turn: TurnDir;
	turnAmount: TurnAmount;
	level: LevelChange;
	confidence: number;
}

const DURATION_LONG_S = 5;
const DURATION_MEDIUM_S = 2;

function durationBin(seconds: number): Bin3 {
	if (!Number.isFinite(seconds) || seconds <= 0) return "unknown";
	if (seconds < DURATION_MEDIUM_S) return "short";
	if (seconds < DURATION_LONG_S) return "medium";
	return "long";
}

function speedToDistance(speed: string): Bin3 {
	return speed === "slow" ? "short" : speed === "moderate" ? "medium" : speed === "fast" ? "long" : "unknown";
}

function amountFromDegrees(degrees: number): TurnAmount {
	if (!Number.isFinite(degrees)) return "unknown";
	if (degrees < 30) return "small";
	if (degrees < 100) return "medium";
	return "large";
}

const BIN_RANK: Record<string, number> = { unknown: 0, short: 1, small: 1, medium: 2, long: 3, large: 3 };
function maxBin<T extends string>(a: T, b: T): T { return (BIN_RANK[a] ?? 0) >= (BIN_RANK[b] ?? 0) ? a : b; }

/**
 * Parse the natural-language motion string the app/simulator already produces
 * (e.g. "stayed still for about 2s, then moved forward (slow) for about 3s,
 * then turned left roughly 90 degrees in place for about 1s").
 */
export function parseMotionHint(text: string | null): MotionHint {
	const hint: MotionHint = { moving: false, duration: "unknown", distance: "unknown", turn: "unknown", turnAmount: "unknown", level: "unknown", confidence: 0.6 };
	if (!text) return hint;
	const lower = text.toLowerCase();
	let seconds = 0;
	for (const match of lower.matchAll(/about\s+([0-9.]+)\s*s/g)) seconds += Number(match[1]);
	if (/stayed still|still/.test(lower) && !/moved|turned/.test(lower)) {
		return { ...hint, duration: durationBin(seconds), confidence: 0.8 };
	}
	const move = lower.match(/moved\s+(forward|backward|to the left|to the right|left|right)\s*\(([a-z]+)\)/);
	if (move) {
		hint.moving = true;
		hint.distance = speedToDistance(move[2] ?? "");
		const direction = move[1] ?? "";
		hint.turn = direction === "forward" || direction === "backward" ? "straight" : direction.includes("left") ? "left" : "right";
	}
	const turn = lower.match(/turned\s+(left|right)\s+roughly\s+([0-9.]+)\s+degrees/);
	if (turn) {
		hint.moving = true;
		hint.turn = turn[1] as TurnDir;
		hint.turnAmount = amountFromDegrees(Number(turn[2]));
	}
	hint.duration = durationBin(seconds);
	if (/\bup\b|upstairs|ascend/.test(lower)) hint.level = "up";
	else if (/\bdown\b|downstairs|descend/.test(lower)) hint.level = "down";
	return hint;
}

export function aggregateHints(hints: MotionHint[]): MotionHint {
	if (hints.length === 0) return parseMotionHint(null);
	const result = { ...hints[hints.length - 1]! };
	for (const hint of hints) {
		result.moving = result.moving || hint.moving;
		result.duration = maxBin(result.duration, hint.duration);
		result.distance = maxBin(result.distance, hint.distance);
		result.turnAmount = maxBin(result.turnAmount, hint.turnAmount);
		if (result.turn === "unknown" || result.turn === "straight") result.turn = hint.turn;
		if (hint.level !== "unknown" && result.level !== hint.level) result.level = result.level === "unknown" ? hint.level : "unknown";
		result.confidence = Math.min(result.confidence, hint.confidence);
	}
	return result;
}

export function describeHint(hint: MotionHint): string {
	const parts: string[] = [];
	if (!hint.moving && hint.turn === "unknown") return "no clear motion since the previous place";
	parts.push(`moving: ${hint.moving ? "yes" : "no"}`);
	if (hint.duration !== "unknown") parts.push(`duration: ${hint.duration}`);
	if (hint.distance !== "unknown") parts.push(`distance: ${hint.distance}`);
	if (hint.turn !== "unknown") parts.push(`turn: ${hint.turn}`);
	if (hint.turnAmount !== "unknown") parts.push(`turn amount: ${hint.turnAmount}`);
	if (hint.level !== "unknown") parts.push(`level: ${hint.level}`);
	return parts.join(", ");
}

/** 0..1 agreement between two hints (used to match a trip to a remembered edge). */
export function hintSimilarity(a: MotionHint, b: MotionHint): number {
	let score = 0;
	let weight = 0;
	const add = (x: string, y: string, w: number) => { weight += w; if (x === y) score += w; else if (x === "unknown" || y === "unknown") score += w * 0.5; };
	add(a.turn, b.turn, 2);
	add(a.turnAmount, b.turnAmount, 2);
	add(a.distance, b.distance, 1.5);
	add(a.duration, b.duration, 1);
	add(a.level, b.level, 1);
	add(String(a.moving), String(b.moving), 1);
	return weight ? score / weight : 0;
}
