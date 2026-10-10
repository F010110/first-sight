import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface ExperienceObservation {
	id: string; atMs: number; visitId: string; frames: string[];
	nodeId: string | null; status: "pending" | "associated";
	objects: string[]; description: string; semanticSource: string | null;
}
export interface VisualNode {
	id: string; observationIds: string[]; representativeObservationIds: string[];
	labels: string[]; // Optional user labels, never inferred region identities.
}
export interface ExperienceTransition {
	from: string; to: string; evidence: Array<{ visitId: string; fromObservation: string; toObservation: string; durationMs: number; gap: boolean }>;
	traversable: false; // Temporal correspondence does not authorize navigation.
}
export interface ExperienceSnapshot {
	schemaVersion: 1;
	observations: ExperienceObservation[];
	nodes: VisualNode[];
	visits: Array<{ id: string; observationIds: string[] }>;
	transitions: ExperienceTransition[];
	revisions: Array<{ reason: string; observationIds: string[]; previousNodeIds: Array<string | null>; targetNodeId: string | null }>;
}

export class ExperienceGraph {
	private state: ExperienceSnapshot = { schemaVersion: 1, observations: [], nodes: [], visits: [], transitions: [], revisions: [] };
	constructor(private readonly storePath: string | null = null) {}
	async load(): Promise<void> {
		if (!this.storePath) return;
		let text: string;
		try { text = await readFile(this.storePath, "utf8"); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
		this.restore(JSON.parse(text) as ExperienceSnapshot);
	}
	restore(input: ExperienceSnapshot): void {
		const state = structuredClone(input);
		if (state.schemaVersion !== 1 || !Array.isArray(state.observations) || !Array.isArray(state.nodes) || !Array.isArray(state.visits) || !Array.isArray(state.revisions)) throw new Error("Invalid experience graph store");
		if (new Set(state.observations.map(row => row.id)).size !== state.observations.length || new Set(state.nodes.map(row => row.id)).size !== state.nodes.length) throw new Error("Duplicate experience IDs");
		if (state.observations.some(row => row.nodeId !== null && !state.nodes.some(node => node.id === row.nodeId))) throw new Error("Dangling experience identity");
		const referenced = state.visits.flatMap(visit => visit.observationIds);
		if (new Set(state.visits.map(visit => visit.id)).size !== state.visits.length || new Set(referenced).size !== referenced.length || referenced.length !== state.observations.length) throw new Error("Invalid visit membership");
		for (const visit of state.visits) {
			let time = -Infinity;
			for (const id of visit.observationIds) {
				const row = state.observations.find(row => row.id === id);
				if (!row || row.visitId !== visit.id || !Number.isFinite(row.atMs) || row.atMs < time || row.status !== (row.nodeId === null ? "pending" : "associated")) throw new Error("Invalid observation sequence");
				time = row.atMs;
			}
		}
		this.state = state; this.rebuild();
	}
	getState(): ExperienceSnapshot { return structuredClone(this.state); }
	addObservation(input: Omit<ExperienceObservation, "nodeId" | "status">): void {
		if (this.state.observations.some(row => row.id === input.id)) throw new Error("Duplicate observation");
		const visit = this.state.visits.find(row => row.id === input.visitId) ?? { id: input.visitId, observationIds: [] };
		const previous = this.state.observations.find(row => row.id === visit.observationIds.at(-1));
		if (previous && previous.atMs > input.atMs) throw new Error("Visit observations must be chronological");
		if (!this.state.visits.includes(visit)) this.state.visits.push(visit);
		this.state.observations.push({ ...structuredClone(input), nodeId: null, status: "pending" });
		visit.observationIds.push(input.id);
	}
	createNode(evidenceIds: string[], reason: string): string {
		if (new Set(evidenceIds).size < 2) throw new Error("A visual node needs at least two supported observations");
		if (evidenceIds.some(id => !this.state.observations.some(row => row.id === id))) throw new Error("Unknown observation");
		const id = `visual-${this.state.nodes.length + 1}`;
		this.state.nodes.push({ id, observationIds: [], representativeObservationIds: [], labels: [] });
		this.rebind(evidenceIds, id, reason); return id;
	}
	rebind(ids: string[], target: string | null, reason: string): void {
		if (!ids.length || !reason.trim()) throw new Error("Rebinding requires evidence and reason");
		if (target !== null && !this.state.nodes.some(node => node.id === target)) throw new Error("Unknown visual node");
		const rows = ids.map(id => this.state.observations.find(row => row.id === id));
		if (rows.some(row => !row)) throw new Error("Unknown observation");
		this.state.revisions.push({ reason, observationIds: ids.slice(), previousNodeIds: rows.map(row => row!.nodeId), targetNodeId: target });
		for (const row of rows) { row!.nodeId = target; row!.status = target === null ? "pending" : "associated"; }
		this.rebuild();
	}
	private rebuild(): void {
		for (const node of this.state.nodes) {
			node.observationIds = this.state.observations.filter(row => row.nodeId === node.id).map(row => row.id);
			node.representativeObservationIds = [...new Set([node.observationIds[0], ...node.observationIds.slice(-3)].filter((id): id is string => Boolean(id)))];
		}
		const transitions = new Map<string, ExperienceTransition>();
		for (const visit of this.state.visits) {
			let previous: ExperienceObservation | null = null, gap = false;
			for (const id of visit.observationIds) {
				const row = this.state.observations.find(row => row.id === id)!;
				if (!row.nodeId) { gap = true; continue; }
				if (previous?.nodeId && previous.nodeId !== row.nodeId) {
					const key = `${previous.nodeId}\0${row.nodeId}`;
					const edge = transitions.get(key) ?? { from: previous.nodeId, to: row.nodeId, evidence: [], traversable: false };
					edge.evidence.push({ visitId: visit.id, fromObservation: previous.id, toObservation: row.id, durationMs: row.atMs - previous.atMs, gap }); transitions.set(key, edge);
				}
				previous = row; gap = false;
			}
		}
		this.state.transitions = [...transitions.values()];
	}
	/** Search observation facts: this never asserts a remembered object is present now. */
	searchObjects(query: string): Array<{ observationId: string; nodeId: string | null; atMs: number; frames: string[]; objects: string[]; semanticSource: string | null; historicalOnly: true }> {
		const needle = query.trim().toLowerCase();
		if (!needle) return [];
		return this.state.observations.filter(row => row.objects.some(object => object.toLowerCase().includes(needle))).sort((a,b) => b.atMs-a.atMs).map(row => ({ observationId: row.id, nodeId: row.nodeId, atMs: row.atMs, frames: row.frames.slice(), objects: row.objects.slice(), semanticSource: row.semanticSource, historicalOnly: true }));
	}
	async persist(): Promise<void> {
		if (!this.storePath) return;
		await mkdir(dirname(this.storePath), { recursive: true });
		const temporary = `${this.storePath}.tmp`;
		await writeFile(temporary, JSON.stringify(this.state, null, 2)); await rename(temporary, this.storePath);
	}
}
