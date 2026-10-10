import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { describeHint, hintSimilarity, type Bin3, type Compass8, type LevelChange, type MotionHint, type TurnAmount, type TurnDir } from "./motion-hint.js";

/**
 * Persistent place memory: places (nodes), visits, and transitions (edges that
 * carry the *usual path* between two places).
 *
 * There are no coordinates. A place is an identity; a visit is one occasion of
 * being there; a transition edge records how one usually gets from A to B as a
 * qualitative path (e.g. "turned left ~90°, then forward ~4 steps").
 */

export interface PlaceRepresentative {
	matchPath?: string;
	matchViews?: Array<{ view: "front" | "left" | "right"; path: string }>;
	id: string;
	path: string;
}

export interface PlaceVisit {
	id: string;
	sceneId: string;
	startMs: number;
	endMs: number | null;
	entryFrame: string | null;
	exitFrame: string | null;
	representativeFrames: string[];
	changes: Array<{ atMs: number; what: string; via: string }>;
	previousSceneId: string | null;
	nextSceneId: string | null;
}

export interface Neighbor {
	sceneId: string;
	count: number;
}

export interface PlaceNode {
	anchors?: string[];
	localRelations?: string[];
	spaceId?: string | null;
	mergedInto?: string | null;
	id: string;
	label: string;
	summary: string;
	objects: string[];
	/** Representative views for image memory (path on disk). */
	frames: PlaceRepresentative[];
	visits: PlaceVisit[];
	neighbors: Neighbor[];
	createdAt: number;
	lastVisitedAt: number;
	confidence: number;
	provisional: boolean;
}

export interface Transition {
	id: string;
	fromScene: string;
	toScene: string;
	count: number;
	/** The usual path between the two places (qualitative, natural language). */
	path: string;
	/** Observed path variants (for the usual-path vote). */
	pathVariants: Array<{ path: string; count: number }>;
	/** Accumulated transition experience (histograms of qualitative motion bins). */
	duration: Record<Bin3, number>;
	distance: Record<Bin3, number>;
	turn: Record<TurnDir, number>;
	turnAmount: Record<TurnAmount, number>;
	level: Record<LevelChange, number>;
	/** Absolute compass sector when arriving (magnetometer / oracle heading). */
	heading: Record<Compass8, number>;
	firstSeenMs: number;
	lastSeenMs: number;
	confidence: number;
}

export interface PlaceMemorySnapshot {
	reviews: MemoryReview[];
	schemaVersion: 2;
	observations: Observation[];
	spaces: Space[];
	transitionExperiences: TransitionExperience[];
	revisions: MemoryRevision[];
	currentSceneId: string | null;
	scenes: PlaceNode[];
	transitions: Transition[];
	history: Array<{ sceneId: string; atMs: number }>;
}

interface Persisted {
	reviews?: MemoryReview[];
	schemaVersion: 1 | 2;
	observations?: Observation[];
	spaces?: Space[];
	transitionExperiences?: TransitionExperience[];
	revisions?: MemoryRevision[];
	currentSceneId: string | null;
	scenes: PlaceNode[];
	transitions: Transition[];
	history: Array<{ sceneId: string; atMs: number }>;
}

export interface Observation {
	anchors?: string[];
	localRelations?: string[];
	identityReason?: string;
	id: string;
	atMs: number;
	frames: PlaceRepresentative[];
	placeId: string;
	visitId: string | null;
	motion: MotionHint;
	description: string | null;
	decision: { via: "vlm" | "legacy"; confidence: number; raw: string; uncertain: boolean; identityStatus?: "resolved" | "unresolved" };
}

export interface Space {
	/** Related adjacent local positions in one spatial scope; not a room ID. */
	evidenceIds?: string[];
	reason?: string;
	id: string;
	label: string;
	placeIds: string[];
	provisional: boolean;
}

export interface TransitionExperience {
	id: string;
	fromVisitId: string;
	toVisitId: string;
	hint: MotionHint;
	description: string | null;
	atMs: number;
	confirmed: boolean;
}

export interface MemoryRevision {
	id: string;
	atMs: number;
	kind: "group" | "merge" | "rebind" | "split" | "undo";
	reason: string;
	evidenceIds: string[];
	before: string;
	after: string;
}

