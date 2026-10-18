import { readFile } from "node:fs/promises";
import { copyFile, mkdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model, UserMessage } from "@earendil-works/pi-ai";
import { createQwenModel } from "./qwen-provider.js";
import {memorySummary} from './memory-summary.js';
import { matchImages } from "./image-match.js";
import { matchViews, selectCandidates } from "./place-candidates.js";
import { PlaceMemory, type PlaceNode } from "./place-memory.js";
import { aggregateHints, describeHint, parseMotionHint, type MotionHint } from "./motion-hint.js";
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
	currentPerception: CurrentPerception;
	requestDiagnostics: SceneRequestDiagnostic[];
	vlmCalls: number;
	validationRetries: Array<{ raw: string; error: string }>;
	algorithmEvidence: { available: boolean; queryViews: number; motion: string; candidates: Array<{ id: string; visual: number; inliers: number; path: number; supportedViews: number }>; warning: string };
	identityStatus: "resolved" | "unresolved";
	anchors: string[];
	localRelations: string[];
	identityReason: string;
	positionMatchEvidence: string[];
	positionalContradictions: string[];
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
	/** Real SceneAgent always uses VLM; cheap is retained for historical evaluator compatibility. */
	decidedBy: "cheap" | "vlm";
	frameIds: string[];
	raw: string;
}

export interface SceneRequestDiagnostic {
	phase?: "perception" | "identity";
	attempt: number;
	elapsedMs: number;
	raw: string;
	error: string | null;
	stopReason?: string;
}

export interface CurrentPerception {
	label: string;
	summary: string;
	objects: string[];
	anchors: string[];
	localRelations: string[];
	uncertainties: string[];
}

export function parseCurrentPerception(text: string): CurrentPerception {
	const root = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as Record<string, unknown>;
	for (const field of ["anchors", "localRelations", "uncertainties"]) {
		if (!Array.isArray(root[field]) || root[field].some(item => typeof item !== "string")) throw new Error(`perception.${field} must be a string array`);
	}
	// Perception is never a place-identity decision, even if extra ID fields
	// arrive in an otherwise valid response.
	const parsed = unresolvedScene(JSON.stringify(root));
	return { label: parsed.label, summary: parsed.summary, objects: parsed.objects, anchors: parsed.anchors, localRelations: parsed.localRelations, uncertainties: (root.uncertainties as string[]).slice(0, 4).map(item => item.slice(0, 160)) };
}

export class SceneRecognitionError extends Error {
	constructor(message: string, readonly model: string, readonly requests: SceneRequestDiagnostic[]) {
		super(message);
		this.name = "SceneRecognitionError";
	}
}

export const SYSTEM_PROMPT = [
	"You perform PLACE RECOGNITION for a first-person assistant: decide which place the user is in now.",
	"You are shown the current camera frames (chronological), the PREVIOUS place and its stored view, a short list of CANDIDATE places, how the phone moved (MOTION / MOTION_HINT), and sometimes a MATCH hint from local-feature matching.",
	"Choose one of four honest decisions: same, known, new, or unresolved.",
	"Judge by the images and the motion. Then:",
	"- If the phone only TURNED or stayed still (MOTION_HINT: turn, little/no translation), it is usually still the SAME place, even if the view looks different.",
	"DEFINITION: Place is a repeatable LOCAL ACTIVITY REGION around stable anchors, within which observer-to-anchor, aisle and boundary relationships remain compatible. It contains multiple nearby standing positions and viewing directions; it is NOT a precise point, image, orientation or entire room. Describe current evidence independently before comparing identities.",
	"If the observer occupies a CLEARLY DIFFERENT local ACTIVITY REGION, choose a different Place EVEN WHEN images share surfaces, objects or high visual similarity. Beside a table versus across the aisle from it are different regions; neighboring positions along the same table-side area need not be. Only use supported relations; never invent unseen locations or metric distances.",
	"Rotation, framing or newly visible objects alone do not establish a different position. Weak motion cannot override clear positional evidence. Returning to the same local position can reuse its Place despite a different viewing direction.",
	"Missing motion measurements mean UNKNOWN, not stationary. Never infer 'no translation occurred' from missing sensors. localRelations must concern OBSERVER-to-anchor position (beside, across an aisle, on this side of a doorway), not object-to-object arrangement or image left/right. Screen layout alone does not establish observer position. State unknown when evidence is insufficient.",
	"An image may be a labeled LEFT / FRONT / RIGHT triptych: all three panels are simultaneous views from ONE observer position, at yaw offsets -90/0/+90 degrees. Treat them as one observation, not three positions. Use side views to establish nearby boundaries and observer-to-anchor relations. These labels are relative camera bearings, not world coordinates.",
	"Space groups DISTINCT Places that are demonstrably adjacent and belong to the same spatial scope. It is NOT necessarily a room and may span room boundaries. Shared visual content or a room label alone does not establish Space membership. Same Space NEVER implies same Place.",
	"Matching surfaces only prove shared visible content, not camera occupancy: two places across a doorway can see the same surface. Large motion can stay within a room; small motion can cross a boundary. Motion magnitude never determines identity.",
	"REGION RULES: turning around, changing image left/right, small repositioning beside the same anchor, or exposing previously hidden objects does NOT create a Place. Crossing an aisle, moving to the other side of an anchor/boundary, or entering a distinct anchor-centered activity region CAN create one even with similar images. Compare rotation-invariant region relations, not exact screen arrangement. Example: several positions between sofa and coffee table are one Place; across the coffee table beside the exit is another.",
	"NEW requires positive region-change evidence, not merely failure to prove an old identity. On the first observation with no previous identity, visible evidence establishing the current activity region is sufficient. SAME/KNOWN requires concrete compatible regional relationships, but not two exact point-position matches. Missing evidence => decision unresolved with confidence below 0.6; the system may retain a temporary association without claiming verified sameness.",
	"Extract anchors ONLY from CURRENT image evidence, never copy invisible reference anchors into the current description. List positionalContradictions when an old identity conflicts with current position evidence. If any such contradiction remains unresolved, do not reuse that identity. Distinct related Places can later be grouped into Space without losing local identities.",
	"Use the chronological sequence to reason about boundary crossing, occlusion and near-object relationships. If identity is ambiguous, return decision unresolved, seenBeforeSceneId:null and confidence below 0.6. Do not force an identity. Always include a non-empty descriptive place and a summary, even for unresolved.",
	'Reply with ONLY JSON: {"decision":"same"|"known"|"new"|"unresolved", "place":string,"summary":string,"objects":string[],"anchors":string[],"localRelations":string[],"identityReason":string,"positionMatchEvidence":string[],"positionalContradictions":string[],"regionChangeEvidence":string[],"seenBeforeSceneId":string|null,"confidence":number}. decision is authoritative: same means PREVIOUS_PLACE; known requires a supplied candidate ID; new requires positive regionChangeEvidence and null ID; unresolved means insufficient evidence and null ID. Never say new while returning an old ID. List contradictions against old regions separately from the chosen new region. place is a descriptive activity-region label, NOT an ID. No markdown; concise reason, up to four evidence items each.',
].join(" ");

