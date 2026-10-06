import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Persistent place memory: places (nodes), visits, and transitions (edges that
 * carry the *usual path* between two places).
 *
 * There are no coordinates. A place is an identity; a visit is one occasion of
 * being there; a transition edge records how one usually gets from A to B as a
 * qualitative path (e.g. "turned left ~90°, then forward ~4 steps").
 */

export interface PlaceRepresentative {
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
	pathVariants: Array<{ path: string; count: number }>;
	durationMs: number | null;
	evidence: string[];
	confidence: number;
}

export interface PlaceMemorySnapshot {
	currentSceneId: string | null;
	scenes: PlaceNode[];
	transitions: Transition[];
	history: Array<{ sceneId: string; atMs: number }>;
}

interface Persisted {
	schemaVersion: 1;
	currentSceneId: string | null;
	scenes: PlaceNode[];
	transitions: Transition[];
	history: Array<{ sceneId: string; atMs: number }>;
}

const MAX_REPS_PER_SCENE = 5;
const MAX_VARIANTS_PER_EDGE = 8;

export class PlaceMemory {
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
			this.currentSceneId = data.currentSceneId ?? null;
			this.history = data.history ?? [];
			for (const scene of data.scenes ?? []) {
				if (!scene.neighbors) scene.neighbors = [];
				this.scenes.set(scene.id, scene);
				const num = Number(scene.id.replace(/[^0-9]/g, ""));
				if (Number.isFinite(num)) this.nextSceneNum = Math.max(this.nextSceneNum, num + 1);
			}
			for (const transition of data.transitions ?? []) this.transitions.set(this.edgeKey(transition.fromScene, transition.toScene), transition);
		} catch { /* fresh memory */ }
	}

	private async persist(): Promise<void> {
		if (!this.storePath) return;
		const payload: Persisted = {
			schemaVersion: 1,
			currentSceneId: this.currentSceneId,
			scenes: [...this.scenes.values()],
			transitions: [...this.transitions.values()],
			history: this.history.slice(-200),
		};
		try {
			await mkdir(dirname(this.storePath), { recursive: true });
			await writeFile(this.storePath, JSON.stringify(payload), "utf8");
		} catch { /* best effort */ }
	}

	private edgeKey(from: string, to: string): string { return `${from}->${to}`; }

	getState(): PlaceMemorySnapshot {
		return { currentSceneId: this.currentSceneId, scenes: [...this.scenes.values()], transitions: [...this.transitions.values()], history: this.history.slice(-50) };
	}

	listScenes(): PlaceNode[] { return [...this.scenes.values()]; }
	getScene(id: string): PlaceNode | null { return this.scenes.get(id) ?? null; }
	recentScenes(limit = 5): PlaceNode[] { return [...this.scenes.values()].slice(-limit); }

	neighbors(sceneId: string | null): Neighbor[] {
		if (!sceneId) return [];
		const scene = this.scenes.get(sceneId);
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
		for (const scene of [...this.scenes.values()].reverse()) {
			if (picked.length >= limit) break;
			if (!seen.has(scene.id)) { picked.push(scene); seen.add(scene.id); }
		}
		return picked.slice(0, limit);
	}

	ensureScene(id: string | null, label: string, summary: string, objects: string[], now: number, provisional = false): PlaceNode {
		const sceneId = id ?? `scene-${this.nextSceneNum++}`;
		let scene = this.scenes.get(sceneId);
		if (!scene) {
			scene = { id: sceneId, label, summary, objects, frames: [], visits: [], neighbors: [], createdAt: now, lastVisitedAt: now, confidence: provisional ? 0.4 : 0.7, provisional };
			this.scenes.set(sceneId, scene);
		} else {
			scene.label = label || scene.label;
			scene.summary = summary || scene.summary;
			scene.objects = objects.length ? objects : scene.objects;
			scene.lastVisitedAt = now;
			if (!provisional) scene.provisional = false;
		}
		return scene;
	}

	addRepresentative(sceneId: string, rep: PlaceRepresentative): void {
		const scene = this.scenes.get(sceneId);
		if (!scene || scene.frames.length >= MAX_REPS_PER_SCENE) return;
		if (scene.frames.some((frame) => frame.path === rep.path)) return;
		scene.frames.push(rep);
	}

	/**
	 * Bookkeeping for one resolved observation: extend the current visit when the
	 * place is unchanged, or close it and open a new visit plus a transition edge
	 * (carrying the motion path) when the place changed.
	 */
	async onSceneResolved(sceneId: string, frame: string, motion: string | null, now: number): Promise<void> {
		if (sceneId === this.currentSceneId) {
			const scene = this.scenes.get(sceneId);
			const visit = scene?.visits.at(-1);
			if (visit && visit.id === this.currentVisitId) { visit.endMs = now; if (!visit.representativeFrames.includes(frame)) visit.representativeFrames.push(frame); }
			await this.persist();
			return;
		}

		const previous = this.currentSceneId;
		if (previous) {
			const prevScene = this.scenes.get(previous);
			const visit = prevScene?.visits.at(-1);
			if (visit && visit.id === this.currentVisitId) { visit.endMs = now; visit.exitFrame = frame; visit.nextSceneId = sceneId; }
			await this.addTransition(previous, sceneId, motion, now);
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
		}
		this.currentSceneId = sceneId;
		this.history.push({ sceneId, atMs: now });
		await this.persist();
	}

	private async addTransition(fromScene: string, toScene: string, motion: string | null, now: number): Promise<void> {
		const key = this.edgeKey(fromScene, toScene);
		let transition = this.transitions.get(key);
		const path = (motion ?? "").trim() || "moved";
		if (!transition) {
			transition = { id: `edge-${this.transitions.size + 1}`, fromScene, toScene, count: 1, path, pathVariants: [{ path, count: 1 }], durationMs: null, evidence: [], confidence: 0.5 };
			this.transitions.set(key, transition);
		} else {
			transition.count += 1;
			const variant = transition.pathVariants.find((item) => item.path === path);
			if (variant) variant.count += 1;
			else transition.pathVariants.push({ path, count: 1 });
			transition.pathVariants.sort((a, b) => b.count - a.count);
			transition.pathVariants = transition.pathVariants.slice(0, MAX_VARIANTS_PER_EDGE);
			transition.path = transition.pathVariants[0]!.path;  // usual path = most frequent
			transition.confidence = Math.min(0.95, 0.5 + 0.05 * transition.count);
		}
		// Keep the neighbor lists in sync with the edges.
		for (const [sceneId, target] of [[fromScene, toScene], [toScene, fromScene]] as const) {
			const scene = this.scenes.get(sceneId);
			if (!scene) continue;
			const neighbor = scene.neighbors.find((item) => item.sceneId === target);
			if (neighbor) neighbor.count += 1;
			else scene.neighbors.push({ sceneId: target, count: 1 });
		}
		void now;
	}

	/** Path between two places: the direct edge's usual path, or a two-hop summary. */
	pathBetween(from: string, to: string): string | null {
		return this.transitions.get(this.edgeKey(from, to))?.path ?? null;
	}
}