export interface MemoryReview { id: string; atMs: number; evidenceIds: string[]; raw: string; applied: boolean; error: string | null; }

const MAX_REPS_PER_SCENE = 5;
const MAX_VARIANTS_PER_EDGE = 8;

function emptyBins<T extends string>(keys: T[]): Record<T, number> {
	const bins = {} as Record<T, number>;
	for (const key of keys) bins[key] = 0;
	return bins;
}

function bump<T extends string>(bins: Record<T, number>, key: T): void {
	bins[key] = (bins[key] ?? 0) + 1;
}

function modalBin<T extends string>(bins: Record<T, number>): T {
	const entries = Object.entries(bins) as Array<[T, number]>;
	entries.sort((a, b) => b[1] - a[1]);
	return entries[0]?.[0] ?? ("unknown" as T);
}

/** Strips the boilerplate prefix the motion module prepends, for a clean edge path. */
function normalizeMotionText(text: string): string {
	return text
		.replace(/^the phone's motion over this window[^:]*:\s*/i, "")
		.replace(/^the phone's motion[^:]*:\s*/i, "")
		.trim();
}

export class PlaceMemory {
	private reviews: MemoryReview[] = [];
	private observations: Observation[] = [];
	private spaces: Space[] = [];
	private experiences: TransitionExperience[] = [];
	private revisions: MemoryRevision[] = [];
	private scenes = new Map<string, PlaceNode>();
	private transitions = new Map<string, Transition>();
	private history: Array<{ sceneId: string; atMs: number }> = [];
	private currentSceneId: string | null = null;
	private nextSceneNum = 1;
	private nextVisitNum = 1;
	private currentVisitId: string | null = null;

	constructor(private readonly storePath: string | null = null) {}

	async load(): Promise<void> {
		if (!this.storePath) return;
		try {
			const data = JSON.parse(await readFile(this.storePath, "utf8")) as Persisted;
			if (data.schemaVersion !== 1 && data.schemaVersion !== 2) throw new Error("Unsupported place memory schema");
			this.currentSceneId = data.currentSceneId ?? null;
			this.history = data.history ?? [];
			this.observations = data.observations ?? [];
			this.spaces = data.spaces ?? [];
			this.experiences = data.transitionExperiences ?? [];
			this.revisions = data.revisions ?? [];
			this.reviews = data.reviews ?? [];
			for (const scene of data.scenes ?? []) {
				if (!scene.neighbors) scene.neighbors = [];
				this.scenes.set(scene.id, scene);
				for (const visit of scene.visits) this.nextVisitNum = Math.max(this.nextVisitNum, Number(visit.id.replace(/\D/g, "")) + 1);
				const num = Number(scene.id.replace(/[^0-9]/g, ""));
				if (Number.isFinite(num)) this.nextSceneNum = Math.max(this.nextSceneNum, num + 1);
			}
			for (const transition of data.transitions ?? []) this.transitions.set(this.edgeKey(transition.fromScene, transition.toScene), transition);
			// V1 has no observation provenance. Preserve its route evidence explicitly,
			// but do not present it as newly VLM-confirmed experience.
			if (data.schemaVersion === 1) {
				const visits = this.listScenes().flatMap(scene => scene.visits).sort((a, b) => a.startMs - b.startMs);
				for (let index = 1; index < visits.length; index++) {
					const from = visits[index - 1]!, to = visits[index]!;
					const edge = this.transitions.get(this.edgeKey(from.sceneId, to.sceneId));
					if (edge) this.experiences.push({ id: `experience-${this.experiences.length + 1}`, fromVisitId: from.id, toVisitId: to.id, hint: this.usualHint(edge), description: edge.path, atMs: to.startMs, confirmed: false });
				}
			}
			this.currentVisitId = this.getScene(this.currentSceneId ?? "")?.visits.at(-1)?.id ?? null;
		} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	}

	private async persist(): Promise<void> {
		if (!this.storePath) return;
		const payload: Persisted = {
			schemaVersion: 2,
			reviews: this.reviews,
			observations: this.observations, spaces: this.spaces,
			transitionExperiences: this.experiences, revisions: this.revisions,
			currentSceneId: this.currentSceneId,
			scenes: [...this.scenes.values()],
			transitions: [...this.transitions.values()],
			history: this.history.slice(-200),
		};
		try {
			await mkdir(dirname(this.storePath), { recursive: true });
			await writeFile(`${this.storePath}.tmp`, JSON.stringify(payload), "utf8");
			await rename(`${this.storePath}.tmp`, this.storePath);
		} catch (error) { throw new Error(`Cannot persist place memory: ${String(error)}`); }
	}

	private edgeKey(from: string, to: string): string { return `${from}->${to}`; }

	getState(): PlaceMemorySnapshot {
		return structuredClone({ schemaVersion: 2 as const, reviews: this.reviews, observations: this.observations, spaces: this.spaces, transitionExperiences: this.experiences, revisions: this.revisions, currentSceneId: this.currentSceneId, scenes: this.listScenes(), transitions: [...this.transitions.values()], history: this.history.slice(-50) });
	}

	async recordReview(evidenceIds: string[], raw: string, applied: boolean, error: string | null): Promise<void> {
		this.reviews.push({ id: `review-${this.reviews.length + 1}`, atMs: Date.now(), evidenceIds, raw, applied, error });
		await this.persist();
	}

	listScenes(): PlaceNode[] { return [...this.scenes.values()].filter(scene => !scene.mergedInto); }
	getScene(id: string): PlaceNode | null {
		let scene = this.scenes.get(id);
		const seen = new Set<string>();
		while (scene?.mergedInto && !seen.has(scene.id)) { seen.add(scene.id); scene = this.scenes.get(scene.mergedInto); }
		return scene ?? null;
	}
	recentScenes(limit = 5): PlaceNode[] { return this.listScenes().slice(-limit); }

	neighbors(sceneId: string | null): Neighbor[] {
		if (!sceneId) return [];
		const scene = this.getScene(sceneId);
		return scene ? scene.neighbors : [];
	}

	/** Candidate places to compare against: graph neighbours first, then recent places. */
	candidates(sceneId: string | null, limit = 5): PlaceNode[] {
		const picked: PlaceNode[] = [];
		const seen = new Set<string>();
		for (const neighbor of this.neighbors(sceneId)) {
			const scene = this.scenes.get(neighbor.sceneId);
			if (scene && !seen.has(scene.id)) { picked.push(scene); seen.add(scene.id); }
		}
		for (const scene of this.listScenes().reverse()) {
			if (picked.length >= limit) break;
			if (!seen.has(scene.id)) { picked.push(scene); seen.add(scene.id); }
		}
		return picked.slice(0, limit);
	}

	ensureScene(id: string | null, label: string, summary: string, objects: string[], now: number, provisional = false): PlaceNode {
		const sceneId = (id ? this.getScene(id)?.id ?? id : null) ?? `scene-${this.nextSceneNum++}`;
		let scene = this.scenes.get(sceneId);
		if (!scene) {
			scene = { id: sceneId, label, summary, objects, frames: [], visits: [], neighbors: [], createdAt: now, lastVisitedAt: now, confidence: provisional ? 0.4 : 0.7, provisional };
			this.scenes.set(sceneId, scene);
		} else {
			// An uncertain association must not overwrite a confirmed identity's description.
			if (!provisional || scene.provisional) {
				scene.label = label || scene.label;
				scene.summary = summary || scene.summary;
				scene.objects = objects.length ? objects : scene.objects;
			}
			scene.lastVisitedAt = now;
			if (!provisional) scene.provisional = false;
		}
		return scene;
	}

	addRepresentative(sceneId: string, rep: PlaceRepresentative): void {
		const scene = this.scenes.get(sceneId);
		if (!scene) return;
		if (scene.frames.some((frame) => frame.path === rep.path || frame.id === rep.id)) return;
		scene.frames.push(rep);
		// Keep an initial anchor and recent views; never freeze at the first visit.
		if (scene.frames.length > MAX_REPS_PER_SCENE) scene.frames.splice(1, 1);
	}

	/**
	 * Bookkeeping for one resolved observation: extend the current visit when the
	 * place is unchanged, or close it and open a new visit plus a transition edge
	 * (carrying the motion path) when the place changed.
	 */
	async onSceneResolved(sceneId: string, frame: string, hint: MotionHint, description: string | null, now: number, evidence?: { frames: PlaceRepresentative[]; confidence: number; raw: string; uncertain: boolean; identityStatus?: "resolved" | "unresolved"; anchors?: string[]; localRelations?: string[]; identityReason?: string }): Promise<void> {
		const observation: Observation = { id: `observation-${this.observations.length + 1}`, atMs: now, frames: evidence?.frames ?? [{ id: frame, path: "" }], placeId: sceneId, visitId: null, motion: hint, description, decision: { via: evidence ? "vlm" : "legacy", confidence: evidence?.confidence ?? 0, raw: evidence?.raw ?? "", uncertain: evidence?.uncertain ?? true } };
		this.observations.push(observation);
		if (evidence?.identityStatus) observation.decision.identityStatus = evidence.identityStatus;
		observation.anchors = evidence?.anchors ?? [];
		observation.localRelations = evidence?.localRelations ?? [];
		observation.identityReason = evidence?.identityReason ?? "";
		if (sceneId === this.currentSceneId) {
			observation.visitId = this.currentVisitId;
			const scene = this.scenes.get(sceneId);
			const visit = scene?.visits.at(-1);
			if (visit && visit.id === this.currentVisitId) { visit.endMs = now; if (!visit.representativeFrames.includes(frame)) visit.representativeFrames.push(frame); }
			await this.persist();
			return;
		}

		const previous = this.currentSceneId;
		const previousVisitId = this.currentVisitId;
		if (previous) {
			const prevScene = this.scenes.get(previous);
			const visit = prevScene?.visits.at(-1);
			if (visit && visit.id === this.currentVisitId) { visit.endMs = now; visit.exitFrame = frame; visit.nextSceneId = sceneId; }
		}

		const scene = this.scenes.get(sceneId);
		if (scene) {
			const visit: PlaceVisit = {
				id: `visit-${this.nextVisitNum++}`, sceneId, startMs: now, endMs: null,
				entryFrame: frame, exitFrame: null, representativeFrames: [frame], changes: [],
				previousSceneId: previous, nextSceneId: null,
			};
			scene.visits.push(visit);
			this.currentVisitId = visit.id;
			observation.visitId = visit.id;
			if (previous && previousVisitId) {
				const confirmed = Boolean(evidence && !evidence.uncertain && evidence.confidence >= 0.8 && !scene.provisional && !this.getScene(previous)?.provisional);
				this.experiences.push({ id: `experience-${this.experiences.length + 1}`, fromVisitId: previousVisitId, toVisitId: visit.id, hint, description, atMs: now, confirmed });
				if (confirmed) await this.addTransition(previous, sceneId, hint, description, now);
			}
		}
		this.currentSceneId = sceneId;
		this.history.push({ sceneId, atMs: now });
		await this.persist();
	}

	private revision(kind: MemoryRevision["kind"], reason: string, evidenceIds: string[], before: unknown, after: unknown): void {
		if (!reason.trim() || !evidenceIds.length) throw new Error("Revision requires a reason and evidence");
		if (evidenceIds.some(id => !this.observations.some(observation => observation.id === id))) throw new Error("Unknown observation evidence");
		// A full checkpoint includes aliases, unlike the public active-place view.
		before = { ...(before as PlaceMemorySnapshot), scenes: [...this.scenes.values()], history: this.history, revisions: [] };
		this.revisions.push({ id: `revision-${this.revisions.length + 1}`, atMs: Date.now(), kind, reason, evidenceIds, before: JSON.stringify(before), after: JSON.stringify(after) });
	}

	/** Undo only the latest edit, and never silently discard newer observations. */
	async undoLastRevision(reason: string): Promise<void> {
		const last = this.revisions.at(-1);
		if (!last || last.kind === "undo") throw new Error("No latest revision to undo");
		const before = JSON.parse(last.before) as PlaceMemorySnapshot;
		if (before.observations.length !== this.observations.length) throw new Error("New observations exist; use an explicit correction instead of undo");
		this.revision("undo", reason, last.evidenceIds, this.getState(), { revisionId: last.id });
		this.scenes = new Map(before.scenes.map(scene => [scene.id, scene]));
		this.observations = before.observations;
		this.spaces = before.spaces;
		this.experiences = before.transitionExperiences;
		this.transitions = new Map(before.transitions.map(edge => [this.edgeKey(edge.fromScene, edge.toScene), edge]));
		this.history = before.history;
		this.currentSceneId = before.currentSceneId;
		this.currentVisitId = this.observations.at(-1)?.visitId ?? this.getScene(this.currentSceneId ?? "")?.visits.at(-1)?.id ?? null;
		await this.persist();
	}

	/** Split a mixed visit at a saved observation; the new boundary is provisional. */
	async splitVisit(visitId: string, observationId: string, targetId: string | null, reason: string, evidenceIds: string[], newLabel = "provisional local place"): Promise<void> {
		const visit = this.listScenes().flatMap(scene => scene.visits).find(item => item.id === visitId);
		let target = targetId ? this.getScene(targetId) : null;
		const rows = this.observations.filter(item => item.visitId === visitId);
		const index = rows.findIndex(item => item.id === observationId);
		if (!visit || (targetId && !target) || index <= 0 || target?.id === visit.sceneId) throw new Error("Invalid split boundary or target");
		this.revision("split", reason, evidenceIds, this.getState(), { visitId, observationId, targetId });
		const boundary = rows[index]!;
		target ??= this.ensureScene(null, newLabel, "", [], boundary.atMs, true);
		const suffix = rows.slice(index);
		const next: PlaceVisit = { ...structuredClone(visit), id: `visit-${this.nextVisitNum++}`, sceneId: target.id, startMs: boundary.atMs, entryFrame: boundary.frames[0]?.id ?? null, representativeFrames: suffix.flatMap(item => item.frames.map(frame => frame.id)), changes: visit.changes.filter(change => change.atMs >= boundary.atMs) };
		visit.endMs = rows[index - 1]!.atMs;
		visit.exitFrame = rows[index - 1]!.frames.at(-1)?.id ?? null;
		visit.representativeFrames = rows.slice(0, index).flatMap(item => item.frames.map(frame => frame.id));
		visit.changes = visit.changes.filter(change => change.atMs < boundary.atMs);
		target.visits.push(next);
		for (const row of suffix) { row.visitId = next.id; row.placeId = target.id; }
		for (const experience of this.experiences) if (experience.fromVisitId === visitId) experience.fromVisitId = next.id;
		this.experiences.push({ id: `experience-${this.experiences.length + 1}`, fromVisitId: visitId, toVisitId: next.id, hint: boundary.motion, description: boundary.description, atMs: boundary.atMs, confirmed: false });
		if (this.currentVisitId === visitId) { this.currentVisitId = next.id; this.currentSceneId = target.id; }
		await this.rebuildRoutes();
		await this.persist();
	}

	/** Group local places without erasing their distinct route identities. */
	async groupPlaces(placeIds: string[], label: string, reason: string, evidenceIds: string[]): Promise<Space> {
		const places = [...new Map(placeIds.map(id => this.getScene(id)).map(place => [place?.id, place])).values()];
		if (places.some(place => !place) || places.length < 2) throw new Error("Space requires at least two distinct places");
		const ids = places.map(place => place!.id);
		const evidence = this.observations.filter(row => evidenceIds.includes(row.id));
		if (ids.some(id => !evidence.some(row => row.placeId === id))) throw new Error("Space evidence must cover every member place");
		// Connectivity is necessary, not sufficient: the verifier must also establish
		// physical adjacency and shared spatial scope, not just a route between rooms.
		const visits = this.listScenes().flatMap(place => place.visits);
		const reached = new Set([ids[0]!]);
		for (let pass = 0; pass < ids.length; pass++) for (const edge of this.experiences) {
			const from = visits.find(visit => visit.id === edge.fromVisitId)?.sceneId;
			const to = visits.find(visit => visit.id === edge.toVisitId)?.sceneId;
			if (from && to && ids.includes(from) && ids.includes(to)) {
				if (reached.has(from)) reached.add(to);
				if (reached.has(to)) reached.add(from);
			}
		}
		if (ids.some(id => !reached.has(id))) throw new Error("Space members lack connected visit evidence");
		const existing = this.spaces.find(space => space.placeIds.length === places.length && places.every(place => space.placeIds.includes(place!.id)));
		if (existing) return existing;
		const before = this.getState();
		this.revision("group", reason, evidenceIds, before, { placeIds, label });
		const space: Space = { id: `space-${this.spaces.length + 1}`, label, placeIds: ids, provisional: true, evidenceIds: [...evidenceIds], reason };
		for (const place of places) {
			for (const old of this.spaces) old.placeIds = old.placeIds.filter(id => id !== place!.id);
			place!.spaceId = space.id;
		}
		this.spaces.push(space);
		await this.persist();
		return space;
	}

	/** Merge duplicates; retain the source node as an alias and preserve observations. */
	async mergePlaces(sourceId: string, targetId: string, reason: string, evidenceIds: string[]): Promise<void> {
		const source = this.getScene(sourceId), target = this.getScene(targetId);
		if (!source || !target || source.id === target.id) throw new Error("Merge requires two distinct places");
		if (source.spaceId && target.spaceId && source.spaceId !== target.spaceId) throw new Error("Resolve conflicting space memberships before merging");
		this.revision("merge", reason, evidenceIds, this.getState(), { sourceId: source.id, targetId: target.id });
		target.frames = [...target.frames, ...source.frames].filter((frame, index, all) => all.findIndex(other => other.path === frame.path) === index);
		target.visits.push(...source.visits);
		source.visits = [];
		source.mergedInto = target.id;
		for (const visit of target.visits) visit.sceneId = target.id;
		for (const observation of this.observations) if (observation.placeId === source.id) observation.placeId = target.id;
		if (this.currentSceneId === source.id) this.currentSceneId = target.id;
		target.spaceId ??= source.spaceId ?? null;
		for (const space of this.spaces) space.placeIds = [...new Set(space.placeIds.map(id => id === source.id ? target.id : id))];
		await this.rebuildRoutes();
		await this.persist();
	}

	/** Split by creating a provisional target, then rebind whole visits to it. */
	async rebindVisits(visitIds: string[], targetId: string, reason: string, evidenceIds: string[]): Promise<void> {
		const target = this.getScene(targetId);
		const visits = this.listScenes().flatMap(scene => scene.visits);
		if (!target || !visitIds.length || visitIds.some(id => !visits.some(visit => visit.id === id))) throw new Error("Unknown target or visit");
		this.revision("rebind", reason, evidenceIds, this.getState(), { visitIds, targetId });
		for (const scene of this.listScenes()) {
			const selected = scene.visits.filter(visit => visitIds.includes(visit.id));
			scene.visits = scene.visits.filter(visit => !visitIds.includes(visit.id));
			for (const visit of selected) { visit.sceneId = target.id; target.visits.push(visit); }
		}
		for (const observation of this.observations) if (observation.visitId && visitIds.includes(observation.visitId)) observation.placeId = target.id;
		if (this.currentVisitId && visitIds.includes(this.currentVisitId)) this.currentSceneId = target.id;
		await this.rebuildRoutes();
		await this.persist();
	}

	private async rebuildRoutes(): Promise<void> {
		// Reconstruct image assignments from source observations after identity edits.
		for (const scene of this.listScenes()) {
			const frames = this.observations.filter(row => row.placeId === scene.id && row.decision.identityStatus !== "unresolved").flatMap(row => row.frames.slice(-1)).filter(frame => frame.path);
			if (frames.length) scene.frames = frames.filter((frame, index, all) => all.findIndex(other => other.path === frame.path) === index).slice(-MAX_REPS_PER_SCENE);
			else if (this.observations.length) scene.frames = [];
		}
		const visits = this.listScenes().flatMap(scene => scene.visits).sort((a, b) => a.startMs - b.startMs);
		for (const [index, visit] of visits.entries()) {
			visit.previousSceneId = visits[index - 1]?.sceneId ?? null;
			visit.nextSceneId = visits[index + 1]?.sceneId ?? null;
		}
		this.history = visits.map(visit => ({ sceneId: visit.sceneId, atMs: visit.startMs }));
		this.transitions.clear();
		for (const scene of this.scenes.values()) scene.neighbors = [];
		for (const experience of this.experiences) {
			const from = visits.find(visit => visit.id === experience.fromVisitId), to = visits.find(visit => visit.id === experience.toVisitId);
			if (experience.confirmed && from && to && from.sceneId !== to.sceneId && !this.getScene(from.sceneId)?.provisional && !this.getScene(to.sceneId)?.provisional) await this.addTransition(from.sceneId, to.sceneId, experience.hint, experience.description, experience.atMs);
		}
	}

	private async addTransition(fromScene: string, toScene: string, hint: MotionHint, description: string | null, now: number): Promise<void> {
		const key = this.edgeKey(fromScene, toScene);
		let transition = this.transitions.get(key);
		if (!transition) {
			transition = {
				id: `edge-${this.transitions.size + 1}`, fromScene, toScene, count: 0, path: "", pathVariants: [],
				duration: emptyBins(["short", "medium", "long", "unknown"] as Bin3[]),
				distance: emptyBins(["short", "medium", "long", "unknown"] as Bin3[]),
				turn: emptyBins(["left", "right", "straight", "around", "unknown"] as TurnDir[]),
				turnAmount: emptyBins(["small", "medium", "large", "unknown"] as TurnAmount[]),
				level: emptyBins(["same", "up", "down", "unknown"] as LevelChange[]),
				heading: emptyBins(["N", "NE", "E", "SE", "S", "SW", "W", "NW", "unknown"] as Compass8[]),
				firstSeenMs: now, lastSeenMs: now, confidence: 0.5,
			};
			this.transitions.set(key, transition);
		}
		transition.count += 1;
		transition.lastSeenMs = now;
		bump(transition.duration, hint.duration);
		bump(transition.distance, hint.distance);
		bump(transition.turn, hint.turn);
		bump(transition.turnAmount, hint.turnAmount);
		bump(transition.level, hint.level);
		bump(transition.heading, hint.heading);
		const path = normalizeMotionText(description ?? "") || describeHint(hint);
		const variant = transition.pathVariants.find((item) => item.path === path);
		if (variant) variant.count += 1;
		else transition.pathVariants.push({ path, count: 1 });
		transition.pathVariants.sort((a, b) => b.count - a.count);
		transition.pathVariants = transition.pathVariants.slice(0, MAX_VARIANTS_PER_EDGE);
		transition.path = transition.pathVariants[0]!.path;   // usual path = most frequent
		transition.confidence = Math.min(0.95, 0.5 + 0.05 * transition.count);

		for (const [sceneId, target] of [[fromScene, toScene], [toScene, fromScene]] as const) {
			const scene = this.scenes.get(sceneId);
			if (!scene) continue;
			const neighbor = scene.neighbors.find((item) => item.sceneId === target);
			if (neighbor) neighbor.count += 1;
			else scene.neighbors.push({ sceneId: target, count: 1 });
		}
	}

	/** The usual (modal) motion recorded on an edge. */
	usualHint(transition: Transition): MotionHint {
		const moved = transition.distance.short + transition.distance.medium + transition.distance.long + transition.turn.left + transition.turn.right + transition.turn.around;
		return {
			moving: moved > 0,
			duration: modalBin(transition.duration),
			distance: modalBin(transition.distance),
			turn: modalBin(transition.turn),
			turnAmount: modalBin(transition.turnAmount),
			level: modalBin(transition.level),
			heading: modalBin(transition.heading),
			confidence: transition.confidence,
		};
	}

	/**
	 * "I have left this place moving like this before — where did I end up?"
	 * Ranks the places usually reached from `from` given the current motion hint.
	 */
	expectedNext(from: string | null, hint: MotionHint): Array<{ sceneId: string; score: number; path: string; pathSim: number }> {
		if (!from) return [];
		const out: Array<{ sceneId: string; score: number; path: string; pathSim: number }> = [];
		for (const transition of this.transitions.values()) {
			if (transition.fromScene !== from) continue;
			const similarity = hintSimilarity(this.usualHint(transition), hint);
			const score = transition.confidence * (0.3 + 0.7 * similarity) + Math.min(0.3, transition.count * 0.03);
			out.push({ sceneId: transition.toScene, score: Number(score.toFixed(3)), path: transition.path, pathSim: Number(similarity.toFixed(3)) });
		}
		return out.sort((a, b) => b.score - a.score);
	}

	/** Path between two places: the direct edge's usual path, or a two-hop summary. */
	pathBetween(from: string, to: string): string | null {
		return this.transitions.get(this.edgeKey(from, to))?.path ?? null;
	}
}
