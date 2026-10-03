import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { answerConfidenceThreshold, outputTokensForMode, PROMPT_VERSION, thinkingEnabledForModel, VlmHarness, type AnalysisMode, type AnswerDecision, type AttentionMode, type FrameRef, type InferenceBudget, type MotionContext, type MotionTimelineSegment, type ObserveResult } from "./vlm-harness.js";
import type { RealtimeMotionReport } from "./realtime-motion.js";

export interface CaseInput {
	caseId: string;
	goal: string | null;
	mode?: AnalysisMode;
	inferenceBudget?: InferenceBudget;
	attentionMode?: AttentionMode;
	userInitiated?: boolean;
	frames: FrameRef[];
	motionTimeline?: MotionTimelineSegment[];
	/** Live 10s sensor summary from the phone, if supplied. */
	motionReport?: RealtimeMotionReport;
	/** Natural-language motion description fused from IMU + camera (VIO-lite). */
	motionDescription?: string;
	maxOutputTokens?: number;
	routerDecision?: RouterDecision;
	expected?: { decision?: AnswerDecision; targetFound?: boolean; positionCorrect?: boolean };
}

export interface RouterDecision {
	triggerReason: string;
	capturedFrames: number;
	movingFramesSkipped: number;
	noChangeFramesSkipped: number;
	familiarSceneFramesSkipped: number;
	stabilityWaits: number;
	stableFrameCount: number;
	frameChangeScore: number | null;
	visualNoveltyScore?: number | null;
	sceneChangeScore?: number | null;
	sensorMotionGatedFrames?: number;
	motionContext?: MotionContext | null;
}

export interface Feedback {
	useful: boolean | null;
	perceptionCorrect: boolean | null;
	positionCorrect: boolean | null;
	decisionCorrect: boolean | null;
	responseCorrect: boolean | null;
	notes: string | null;
	annotator?: string;
	createdAt: string;
}

export interface RunRecord {
	schemaVersion: 3;
	runId: string;
	sessionId: string;
	caseId: string;
	startedAt: string;
	completedAt: string;
	input: { goal: string | null; attentionMode: AttentionMode; userInitiated: boolean; routerDecision: RouterDecision | null; motionTimeline?: MotionTimelineSegment[]; motionReport?: RealtimeMotionReport; motionDescription?: string; motionRawPath?: string; frames: Array<FrameRef & { sourcePath: string; archivePath: string | null; archiveError?: string; sha256: string | null; sizeBytes: number | null }> };
	configuration: { provider: string; model: string; baseUrl: string | null; promptVersion: string; mode: AnalysisMode; inferenceBudget: InferenceBudget; attentionMode: AttentionMode; thinkingEnabled: boolean | null; maxFrames: number; maxTokens: number; temperature: number | null; answerConfidenceThreshold: number };
	status: "ok" | "error";
	result: ObserveResult | null;
	error: { name: string; message: string } | null;
	expected: CaseInput["expected"] | null;
	feedback: Feedback | null;
}