const MAX_CANDIDATES = 5;
const CLEAR_MATCH_INLIERS = 15;

function mimeTypeFor(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".jpg": case ".jpeg": return "image/jpeg";
		case ".png": return "image/png";
		case ".webp": return "image/webp";
		default: return "image/jpeg";
	}
}

async function promptWithTimeout(agent: Agent, message: UserMessage): Promise<void> {
	const configured = Number(process.env.SCENE_VLM_TIMEOUT_MS ?? 120000);
	const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : 120000;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			agent.prompt(message),
			new Promise<never>((_, reject) => { timer = setTimeout(() => { agent.abort(); reject(new Error(`Scene VLM timed out after ${timeoutMs}ms`)); }, timeoutMs); }),
		]);
	} finally { if (timer) clearTimeout(timer); }
}

interface ParsedScene {
	positionMatchEvidence: string[];
	positionalContradictions: string[];
	anchors: string[];
	localRelations: string[];
	identityReason: string;
	label: string;
	summary: string;
	objects: string[];
	seenBeforeSceneId: string | null;
	samePlaceAsPrevious: boolean | null;
	confidence: number;
}

export function parseScene(text: string, candidateIds: Set<string>, previousId?: string | null): ParsedScene {
	const jsonText = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
	const root = JSON.parse(jsonText) as Record<string, unknown>;
	const label = typeof root.place === "string" ? root.place : root.label;
	if (typeof label !== "string" || !label.trim()) throw new Error("scene place must be a non-empty string");
	if (typeof root.summary !== "string") throw new Error("scene.summary must be a string");
	const objects = Array.isArray(root.objects) ? root.objects.filter((value) => typeof value === "string").slice(0, 8).map((value) => (value as string).slice(0, 60)) : [];
	const rawMatched = typeof root.seenBeforeSceneId === "string" ? root.seenBeforeSceneId : root.matchedSceneId;
	let seenBeforeSceneId = typeof rawMatched === "string" && candidateIds.has(rawMatched) ? rawMatched : null;
	let samePlaceAsPrevious = typeof root.samePlaceAsPrevious === "boolean"
		? root.samePlaceAsPrevious
		: typeof root.changed === "boolean" ? !root.changed : null;
	const confidence = typeof root.confidence === "number" && root.confidence >= 0 && root.confidence <= 1 ? root.confidence : 0.5;
	const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 4).map(item => item.trim().slice(0, 160)).filter(Boolean) : [];
	const positionMatchEvidence = strings(root.positionMatchEvidence), positionalContradictions = strings(root.positionalContradictions);
	if (root.decision !== undefined) {
		if (root.decision === "new") {
			const initialRegion = !previousId && candidateIds.size === 0 && strings(root.anchors).length > 0 && strings(root.localRelations).length > 0;
			if (rawMatched != null || (!initialRegion && strings(root.regionChangeEvidence).length === 0)) throw new Error("New region requires change evidence and no old ID");
			samePlaceAsPrevious = false; seenBeforeSceneId = null;
		} else if (root.decision === "unresolved") { samePlaceAsPrevious = null; seenBeforeSceneId = null; }
		else if (root.decision === "same" || root.decision === "known") {
			if (positionMatchEvidence.length === 0 || positionalContradictions.length > 0) throw new Error("Reuse has missing support or unresolved contradictions");
			if (root.decision === "same") {
				if (!previousId || (rawMatched != null && rawMatched !== previousId)) throw new Error("Same decision conflicts with previous ID");
				samePlaceAsPrevious = true; seenBeforeSceneId = previousId;
			} else {
				if (!seenBeforeSceneId) throw new Error("Known decision requires a visible candidate ID");
				samePlaceAsPrevious = seenBeforeSceneId === previousId;
			}
		} else throw new Error("Invalid identity decision");
	}
	const insufficientReuse = (samePlaceAsPrevious === true || seenBeforeSceneId !== null) && (positionMatchEvidence.length === 0 || positionalContradictions.length > 0);
	return { positionMatchEvidence, positionalContradictions, anchors: strings(root.anchors), localRelations: strings(root.localRelations), identityReason: typeof root.identityReason === "string" ? root.identityReason.slice(0, 500) : "", label: label.trim().slice(0, 120), summary: root.summary.trim().slice(0, 300), objects, seenBeforeSceneId: insufficientReuse ? null : seenBeforeSceneId, samePlaceAsPrevious: insufficientReuse ? null : samePlaceAsPrevious, confidence: insufficientReuse ? Math.min(confidence, 0.59) : confidence };
}

