import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SpatialObservation } from "./incremental-spatial-memory.js";

export interface TopologyNode { id: string; summary: string; representatives: SpatialObservation[]; lastSeenMs: number; status?: "candidate" | "confirmed" | "retired" }
export interface TopologyAssignment { observationId: string; placeId: string | null; reason: string; originalPlaceId?: string | null }
export interface TopologyRevision { id: string; kind: "merge" | "split" | "confirm" | "undo"; reason: string; evidenceIds: string[]; before: string; after: string; undoOf?: string }
export interface TopologyEdge { from: string; to: string; evidence: Array<{ fromObservationId: string; toObservationId: string }> }
export interface TopologyState {
	version: 1; observations: SpatialObservation[]; pending: string[]; assignments: TopologyAssignment[];
	nodes: TopologyNode[]; edges: TopologyEdge[]; currentPlaceId: string | null;
	revisions?: TopologyRevision[];
}
export interface WindowAnswer { places: Array<{ id: string; summary: string }>; assignments: TopologyAssignment[] }
export type WindowRecognizer = (observations: SpatialObservation[], history: TopologyState) => Promise<WindowAnswer>;

/** Single-process durable inbox, one VLM call at a time, bounded window per call. */
export class SpatialTopologyService {
	private state: TopologyState = { version: 1, observations: [], pending: [], assignments: [], nodes: [], edges: [], currentPlaceId: null };
	private writes: Promise<void> = Promise.resolve();
	private processing: Promise<void> | null = null;
	private lastStarted = -Infinity;
	constructor(private readonly path: string, private readonly recognize: WindowRecognizer, private readonly maxWindowObservations = 4, private readonly maxPendingObservations = 120) {
		if (!Number.isInteger(maxWindowObservations) || maxWindowObservations < 1) throw new Error("Invalid window limit");
		if (!Number.isInteger(maxPendingObservations) || maxPendingObservations < maxWindowObservations) throw new Error("Invalid pending capacity");
	}
	snapshot(): TopologyState { return structuredClone(this.state); }
	private identityState(s: TopologyState): string { return JSON.stringify({nodes:s.nodes,assignments:s.assignments,edges:s.edges,currentPlaceId:s.currentPlaceId}); }
	private rebuild(s: TopologyState): void {
		s.edges=[];
		for(const node of s.nodes){node.representatives=[];node.lastSeenMs=0;}
		for(let i=0;i<s.assignments.length;i++) {
			const a=s.assignments[i]!,o=s.observations.find(o=>o.id===a.observationId)!;
			const node=s.nodes.find(n=>n.id===a.placeId);
			if(node){node.lastSeenMs=o.atMs;node.representatives.push(o);if(node.representatives.length>2)node.representatives.splice(1,1);}
			const previous=s.assignments[i-1];
			if(previous?.placeId && a.placeId && previous.placeId!==a.placeId && s.observations.find(o=>o.id===previous.observationId)?.recordingId===o.recordingId){
				let edge=s.edges.find(e=>e.from===previous.placeId && e.to===a.placeId);
				if(!edge){edge={from:previous.placeId,to:a.placeId,evidence:[]};s.edges.push(edge);}
				edge.evidence.push({fromObservationId:previous.observationId,toObservationId:a.observationId});
			}
		}
		s.currentPlaceId=s.assignments.at(-1)?.placeId ?? null;
	}
	async revise(kind: "merge" | "split" | "confirm", sourceId: string, reason: string, evidenceIds: string[], options: {targetId?: string; summary?: string} = {}): Promise<string> {
		if(this.processing)throw new Error("Pause recognition before revising");
		const revisionId=randomUUID();
		await this.transaction(s=>{
			const source=s.nodes.find(n=>n.id===sourceId && n.status!=="retired");
			if(!source || !reason.trim() || !evidenceIds.length || evidenceIds.some(id=>!s.assignments.some(a=>a.observationId===id)))throw new Error("Revision needs active source, reason and processed evidence");
			const before=this.identityState(s);
			if(kind==="confirm")source.status="confirmed";
			if(kind==="merge"){
				const target=s.nodes.find(n=>n.id===options.targetId && n.status!=="retired");
				if(!target || target.id===source.id)throw new Error("Merge needs distinct active target");
				for(const a of s.assignments)if(a.placeId===source.id){if(a.originalPlaceId===undefined)a.originalPlaceId=a.placeId;a.placeId=target.id;}
				source.status="retired";
			}
			if(kind==="split"){
				if(!options.summary?.trim() || evidenceIds.some(id=>!s.assignments.some(a=>a.observationId===id && a.placeId===sourceId)) || evidenceIds.length>=s.assignments.filter(a=>a.placeId===sourceId).length)throw new Error("Split needs proper source subset and summary");
				const id=randomUUID();s.nodes.push({id,summary:options.summary,status:"candidate",representatives:[],lastSeenMs:0});
				for(const a of s.assignments)if(evidenceIds.includes(a.observationId)){if(a.originalPlaceId===undefined)a.originalPlaceId=a.placeId;a.placeId=id;}
			}
			this.rebuild(s);(s.revisions ??= []).push({id:revisionId,kind,reason,evidenceIds:[...evidenceIds],before,after:this.identityState(s)});
		});return revisionId;
	}
	async undo(revisionId: string, reason: string): Promise<void> {
		if(this.processing)throw new Error("Pause recognition before undo");
		await this.transaction(s=>{
			const revision=s.revisions?.find(r=>r.id===revisionId);
			if(!revision || revision.kind==="undo" || !reason.trim() || this.identityState(s)!==revision.after)throw new Error("Undo conflicts with subsequent identity changes; undo latest changes first");
			const before=this.identityState(s), restored=JSON.parse(revision.before) as Pick<TopologyState,"nodes"|"assignments"|"edges"|"currentPlaceId">;
			Object.assign(s,restored);(s.revisions ??= []).push({id:randomUUID(),kind:"undo",reason,evidenceIds:revision.evidenceIds,before,after:this.identityState(s),undoOf:revisionId});
		});
	}
	private transaction(change: (state: TopologyState) => void): Promise<void> {
		const task = this.writes.then(async () => {
			const next = this.snapshot(); change(next);
			await mkdir(dirname(this.path), { recursive: true });
			const temporary = `${this.path}.${randomUUID()}.tmp`;
			await writeFile(temporary, JSON.stringify(next), "utf8"); await rename(temporary, this.path);
			this.state = next;
		});
		this.writes = task.catch(() => {}); return task;
	}
	async load(): Promise<void> {
		if (this.processing) throw new Error("Cannot load while processing");
		await this.writes;
		try {
			const s = JSON.parse(await readFile(this.path, "utf8")) as TopologyState;
			if (s.version !== 1 || ![s.observations,s.pending,s.assignments,s.nodes,s.edges].every(Array.isArray)) throw new Error("Invalid topology");
			const observations = new Set(s.observations.map(o => o.id)), nodes = new Set(s.nodes.map(n => n.id));
			if (observations.size !== s.observations.length || nodes.size !== s.nodes.length || s.pending.some(id => !observations.has(id)) || s.assignments.some(a => !observations.has(a.observationId) || (a.placeId !== null && !nodes.has(a.placeId))) || s.edges.some(e => !nodes.has(e.from) || !nodes.has(e.to))) throw new Error("Invalid topology references");
			for(const node of s.nodes)node.status ??= "candidate";
			this.state = s;
		} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	}
	async ingest(input: SpatialObservation): Promise<void> {
		const observation = structuredClone(input);
		await this.transaction(s => {
			if (s.pending.length >= this.maxPendingObservations) throw new Error("Spatial inbox full; observation not accepted, retain source and retry later");
			if (!observation.id || !Number.isFinite(observation.atMs) || !observation.frames.length || observation.frames.some(f => typeof f !== "string" || !f)) throw new Error("Invalid observation");
			if (s.observations.some(o => o.id === observation.id)) throw new Error("Duplicate observation");
			if (observation.atMs < (s.observations.at(-1)?.atMs ?? -Infinity)) throw new Error("Out-of-order observation");
			s.observations.push(observation); s.pending.push(observation.id);
		});
	}
	/** Caller ticks on observation arrival or a timer. flush is explicit end-of-recording only. */
	tick(nowMs: number, flush = false): Promise<void> {
		if (this.processing) return this.processing;
		const task = this.run(nowMs, flush);
		this.processing = task;
		void task.finally(() => { if (this.processing === task) this.processing = null; }).catch(() => {});
		return task;
	}
	private async run(nowMs: number, flush: boolean): Promise<void> {
		await this.writes;
		const history = this.snapshot();
		const oldest = history.observations.find(o => o.id === history.pending[0]);
		if (!oldest || (!flush && (nowMs-oldest.atMs < 10000 || nowMs-this.lastStarted < 5000))) return;
		const ids = history.pending.slice(0,this.maxWindowObservations);
		const batch = ids.map(id => history.observations.find(o => o.id === id)!);
		// Never supply queued future observations to recognition.
		const context = structuredClone(history); context.observations = []; context.pending = []; context.assignments = context.assignments.slice(-4); context.nodes=context.nodes.filter(n=>n.status!=="retired"); context.revisions=[];
		this.lastStarted = nowMs;
		const answer = await this.recognize(structuredClone(batch),context);
		if (!answer || !Array.isArray(answer.places) || !Array.isArray(answer.assignments)) throw new Error("Invalid window answer: places and assignments arrays required");
		await this.transaction(s => {
			const pids = answer.places.map(p => p.id), existing = new Set(s.nodes.filter(n=>n.status!=="retired").map(n => n.id));
			if (new Set(pids).size !== pids.length || answer.places.some(p => !p.id || !p.summary?.trim()) || answer.assignments.length !== ids.length || new Set(answer.assignments.map(a => a.observationId)).size !== ids.length || answer.assignments.some(a => !ids.includes(a.observationId) || !a.reason?.trim() || (a.placeId !== null && !pids.includes(a.placeId) && !existing.has(a.placeId)))) throw new Error("Invalid window answer");
			const mapping = new Map<string,string>([...existing].map(id => [id,id]));
			for (const p of answer.places) {
				if (existing.has(p.id)) mapping.set(p.id,p.id);
				else {
					if (!/^new-[1-9][0-9]*$/.test(p.id)) throw new Error("Unknown historical identity");
					const id = randomUUID(); mapping.set(p.id,id); s.nodes.push({id,summary:p.summary,representatives:[],lastSeenMs:0,status:"candidate"});
				}
			}
			for (const observation of batch) {
				const a = answer.assignments.find(a => a.observationId === observation.id)!;
				const placeId = a.placeId === null ? null : mapping.get(a.placeId)!;
				const previous = s.assignments.at(-1);
				const previousObservation = previous ? s.observations.find(o => o.id === previous.observationId) : undefined;
				if (previous?.placeId && placeId && previous.placeId !== placeId && previousObservation?.recordingId === observation.recordingId) {
					let edge = s.edges.find(e => e.from === previous.placeId && e.to === placeId);
					if (!edge) { edge = {from:previous.placeId,to:placeId,evidence:[]}; s.edges.push(edge); }
					edge.evidence.push({fromObservationId:previous.observationId,toObservationId:observation.id});
				}
				s.assignments.push({...a,placeId}); s.currentPlaceId = placeId;
				const node = s.nodes.find(n => n.id === placeId);
				if (node) { node.lastSeenMs = observation.atMs; node.representatives.push(observation); if (node.representatives.length > 2) node.representatives.splice(1,1); }
			}
			s.pending = s.pending.filter(id => !ids.includes(id));
		});
	}
}