export function argValue(args: string[], name: string, fallback: string): string {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

export function hasArg(args: string[], name: string): boolean { return args.includes(name); }

export async function readCases(path: string): Promise<CaseInput[]> {
	const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
	if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Cases file must contain a non-empty JSON array");
	const base = dirname(resolve(path));
	return parsed.map((value, index) => {
		if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`Case ${index} must be an object`);
		const row = value as Record<string, unknown>;
		if (typeof row.caseId !== "string" || !Array.isArray(row.frames) || row.frames.length === 0) throw new Error(`Case ${index} needs caseId and frames[]`);
		if (row.goal !== undefined && row.goal !== null && typeof row.goal !== "string") throw new Error(`Case ${index}.goal must be a string or null`);
		if (row.mode !== undefined && row.mode !== "monitor" && row.mode !== "deep") throw new Error(`Case ${index}.mode must be monitor or deep`);
		if (row.inferenceBudget !== undefined && row.inferenceBudget !== "economy" && row.inferenceBudget !== "deep") throw new Error(`Case ${index}.inferenceBudget must be economy or deep`);
		if (row.attentionMode !== undefined && !["quiet", "awareness", "task", "explore"].includes(String(row.attentionMode))) throw new Error(`Case ${index}.attentionMode is invalid`);
		if (row.userInitiated !== undefined && typeof row.userInitiated !== "boolean") throw new Error(`Case ${index}.userInitiated must be boolean`);
		const frames = row.frames.map((item, frameIndex): FrameRef => {
			if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error(`Case ${index} frame ${frameIndex} must be an object`);
			const frame = item as Record<string, unknown>;
			if (typeof frame.id !== "string" || typeof frame.path !== "string" || typeof frame.timestampMs !== "number") throw new Error(`Case ${index} frame ${frameIndex} needs id, path, timestampMs`);
			let quality: FrameRef["quality"];
			if (frame.quality !== undefined) {
				if (typeof frame.quality !== "object" || frame.quality === null || Array.isArray(frame.quality)) throw new Error(`Case ${index} frame ${frameIndex}.quality must be an object`);
				const metadata = frame.quality as Record<string, unknown>;
				if (typeof metadata.sharpness !== "number" || metadata.sharpness < 0 || metadata.sharpness > 1 || typeof metadata.exposure !== "number" || metadata.exposure < 0 || metadata.exposure > 1) throw new Error(`Case ${index} frame ${frameIndex}.quality values must be between 0 and 1`);
				quality = { sharpness: metadata.sharpness, exposure: metadata.exposure, ...(typeof metadata.visualSignature === "string" ? { visualSignature: metadata.visualSignature } : {}) };
			}
			return { id: frame.id, timestampMs: frame.timestampMs, path: resolve(base, frame.path), ...(quality ? { quality } : {}) };
		});
		const expected = row.expected as CaseInput["expected"] | undefined;
		return {
			caseId: row.caseId,
			goal: (row.goal as string | null | undefined) ?? null,
			...(row.mode ? { mode: row.mode as AnalysisMode } : {}),
			...(row.inferenceBudget ? { inferenceBudget: row.inferenceBudget as InferenceBudget } : {}),
			...(row.attentionMode ? { attentionMode: row.attentionMode as AttentionMode } : {}),
			...(row.userInitiated === undefined ? {} : { userInitiated: row.userInitiated as boolean }),
			frames,
			...(expected ? { expected } : {}),
		};
	});
}

function safeEndpoint(): string | null {
	const value = process.env.QWEN_BASE_URL;
	if (!value) return null;
	try { const url = new URL(value); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString().replace(/\/$/, ""); } catch { return "configured-unparsed"; }
}

export async function executeCase(sessionId: string, testCase: CaseInput, harness?: VlmHarness): Promise<RunRecord> {
	const startedAt = new Date();
	const runId = randomUUID();
	const inferenceBudget = testCase.inferenceBudget ?? (testCase.mode === "deep" || (!testCase.mode && testCase.goal?.trim()) ? "deep" : "economy");
	const mode: AnalysisMode = inferenceBudget === "deep" ? "deep" : "monitor";
	const attentionMode = testCase.attentionMode ?? (testCase.goal?.trim() ? "task" : inferenceBudget === "deep" ? "explore" : "quiet");
	const userInitiated = testCase.userInitiated ?? inferenceBudget === "deep";
	const model = process.env.QWEN_MODEL || "qwen3-vl-plus";
	const inputs = await Promise.all(testCase.frames.map(async (frame) => {
		try {
			const bytes = await readFile(frame.path);
			return { ...frame, sourcePath: frame.path, archivePath: null, sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.byteLength };
		} catch {
			return { ...frame, sourcePath: frame.path, archivePath: null, sha256: null, sizeBytes: null };
		}
	}));
	const record: RunRecord = {
		schemaVersion: 3, runId, sessionId, caseId: testCase.caseId, startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(),
		input: { goal: testCase.goal, attentionMode, userInitiated, routerDecision: testCase.routerDecision ?? null, ...(testCase.motionTimeline ? { motionTimeline: testCase.motionTimeline } : {}), ...(testCase.motionReport ? { motionReport: testCase.motionReport } : {}), ...(testCase.motionDescription ? { motionDescription: testCase.motionDescription } : {}), frames: inputs },
		configuration: { provider: "qwen-vlm", model, baseUrl: safeEndpoint(), promptVersion: PROMPT_VERSION, mode, inferenceBudget, attentionMode, thinkingEnabled: thinkingEnabledForModel(model, mode), maxFrames: attentionMode === "explore" ? 12 : 8, maxTokens: testCase.maxOutputTokens ?? outputTokensForMode(mode), temperature: null, answerConfidenceThreshold: answerConfidenceThreshold() },
		status: "error", result: null, error: null, expected: testCase.expected ?? null, feedback: null,
	};
	try {
		record.result = await (harness ?? new VlmHarness()).observe(testCase.frames, { mode, inferenceBudget, attentionMode, userInitiated, goal: testCase.goal, ...(testCase.motionTimeline ? { motionTimeline: testCase.motionTimeline } : {}), ...(testCase.motionReport ? { motionReport: testCase.motionReport } : {}), ...(testCase.motionDescription ? { motionDescription: testCase.motionDescription } : {}), ...(testCase.maxOutputTokens ? { maxOutputTokens: testCase.maxOutputTokens } : {}) });
		record.status = "ok";
	} catch (error) {
		record.error = { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) };
	}
	record.completedAt = new Date().toISOString();
	return record;
}