/** Salvage perception, never identity, after a failed decision re-verification. */
export function unresolvedScene(text: string): ParsedScene {
	const root = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as Record<string, unknown>;
	return parseScene(JSON.stringify({ ...root, decision: "unresolved", seenBeforeSceneId: null, matchedSceneId: null, samePlaceAsPrevious: null, changed: undefined, confidence: 0 }), new Set());
}

export class SceneAgent {
	private readonly model: Model<"openai-completions">;
	private readonly streamFn: Agent["streamFunction"];
	private readonly memory: PlaceMemory;
	private loaded = false;
	private repCounter = 1;
	private hintBuffer: MotionHint[] = [];

	constructor(private readonly memoryDir: string | null = null, storePath: string | null = null) {
		const configured = createQwenModel(1024,false,false,undefined,undefined,()=>memorySummary(this.memory.getState().scenes.map(s=>({id:s.id,atMs:s.lastVisitedAt,text:s.summary,kind:'working-memory' as const})),Date.now()));
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

	async groupPlaces(ids: string[], label: string, reason: string, evidenceIds: string[]) {
		await this.load();
		return this.memory.groupPlaces(ids, label, reason, evidenceIds);
	}

	async mergePlaces(source: string, target: string, reason: string, evidenceIds: string[]) {
		await this.load();
		await this.memory.mergePlaces(source, target, reason, evidenceIds);
	}

	async rebindVisits(ids: string[], target: string, reason: string, evidenceIds: string[]) {
		await this.load();
		await this.memory.rebindVisits(ids, target, reason, evidenceIds);
	}

	async undoLastRevision(reason: string) { await this.load(); await this.memory.undoLastRevision(reason); }
	async splitVisit(visit: string, observation: string, target: string, reason: string, evidence: string[]) {
		await this.load(); await this.memory.splitVisit(visit, observation, target, reason, evidence);
	}

	/** Bounded, conservative VLM maintenance. Ground truth is never part of this input. */
	async reviewMemory(): Promise<void> {
		await this.reviewMemoryPhase("identity");
		await this.reviewMemoryPhase("space");
	}

	private async reviewMemoryPhase(phase: "identity" | "space"): Promise<void> {
		await this.load();
		const state = this.memory.getState();
		const historical = state.observations.filter((_, index) => index % Math.max(1, Math.floor(state.observations.length / 6)) === 0).slice(0, 6);
		const rows = [...new Map([...historical, ...state.observations.slice(-6)].map(row => [row.id, row])).values()].sort((a, b) => a.atMs - b.atMs);
		if (rows.length < 2) return;
		const evidenceIds = rows.map(row => row.id);
		const images: ImageContent[] = [];
		const imageLabels: string[] = [];
		// Preserve a chronological before/after sequence, bounded to eight images.
		const selected = rows.filter((_, index) => index === 0 || index === rows.length - 1 || index % 2 === 0).slice(-8);
		for (const row of selected) {
			const frame = row.frames.at(-1);
			if (!frame?.path) continue;
			try {
				images.push({ type: "image", data: (await readFile(frame.path)).toString("base64"), mimeType: mimeTypeFor(frame.path) });
				imageLabels.push(`${row.id} place=${row.placeId} visit=${row.visitId}`);
			} catch { /* Missing evidence cannot support an edit. */ }
		}
		if (images.length < 2) return;
		const validSplitBoundaries = rows.filter(row => state.observations.find(item => item.visitId === row.visitId)?.id !== row.id).map(row => ({ visitId: row.visitId, observationId: row.id }));
		const visits = state.scenes.flatMap(place => place.visits);
		const adjacencyCandidates = state.transitionExperiences.map(edge => ({ from: visits.find(visit => visit.id === edge.fromVisitId)?.sceneId, to: visits.find(visit => visit.id === edge.toVisitId)?.sceneId, motion: edge.description, confirmed: edge.confirmed })).filter(edge => edge.from && edge.to && edge.from !== edge.to);
		const prompt = JSON.stringify({ phase, places: state.scenes.map(place => ({ id: place.id, label: place.label, summary: place.summary, anchors: place.anchors, localRelations: place.localRelations, spaceId: place.spaceId })), spaces: state.spaces, adjacencyCandidates, observations: rows.map(row => ({ id: row.id, placeId: row.placeId, visitId: row.visitId, anchors: row.anchors, localRelations: row.localRelations, identityReason: row.identityReason, motion: row.description, decision: row.decision })), imageOrder: imageLabels, validSplitBoundaries, previousReview: state.reviews.at(-1) });
		const verifier = new Agent({ initialState: { model: this.model, tools: [], systemPrompt: [
			"Place is a LOCAL ACTIVITY REGION with compatible anchor/aisle/boundary relations, containing nearby standing positions and all viewing directions. Do not split merely for rotation or small repositioning. Space groups distinct adjacent regions in one continuous spatial scope, not necessarily one room.",
			phase === "space" ? "DEDICATED SPACE PASS: only action group or none is allowed. Explicitly examine adjacent distinct Places for common spatial scope; grouping retains their identities. Do not invent grouping evidence or group solely to reduce node count." : "DEDICATED IDENTITY PASS: only merge, rebind, split or none is allowed. Merge duplicate local regions; do not merge distinct neighboring regions. Space grouping happens in a separate pass.",
			"Similar images with clearly different ACTIVITY REGIONS must retain different Places. Different headings and nearby positions within the same region should not remain duplicates solely because views differ. Group only if physical adjacency AND shared spatial scope are supported. Cross-room grouping is allowed. A route, shared objects, or room category alone is insufficient. Same Space does not justify Place merging.",
			"Prefer no edit when ambiguous. Propose at most ONE edit. A merge requires repeated evidence of the SAME local observation area, not merely the same room. Rebind only when a whole visit was misassigned; split only at an existing observation inside a visit. If one Place has swallowed distinct areas, propose split with targetId:null and a local-area label to create a NEW provisional Place. A single Place can be wrong; review it too.",
			"SPLIT SEMANTICS: the original visit keeps its PREFIX; the NEW target receives the entire SUFFIX starting at observationId, including ALL later observations of that visit. Select ONLY a validSplitBoundaries pair. Never select the first observation of a visit. Label the SUFFIX, not the prefix. Prior decisions may be wrong; independently inspect images rather than treating their agreement as proof. If a previous proposal was rejected, correct that error rather than repeating it.",
			'Return JSON only: {"action":"none"|"group"|"merge"|"rebind"|"split","placeIds":string[],"targetId":string|null,"visitIds":string[],"observationId":string|null,"label":string,"confidence":number,"reason":string,"evidenceIds":string[],"adjacencyEvidence":string,"spatialScopeEvidence":string}. Group requires non-empty adjacencyEvidence AND spatialScopeEvidence with specific image/sequence evidence covering ALL members. Reference only supplied IDs. Include at least two supporting observation IDs for an edit. Keep the reason concise.',
			phase === "space" ? 'FINAL SPACE CONTRACT: action MUST be "group" or "none", NEVER merge/split/rebind. If places are duplicates, return none; identity repair handles duplicates. For distinct adjacent regions sharing one scope, propose group with all member IDs and both adjacency/scope evidence. A previous identity proposal does not authorize it in this phase.' : 'FINAL IDENTITY CONTRACT: action MUST be "merge", "split", "rebind" or "none", NEVER group. For merge, targetId is the retained region ID; placeIds contains ONLY the discarded source ID, not targetId. Different orientations and small positions inside one region are compatible.',
		].join(" ") }, streamFn: this.streamFn });
		let raw = "", applied = false, error: string | null = null;
		try {
			const content: UserMessage["content"] = [{ type: "text", text: prompt }];
			for (const [index, image] of images.entries()) content.push({ type: "text", text: `REVIEW observation image: ${imageLabels[index]}` }, image);
			await promptWithTimeout(verifier, { role: "user", content, timestamp: Date.now() });
			if (verifier.state.errorMessage) throw new Error(verifier.state.errorMessage);
			const message = [...verifier.state.messages].reverse().find(item => item.role === "assistant");
			if (!message || message.role !== "assistant") throw new Error("Missing review response");
			raw = message.content.filter(block => block.type === "text").map(block => block.text).join("\n");
			const result = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { action: string; placeIds: string[]; targetId: string; visitIds: string[]; observationId: string; label: string; confidence: number; reason: string; evidenceIds: string[]; adjacencyEvidence?: string; spatialScopeEvidence?: string };
			if (result.action !== "none") {
				if ((phase === "space") !== (result.action === "group")) throw new Error("Action belongs to another maintenance phase");
				const evidence = [...new Set(result.evidenceIds)];
				if (evidence.length < 2 || evidence.some(id => !evidenceIds.includes(id))) throw new Error("Insufficient review evidence");
				if (typeof result.confidence !== "number" || result.confidence < (result.action === "merge" ? 0.95 : 0.85)) throw new Error("Review below confidence threshold");
				if (result.action === "group") {
					if (!result.adjacencyEvidence?.trim() || !result.spatialScopeEvidence?.trim()) throw new Error("Space requires adjacency and shared-scope evidence");
					await this.memory.groupPlaces(result.placeIds, result.label, `${result.reason}; adjacency: ${result.adjacencyEvidence}; spatial scope: ${result.spatialScopeEvidence}`, evidence);
				}
				else if (result.action === "merge") {
					const visits = new Set(rows.filter(row => evidence.includes(row.id)).map(row => row.visitId));
					const sources = [...new Set(result.placeIds.filter(id => id !== result.targetId))];
					if (visits.size < 2 || sources.length !== 1) throw new Error("Merge requires repeated visits and one source");
					await this.memory.mergePlaces(sources[0]!, result.targetId, result.reason, evidence);
				} else if (result.action === "rebind") await this.memory.rebindVisits(result.visitIds, result.targetId, result.reason, evidence);
				else if (result.action === "split") await this.memory.splitVisit(result.visitIds[0]!, result.observationId, result.targetId, result.reason, evidence, result.label);
				else throw new Error("Unknown review action");
				applied = true;
			}
		} catch (cause) { error = String(cause); }
			await this.memory.recordReview(evidenceIds, raw, applied, error);
	}

	async observe(frames: FrameRef[], motionDescription: string | null): Promise<SceneResult> {
		await this.load();
		if (frames.length === 0) throw new Error("SceneAgent needs at least one frame");
		const state = this.memory.getState();
		if (state.observations.length > 0 && state.observations.length % 12 === 0 && state.reviews.at(-1)?.evidenceIds.at(-1) !== state.observations.at(-1)?.id) await this.reviewMemory();
		const ordered = frames.slice().sort((a, b) => a.timestampMs - b.timestampMs).slice(-4);
		const imageContents: ImageContent[] = await Promise.all(ordered.map(async (frame) => ({
			type: "image" as const, data: (await readFile(frame.path)).toString("base64"), mimeType: mimeTypeFor(frame.path),
		})));
		const historyImages: Array<{ label: string; image: ImageContent }> = [];
		const requestDiagnostics: SceneRequestDiagnostic[] = [];
		// Only the endpoint image enters this stage: no previous IDs, reference
		// images, motion, candidate labels or remembered anchors are supplied.
		let currentPerception: CurrentPerception | undefined;
		const perceptionContent: UserMessage["content"] = [
			{ type: "text", text: 'Describe only visible CURRENT evidence. Return JSON {"place":string,"summary":string,"objects":string[],"anchors":string[],"localRelations":string[],"uncertainties":string[]}. place is a descriptive activity-region label, never an ID. localRelations describe observer-to-visible-anchor or boundary relations, not merely image left/right. Up to four items per array. If a relation is unsupported, leave it out and state uncertainty. Always include a non-empty place (use "unknown activity region" when necessary) and summary.' },
			imageContents.at(-1)!,
		];
		for (let attempt = 0; attempt < 2; attempt++) {
			const observer = new Agent({ initialState: { systemPrompt: "Independently inspect a first-person CURRENT image. There is no memory or previous place. If labeled LEFT/FRONT/RIGHT panels are present, they are simultaneous views from one optical center. Never infer invisible objects, motion or a historical identity. Describe qualitative visible anchors, boundaries and supported observer relations only.", model: this.model, tools: [] }, streamFn: this.streamFn });
			const started = Date.now();
			const diagnostic: SceneRequestDiagnostic = { phase: "perception", attempt: attempt + 1, elapsedMs: 0, raw: "", error: null };
			requestDiagnostics.push(diagnostic);
			try {
				await promptWithTimeout(observer, { role: "user", content: perceptionContent, timestamp: Date.now() });
				if (observer.state.errorMessage) throw new Error(observer.state.errorMessage);
				const response = [...observer.state.messages].reverse().find(message => message.role === "assistant");
				if (!response || response.role !== "assistant") throw new Error("No current perception response");
				diagnostic.raw = response.content.filter(block => block.type === "text").map(block => block.text).join("\n");
				diagnostic.stopReason = response.stopReason;
				try { currentPerception = parseCurrentPerception(diagnostic.raw); }
				catch (error) {
					diagnostic.error = String(error);
					if (attempt >= 1) throw error;
					perceptionContent.push({ type: "text", text: `Previous response: ${diagnostic.raw}\nFormat error: ${String(error)}. Return the complete required perception JSON. Do not invent evidence.` });
				}
			} catch (error) {
				diagnostic.error = String(error);
				throw new SceneRecognitionError(String(error), this.model.id, requestDiagnostics);
			} finally { diagnostic.elapsedMs = Date.now() - started; }
			if (currentPerception) break;
		}
		if (!currentPerception) throw new SceneRecognitionError("No valid current perception", this.model.id, requestDiagnostics);

		// --- Candidate generation: union of path-consistent and visually similar places ---
		const previousSceneId = this.memory.getState().currentSceneId;
		const hint = parseMotionHint(motionDescription);
		this.hintBuffer.push(hint);
		if (this.hintBuffer.length > 3) this.hintBuffer.shift();
		const expected = this.memory.expectedNext(previousSceneId, hint);
		const pathSimById = new Map<string, number>(expected.map((item) => [item.sceneId, item.pathSim]));
		const seenCandidate = new Set<string>();
		const candidateScenes: PlaceNode[] = [];
		const addCandidate = (scene: PlaceNode | null): void => {
			if (!scene || seenCandidate.has(scene.id)) return;
			seenCandidate.add(scene.id); candidateScenes.push(scene);
		};
		for (const item of expected) addCandidate(this.memory.getScene(item.sceneId));
		for (const neighbor of this.memory.neighbors(previousSceneId)) addCandidate(this.memory.getScene(neighbor.sceneId));
		for (const scene of this.memory.candidates(previousSceneId, MAX_CANDIDATES)) addCandidate(scene);
		for (const scene of this.memory.listScenes()) addCandidate(scene);
		const representatives = candidateScenes.flatMap(scene => [...new Map([scene.frames[0], ...scene.frames.slice(-2)].filter(rep => rep !== undefined).map(rep => [rep.id, rep])).values()].map(rep => ({ scene, rep })));
		const candidates = representatives.flatMap(({ scene, rep }) => matchViews(rep).map(view => ({ id: scene.id, path: view.path })));
		// Candidate identity concerns the final observation, not an earlier region
		// passed through within this motion window. Compare all directions there.
		const queryViews = [...new Map(matchViews(ordered.at(-1)!).map(view => [view.path, view])).values()];

		// --- Cheap scoring: visual similarity and path similarity, kept SEPARATE ---
		const visualById = new Map<string, number>();
		const inliersById = new Map<string, number>();
		const supportById = new Map<string, Set<string>>();
		const directionsById = new Map<string, Set<string>>();
		const matchedRepresentatives = new Map<string, string>();
		const bestPairSimilarity = new Map<string, number>();
		let algorithmAvailable = false;
		let match: { sceneId: string; inliers: number } | null = null;
		if (candidates.length) {
			const response = await matchImages(queryViews.map(view => view.path), candidates, { minInliers: CLEAR_MATCH_INLIERS, maxDim: 640, timeoutMs: 60000 });
			algorithmAvailable = response.ok;
			for (const entry of response.results) {
				visualById.set(entry.id, Math.max(visualById.get(entry.id) ?? 0, entry.similarity));
				if (entry.inliers > (inliersById.get(entry.id) ?? -1) || (entry.inliers === inliersById.get(entry.id) && entry.similarity > (bestPairSimilarity.get(entry.id) ?? -1))) {
					inliersById.set(entry.id, entry.inliers);
					bestPairSimilarity.set(entry.id, entry.similarity);
					const rep = representatives.find(item => item.scene.id === entry.id && matchViews(item.rep).some(view => view.path === entry.path));
					if (rep) matchedRepresentatives.set(entry.id, rep.rep.path);
				}
				if (entry.inliers >= CLEAR_MATCH_INLIERS && entry.queryPath) {
					const supported = supportById.get(entry.id) ?? new Set<string>();
					const queryDirection = queryViews.find(view => view.path === entry.queryPath)?.view ?? "unknown";
					const referenceDirection = representatives.flatMap(item => matchViews(item.rep)).find(view => view.path === entry.path)?.view ?? "unknown";
					supported.add(queryDirection);
					supportById.set(entry.id, supported);
					const directions = directionsById.get(entry.id) ?? new Set<string>();
					directions.add(`${queryDirection} -> historical ${referenceDirection}`);
					directionsById.set(entry.id, directions);
				}
			}
			if (response.best) match = { sceneId: response.best.id, inliers: response.best.inliers };
		}
		const scored = candidateScenes.map(scene => ({ id: scene.id, scene, visual: visualById.get(scene.id) ?? 0, inliers: inliersById.get(scene.id) ?? 0, path: pathSimById.get(scene.id) ?? 0, supportedViews: supportById.get(scene.id)?.size ?? 0, matchedDirections: [...(directionsById.get(scene.id) ?? [])] }));
		const shown = selectCandidates(scored, previousSceneId, algorithmAvailable);
		const algorithmEvidence = { available: algorithmAvailable, queryViews: queryViews.length, motion: !motionDescription ? "unknown" : /turned/i.test(motionDescription) && !/moved/i.test(motionDescription) ? "rotation_only_candidate" : /moved/i.test(motionDescription) ? "translation_candidate" : "still_or_unknown", candidates: shown.map(({ scene: _scene, ...score }) => score), warning: "Cross-view overlap proves shared visible surfaces only, not camera occupancy. Relative LEFT/RIGHT can swap after turning. No algorithm auto-accepts identity." };

		const previous = previousSceneId ? this.memory.getScene(previousSceneId) : null;
		// The VLM ALWAYS verifies the place identity (first version: no cheap auto-accept).
		const candidateIds = new Set(shown.map((item) => item.scene.id));
		if (previous) candidateIds.add(previous.id);
		let raw = "";
		let parsed: ParsedScene;
		const promptLines = [
			`INDEPENDENT_CURRENT_PERCEPTION (endpoint image only, extracted without any memory): ${JSON.stringify(currentPerception)}. Use these visible anchors and supported observer relations as current evidence. Historical anchors absent from this evidence are UNKNOWN, never implied to be nearby/off-screen. Unknown relation is not positive SAME evidence and not automatic NEW evidence. Do not expand current perception from reference images.`,
			`ALGORITHM_SCREEN (all supplied directions compared cross-direction; independent signals): ${JSON.stringify(algorithmEvidence)}`,
			"Identify the local place occupied in CURRENT frames. REFERENCE images come first, CURRENT chronological frames come LAST. Every image has its own preceding role label. Reference images are historical, never evidence that their anchors are currently visible.",
			`PREVIOUS_PLACE: ${previous ? JSON.stringify({ id: previous.id, label: previous.label, summary: previous.summary, anchors: previous.anchors, localRelations: previous.localRelations }) : "none"}`,
			`CANDIDATES (visual/path scores are weak cues, not positional identity): ${JSON.stringify(shown.map((item) => ({ id: item.scene.id, label: item.scene.label, anchors: item.scene.anchors, localRelations: item.scene.localRelations, visual: item.visual, path: item.path })))}`,
			`MOTION (approximate): ${motionDescription ?? "UNKNOWN: no motion measurements supplied; do not infer stationary"}`,
			`MOTION_HINT: ${motionDescription ? describeHint(hint) : "UNKNOWN (not evidence of no translation)"}`,
		];
		if (previous && previous.frames.length) {
			const prevPath = matchedRepresentatives.get(previous.id) ?? previous.frames[previous.frames.length - 1]!.path;
			try {
				historyImages.push({ label: `REFERENCE PREVIOUS_PLACE ${previous.id} "${previous.label}". HISTORICAL IMAGE, NOT CURRENT.`, image: { type: "image", data: (await readFile(prevPath)).toString("base64"), mimeType: mimeTypeFor(prevPath) } });
			} catch { /* ignore */ }
		}
		if (expected.length) {
			promptLines.push(`EXPECTED_NEXT (from past trips out of the previous place with similar motion): ${expected.slice(0, 3).map((item) => `${item.sceneId} (usual path: ${item.path})`).join("; ")}.`);
		}
		for (const candidate of shown) {
			if (candidate.scene.id === previous?.id) continue;
			const repPath = matchedRepresentatives.get(candidate.scene.id) ?? candidate.scene.frames.at(-1)?.path;
			if (repPath) {
				try {
					historyImages.push({ label: `REFERENCE CANDIDATE ${candidate.scene.id} "${candidate.scene.label}". HISTORICAL IMAGE, NOT CURRENT.`, image: { type: "image", data: (await readFile(repPath)).toString("base64"), mimeType: mimeTypeFor(repPath) } });
				} catch { /* ignore */ }
			}
		}
		promptLines.push("Reply with only the JSON object.");
		const prompt = promptLines.join("\n\n");
		const content: UserMessage["content"] = [{ type: "text", text: prompt }];
		for (const item of historyImages) content.push({ type: "text", text: item.label }, item.image);
		for (const [index, image] of imageContents.entries()) content.push({ type: "text", text: `CURRENT ${index + 1}/${imageContents.length}, frame ${ordered[index]!.id}. CURRENT observed image; final CURRENT frame is the target position.` }, image);
		content.push({ type: "text", text: "Judge the LAST CURRENT observation's local ACTIVITY REGION, not an exact point or reference picture. New requires positive region-change evidence; turning and small repositioning alone do not split. Never import invisible reference anchors. Reply JSON only." });
		let identityCalls = requestDiagnostics.length;
		const validationRetries: Array<{ raw: string; error: string }> = [];
		for (let attempt = 0; ; attempt++) {
			// Fresh history on retry: content already contains all images and
			// the correction. Accumulating it doubles the visual context.
			const agent = new Agent({ initialState: { systemPrompt: SYSTEM_PROMPT, model: this.model, tools: [] }, streamFn: this.streamFn });
			const started = Date.now();
			const diagnostic: SceneRequestDiagnostic = { phase: "identity", attempt: attempt + 1, elapsedMs: 0, raw: "", error: null };
			requestDiagnostics.push(diagnostic);
			identityCalls++;
			try {
				await promptWithTimeout(agent, { role: "user", content, timestamp: Date.now() });
				if (agent.state.errorMessage) throw new Error(`SceneAgent request failed: ${agent.state.errorMessage}`);
				const assistant = [...agent.state.messages].reverse().find(message => message.role === "assistant");
				if (!assistant || assistant.role !== "assistant") throw new Error("SceneAgent returned no assistant message");
				raw = assistant.content.filter(block => block.type === "text").map(block => block.text).join("\n");
				diagnostic.raw = raw;
				diagnostic.stopReason = assistant.stopReason;
			} catch (error) {
				diagnostic.error = String(error);
				throw new SceneRecognitionError(String(error), this.model.id, requestDiagnostics);
			} finally { diagnostic.elapsedMs = Date.now() - started; }
			try { parsed = parseScene(raw, candidateIds, previousSceneId); break; }
			catch (error) {
				diagnostic.error = String(error);
				validationRetries.push({ raw, error: String(error) });
				if (attempt >= 1) {
					try { parsed = unresolvedScene(raw); break; }
					catch (fallbackError) { throw new SceneRecognitionError(String(fallbackError), this.model.id, requestDiagnostics); }
				}
				content.push({ type: "text", text: `Your previous response was: ${raw}\nValidation error: ${String(error)}. Return the complete required JSON with a non-empty descriptive place and summary. Reinspect CURRENT images and choose one consistent decision. Positive region change must not be silently downgraded to a previous-place association. If you cannot resolve the contradiction, explicitly choose unresolved; do not invent evidence to preserve an old ID.` });
			}
		}
		const unresolved = parsed.samePlaceAsPrevious === null && !parsed.seenBeforeSceneId;

		const now = ordered.at(-1)!.timestampMs;
		let sceneId: string;
		let isNew: boolean;
		if (parsed.samePlaceAsPrevious === true && previousSceneId && this.memory.getScene(previousSceneId)) {
			sceneId = previousSceneId; isNew = false;
		} else if (parsed.seenBeforeSceneId) {
			sceneId = parsed.seenBeforeSceneId; isNew = false;
		} else {
			// Unresolved observation may provisionally remain attached to the previous
			// region; this is NOT a VLM-confirmed same-place claim.
			if (parsed.samePlaceAsPrevious === null && previousSceneId) { sceneId = previousSceneId; isNew = false; }
			else { sceneId = ""; isNew = true; }
		}
		const provisional = isNew || parsed.confidence < 0.85 || (parsed.samePlaceAsPrevious === null && !parsed.seenBeforeSceneId);
		// A reuse verdict is not permission to redefine a confirmed region.
		// Keep current perception on the observation; identity repair is separate.
		const existing = isNew ? null : this.memory.getScene(sceneId);
		const protectIdentity = existing && !existing.provisional;
		const stored = this.memory.ensureScene(isNew ? null : sceneId, protectIdentity ? existing.label : currentPerception.label, protectIdentity ? existing.summary : currentPerception.summary, protectIdentity ? existing.objects : currentPerception.objects, now, provisional);
		if (isNew || (!protectIdentity && !provisional)) { stored.anchors = currentPerception.anchors; stored.localRelations = currentPerception.localRelations; }
		sceneId = stored.id;

		const representative = ordered.at(-1)!;
		if (!unresolved) await this.rememberFrames(sceneId, ordered);
		const remembered = this.memory.getScene(sceneId)?.frames.find(frame => frame.id === representative.id);
		const isTransition = previousSceneId !== null && sceneId !== previousSceneId;
		const edgeHint = isTransition ? aggregateHints(this.hintBuffer) : hint;
		await this.memory.onSceneResolved(sceneId, representative.id, edgeHint, motionDescription, now, {
			frames: ordered.map(frame => frame.id === representative.id && remembered ? remembered : ({ id: frame.id, path: frame.path, matchViews: matchViews(frame) })), confidence: parsed.confidence, raw,
			uncertain: provisional,
			identityStatus: unresolved ? "unresolved" : "resolved",
			anchors: currentPerception.anchors, localRelations: currentPerception.localRelations, identityReason: parsed.identityReason,
		});
		if (isTransition) this.hintBuffer = [];

		const sameAsPrevious = !unresolved && previousSceneId !== null && sceneId === previousSceneId;
		const changed = previousSceneId !== null && sceneId !== previousSceneId;
		const revisited = !unresolved && !isNew && !sameAsPrevious;
		return {
			currentPerception,
			requestDiagnostics,
			vlmCalls: identityCalls, validationRetries,
			algorithmEvidence,
			identityStatus: unresolved ? "unresolved" : "resolved",
			positionMatchEvidence: parsed.positionMatchEvidence, positionalContradictions: parsed.positionalContradictions,
			anchors: currentPerception.anchors, localRelations: currentPerception.localRelations, identityReason: parsed.identityReason,
			sceneId, label: stored.label, summary: stored.summary, objects: stored.objects,
			isNew, sameAsPrevious, revisited, matchedSceneId: isNew ? null : sceneId,
			changed, confidence: parsed.confidence, match, provisional, decidedBy: "vlm", frameIds: [representative.id], raw,
		};
	}

	private async rememberFrames(sceneId: string, ordered: FrameRef[]): Promise<void> {
		if (!this.memoryDir) return;
		const picks = [ordered.at(-1)!];
		for (const frame of picks) {
			try {
				const directory = resolve(this.memoryDir, sceneId);
				await mkdir(directory, { recursive: true });
				const path = resolve(directory, `rep-${Date.now()}-${this.repCounter++}${extname(frame.path) || ".jpg"}`);
				await copyFile(frame.path, path);
				const views = [];
				for (const view of matchViews(frame)) {
					const viewPath = `${path}.${view.view}.jpg`;
					await copyFile(view.path, viewPath);
					views.push({ view: view.view, path: viewPath });
				}
				this.memory.addRepresentative(sceneId, { id: frame.id, path, matchViews: views });
			} catch { /* best effort */ }
		}
	}
}