export async function appendRun(root: string, record: RunRecord): Promise<string> {
	const sessionDir = resolve(root, record.sessionId);
	await mkdir(sessionDir, { recursive: true });
	for (const frame of record.input.frames) {
		const extension = frame.path.match(/\.[^.]+$/)?.[0] ?? ".img";
		const relativePath = `inputs/${record.runId}/${frame.id.replace(/[^a-zA-Z0-9_.-]/g, "-")}${extension}`;
		const destination = resolve(sessionDir, relativePath);
		try {
			await mkdir(dirname(destination), { recursive: true });
			await copyFile(frame.sourcePath, destination);
			frame.archivePath = relativePath;
			frame.path = relativePath;
		} catch (error) {
			frame.archiveError = error instanceof Error ? error.message : String(error);
		}
	}
	const runsPath = resolve(sessionDir, "runs.jsonl");
	await appendFile(runsPath, `${JSON.stringify(record)}\n`, "utf8");
	return runsPath;
}

export async function appendSessionEvent(root: string, sessionId: string, event: { type: string; goal?: string | null; details?: Record<string, unknown> }): Promise<string> {
	const path = resolve(root, sessionId, "events.jsonl");
	await mkdir(dirname(path), { recursive: true });
	await appendFile(path, `${JSON.stringify({ schemaVersion: 1, sessionId, timestamp: new Date().toISOString(), ...event })}\n`, "utf8");
	return path;
}

export async function readRunRecords(sessionId: string, root = "run/experiments"): Promise<RunRecord[]> {
	const raw = await readFile(resolve(root, sessionId, "runs.jsonl"), "utf8");
	return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as RunRecord);
}

export async function writeSessionManifest(root: string, sessionId: string, profile: string): Promise<void> {
	const path = resolve(root, sessionId, "session.json");
	await mkdir(dirname(path), { recursive: true });
	try {
		const existing = JSON.parse(await readFile(path, "utf8")) as { profile?: string; model?: string; baseUrl?: string | null; promptVersion?: string; answerConfidenceThreshold?: number };
		if (existing.profile !== profile || existing.model !== (process.env.QWEN_MODEL || "qwen3-vl-plus") || existing.baseUrl !== safeEndpoint() || existing.promptVersion !== PROMPT_VERSION || existing.answerConfidenceThreshold !== answerConfidenceThreshold()) {
			throw new Error(`Session '${sessionId}' already exists with a different profile/model; use a new session id for comparisons`);
		}
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Session '")) throw error;
		await writeFile(path, `${JSON.stringify({ schemaVersion: 1, sessionId, profile, createdAt: new Date().toISOString(), provider: "qwen-vlm", model: process.env.QWEN_MODEL || "qwen3-vl-plus", baseUrl: safeEndpoint(), promptVersion: PROMPT_VERSION, answerConfidenceThreshold: answerConfidenceThreshold() }, null, 2)}\n`, "utf8");
	}
}

export async function appendFeedback(root: string, sessionId: string, feedback: Omit<Feedback, "createdAt"> & { runId: string }): Promise<string> {
	const path = resolve(root, sessionId, "feedback.jsonl");
	await mkdir(dirname(path), { recursive: true });
	const runs = await readRunRecords(sessionId, root);
	if (!runs.some((record) => record.runId === feedback.runId)) throw new Error(`No run '${feedback.runId}' found in session '${sessionId}'`);
	const { runId, ...values } = feedback;
	const row: Feedback & { runId: string } = { ...values, runId, createdAt: new Date().toISOString() };
	await appendFile(path, `${JSON.stringify(row)}\n`, "utf8");
	return path;
}

export async function readFeedback(sessionId: string, root = "run/experiments"): Promise<Array<Feedback & { runId: string }>> {
	try {
		const raw = await readFile(resolve(root, sessionId, "feedback.jsonl"), "utf8");
		return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Feedback & { runId: string });
	} catch { return []; }
}

export function sessionSummary(records: RunRecord[], feedbackRows: Array<Feedback & { runId: string }>) {
	const latestFeedback = new Map<string, Feedback>();
	for (const row of feedbackRows) {
		const previous = latestFeedback.get(row.runId);
		const annotator = row.annotator ?? previous?.annotator;
		latestFeedback.set(row.runId, {
			useful: row.useful ?? previous?.useful ?? null,
			perceptionCorrect: row.perceptionCorrect ?? previous?.perceptionCorrect ?? null,
			positionCorrect: row.positionCorrect ?? previous?.positionCorrect ?? null,
			decisionCorrect: row.decisionCorrect ?? previous?.decisionCorrect ?? null,
			responseCorrect: row.responseCorrect ?? previous?.responseCorrect ?? null,
			notes: row.notes ?? previous?.notes ?? null,
			...(annotator ? { annotator } : {}),
			createdAt: row.createdAt,
		});
	}
	const decisions = { answer: 0, clarify: 0, silent: 0 };
	let latencySum = 0;
	let latencyCount = 0;
	let failures = 0;
	let expectedDecisionCount = 0;
	let expectedDecisionCorrect = 0;
	let expectedTargetCount = 0;
	let expectedTargetCorrect = 0;
	for (const record of records) {
		if (record.status === "error" || !record.result) failures++;
		else { decisions[record.result.decision]++; latencySum += record.result.latencyMs; latencyCount++; }
		if (record.expected?.decision && record.result) {
			expectedDecisionCount++;
			if (record.result.decision === record.expected.decision) expectedDecisionCorrect++;
		}
		if (typeof record.expected?.targetFound === "boolean" && record.result) {
			expectedTargetCount++;
			const detected = record.result.delta.observations.some((item) => item.goalRelevant && item.frameIds.length > 0);
			if (detected === record.expected.targetFound) expectedTargetCorrect++;
		}
	}
	const labels = ["useful", "perceptionCorrect", "positionCorrect", "decisionCorrect", "responseCorrect"] as const;
	const feedback = Object.fromEntries(labels.map((field) => {
		const values = records.map((record) => latestFeedback.get(record.runId)?.[field]).filter((value): value is boolean => typeof value === "boolean");
		return [field, { labeled: values.length, positive: values.filter(Boolean).length, rate: values.length ? values.filter(Boolean).length / values.length : null }];
	}));
	return {
		runs: records.length, successful: records.length - failures, failures, decisions,
		meanLatencyMs: latencyCount ? Math.round(latencySum / latencyCount) : null,
		expectedLabels: {
			decision: { labeled: expectedDecisionCount, correct: expectedDecisionCorrect, accuracy: expectedDecisionCount ? expectedDecisionCorrect / expectedDecisionCount : null },
			targetFound: { labeled: expectedTargetCount, correct: expectedTargetCorrect, accuracy: expectedTargetCount ? expectedTargetCorrect / expectedTargetCount : null },
		},
		feedback,
	};
}

export function safeName(value: string): string {
	const name = basename(value).replace(/[^a-zA-Z0-9_.-]/g, "-");
	if (!name || name === "." || name === "..") throw new Error("Invalid session/profile name");
	return name;
}
