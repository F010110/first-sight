import { ExperienceGraph } from "./experience-graph.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export interface CorrespondenceEvidence {
	a: string; b: string;
	/** Independent bearing scores; missing values mean unknown, not contradiction. */
	bearings: number[];
	backwardBearings?: number[];
	views?: Array<{ direction: string; frame: string }>;
	source: string;
}
export interface AssociationHypothesis {
	id: string; observationId: string; targetNodeId: string;
	status: "proposed" | "supported" | "rejected";
	version: number; reason: string; evidence: CorrespondenceEvidence[];
	competitors: string[];
}

/** Conservative offline association controller. It never interprets time edges as identity. */
export class ExperienceAssociation {
	readonly hypotheses: AssociationHypothesis[] = [];
	readonly history: AssociationHypothesis[] = [];
	private evidence = new Map<string, CorrespondenceEvidence>();
	constructor(readonly graph: ExperienceGraph, private sequenceVerification = false) {}
	/** One atomic bundle prevents graph and association history from different revisions. */
	async persist(path: string): Promise<void> {
		await mkdir(dirname(path), { recursive: true });
		const temporary = `${path}.${randomUUID()}.tmp`;
		await writeFile(temporary, JSON.stringify({ schemaVersion: 1, sequenceVerification: this.sequenceVerification, graph: this.graph.getState(), evidence: [...this.evidence.values()], hypotheses: this.hypotheses, history: this.history }, null, 2));
		await rename(temporary,path);
	}
	async load(path: string): Promise<void> {
		const bundle = JSON.parse(await readFile(path,"utf8"));
		if (bundle.schemaVersion !== 1 || !Array.isArray(bundle.evidence) || !Array.isArray(bundle.hypotheses) || !Array.isArray(bundle.history)) throw new Error("Invalid association bundle");
		const stagedGraph = new ExperienceGraph(); stagedGraph.restore(bundle.graph);
		const staged = new ExperienceAssociation(stagedGraph);
		for (const pair of bundle.evidence) staged.addEvidence(pair);
		const state = stagedGraph.getState();
		for (const hypothesis of [...bundle.hypotheses,...bundle.history]) {
			if (!state.observations.some(row => row.id === hypothesis.observationId) || !state.nodes.some(node => node.id === hypothesis.targetNodeId) || !["proposed","supported","rejected"].includes(hypothesis.status) || !Number.isInteger(hypothesis.version) || hypothesis.version < 1 || typeof hypothesis.reason !== "string" || !Array.isArray(hypothesis.evidence) || !Array.isArray(hypothesis.competitors)) throw new Error("Invalid association history");
			for (const pair of hypothesis.evidence) staged.addEvidence(pair);
		}
		if (new Set(bundle.hypotheses.map((h: AssociationHypothesis) => h.id)).size !== bundle.hypotheses.length) throw new Error("Duplicate association IDs");
		this.graph.restore(bundle.graph);
		this.sequenceVerification = bundle.sequenceVerification === true;
		this.evidence = new Map(bundle.evidence.map((pair: CorrespondenceEvidence) => [this.key(pair.a,pair.b),structuredClone(pair)]));
		this.hypotheses.splice(0,this.hypotheses.length,...structuredClone(bundle.hypotheses));
		this.history.splice(0,this.history.length,...structuredClone(bundle.history));
	}
	private key(a: string, b: string): string { return [a,b].sort().join("\0"); }
	addEvidence(input: CorrespondenceEvidence): void {
		const ids = new Set(this.graph.getState().observations.map(row => row.id));
		if (!ids.has(input.a) || !ids.has(input.b) || input.a === input.b || typeof input.source !== "string" || !input.source.trim() || !Array.isArray(input.bearings) || [...input.bearings,...(input.backwardBearings ?? [])].some(score => !Number.isFinite(score) || score < 0 || score > 1)) throw new Error("Invalid correspondence evidence");
		this.evidence.set(this.key(input.a,input.b), structuredClone(input));
	}
	private strong(pair: CorrespondenceEvidence | undefined): boolean {
		return !!pair && pair.bearings.filter(score => score >= 0.4).length >= 2 && (!pair.backwardBearings || pair.backwardBearings.filter(score => score >= 0.4).length >= 2);
	}
	/** Reconsider all pending history after every promotion; require every representative. */
	reconsider(): void {
		if (this.sequenceVerification) { this.reconsiderSequences(); return; }
		let changed = true;
		while (changed) {
			changed = false;
			const state = this.graph.getState();
			for (const row of state.observations.filter(row => row.nodeId === null)) {
				if (this.graph.getState().observations.find(other => other.id === row.id)!.nodeId !== null) continue;
				const candidates = state.nodes.filter(node => node.representativeObservationIds.length >= 2 && node.representativeObservationIds.every(id => this.strong(this.evidence.get(this.key(row.id,id)))));
				for (const node of candidates) {
					const evidence = node.representativeObservationIds.map(id => this.evidence.get(this.key(row.id,id))!);
					const previous = this.hypotheses.find(h => h.observationId === row.id && h.targetNodeId === node.id);
					if (previous?.status === "rejected") continue;
					const hypothesis: AssociationHypothesis = { id: previous?.id ?? `association-${this.hypotheses.length+1}`, observationId: row.id, targetNodeId: node.id, status: candidates.length === 1 ? "supported" : "proposed", version: (previous?.version ?? 0)+1, reason: "All representative bearings supported; ambiguous candidates remain proposed", evidence: structuredClone(evidence), competitors: candidates.filter(other => other.id !== node.id).map(other => other.id) };
					if (previous && JSON.stringify({ ...previous, version: 0 }) === JSON.stringify({ ...hypothesis, version: 0 })) continue;
					this.history.push(structuredClone(hypothesis));
					if (previous) Object.assign(previous,hypothesis); else this.hypotheses.push(hypothesis);
					if (hypothesis.status === "supported") { this.graph.rebind([row.id],node.id,hypothesis.reason); changed = true; }
				}
				if (candidates.length) continue;
				if (this.hypotheses.some(h => h.observationId === row.id && h.status === "rejected")) continue;
				const partners = state.observations.filter(other => other.nodeId === null && other.id !== row.id && !this.hypotheses.some(h => h.observationId === other.id && h.status === "rejected") && this.strong(this.evidence.get(this.key(row.id,other.id))));
				// Ambiguous seed pairs remain pending, instead of picking an arbitrary best match.
				if (partners.length === 1 && partners[0]!.id > row.id) {
					const partner = partners[0]!;
					const reverse = state.observations.filter(other => other.nodeId === null && other.id !== partner.id && this.strong(this.evidence.get(this.key(partner.id,other.id))));
					if (reverse.length === 1 && !this.graph.getState().observations.find(other => other.id === partner.id)!.nodeId) {
						const nodeId = this.graph.createNode([row.id,partner.id],"Mutually unambiguous two-bearing seed evidence");
						for (const observationId of [row.id,partner.id]) {
							const hypothesis: AssociationHypothesis = { id: `association-${this.hypotheses.length+1}`, observationId, targetNodeId: nodeId, status: "supported", version: 1, reason: "Mutually unambiguous seed pair", evidence: [structuredClone(this.evidence.get(this.key(row.id,partner.id))!)], competitors: [] };
							this.hypotheses.push(hypothesis); this.history.push(structuredClone(hypothesis));
						}
						changed = true;
					}
				}
			}
		}
	}
	/** Non-overlapping short sequences, forward or reverse; no inferred displacement. */
	private sequenceSupport(a: string, b: string): CorrespondenceEvidence[] {
		const state = this.graph.getState();
		const visitA = state.visits.find(visit => visit.observationIds.includes(a))!;
		const visitB = state.visits.find(visit => visit.observationIds.includes(b))!;
		const i = visitA.observationIds.indexOf(a), j = visitB.observationIds.indexOf(b);
		if (visitA.id === visitB.id && Math.abs(i-j) <= 4) return [];
		let best: CorrespondenceEvidence[] = [];
		for (const direction of [-1,1]) {
			const support: CorrespondenceEvidence[] = [];
			for (const offset of [-2,-1,1,2]) {
				const left = visitA.observationIds[i+offset], right = visitB.observationIds[j+direction*offset];
				if (!left || !right || left === right) continue;
				// An observation hiatus is not evidence for a continuous aligned sequence.
				const continuous = (ids: string[], start: number, end: number) => {
					for (let index=Math.min(start,end)+1;index<=Math.max(start,end);index++) {
						const before=state.observations.find(row=>row.id===ids[index-1])!, after=state.observations.find(row=>row.id===ids[index])!;
						if (after.atMs-before.atMs > 10000) return false;
					}return true;
				};
				if (!continuous(visitA.observationIds,i,i+offset) || !continuous(visitB.observationIds,j,j+direction*offset)) continue;
				const pair = this.evidence.get(this.key(left,right));
				if (this.strong(pair)) support.push(pair!);
			}
			if (support.length > best.length) best = support;
		}
		return best;
	}
	private reconsiderSequences(): void {
		// Distinct neighboring pairs are corroboration, not statistically independent evidence.
		const state = this.graph.getState();
		const eligible = (a: string, b: string) => {
			const pair = this.evidence.get(this.key(a,b));
			if (!pair || Math.max(...pair.bearings) < 0.8 || (pair.backwardBearings && Math.max(...pair.backwardBearings) < 0.8)) return null;
			const support = this.sequenceSupport(a,b);
			if (support.length < 2) return null;
			const second = (values: number[]) => values.slice().sort((x,y)=>y-x)[1] ?? 0;
			return { pair, support, score: Math.min(second(pair.bearings),second(pair.backwardBearings ?? pair.bearings)) };
		};
		const candidatesFor = (id: string) => state.observations.filter(other => other.id !== id).flatMap(other => {
			if (this.hypotheses.some(h => h.observationId === id && h.targetNodeId === other.nodeId && h.status === "rejected")) return [];
			const value = eligible(id,other.id); return value ? [{ other, ...value }] : [];
		}).sort((a,b)=>b.score-a.score || b.support.length-a.support.length);
		for (const row of state.observations.filter(row => row.nodeId === null)) {
			if (this.graph.getState().observations.find(other => other.id === row.id)!.nodeId !== null || this.hypotheses.some(h=>h.observationId===row.id && h.status==="rejected")) continue;
			const candidates = candidatesFor(row.id); const best = candidates[0]; if (!best) continue;
			const competitor = candidates.find(candidate => best.other.nodeId ? candidate.other.nodeId !== best.other.nodeId : candidate.other.id !== best.other.id);
			if (competitor && best.score-competitor.score < 0.1) continue;
			const target = this.graph.getState().observations.find(other => other.id === best.other.id)!;
			let nodeId = target.nodeId;
			if (!nodeId) {
				const reverse = candidatesFor(target.id);
				if (reverse[0]?.other.id !== row.id || (reverse[1] && reverse[0]!.score-reverse[1]!.score < 0.1)) continue;
				nodeId = this.graph.createNode([row.id,target.id],"Non-overlapping short-sequence corroboration");
			} else this.graph.rebind([row.id],nodeId,"Direct view match plus two distinct sequence correspondences");
			for (const observationId of target.nodeId ? [row.id] : [row.id,target.id]) {
				const hypothesis: AssociationHypothesis = { id: `association-${this.hypotheses.length+1}`, observationId, targetNodeId: nodeId, status: "supported", version: 1, reason: "Direct bidirectional view support plus >=2 neighboring multi-bearing correspondences; unique candidate margin >=0.1", evidence: structuredClone([best.pair,...best.support]), competitors: candidates.filter(candidate=>candidate.other.nodeId && candidate.other.nodeId!==nodeId).map(candidate=>candidate.other.nodeId!) };
				this.hypotheses.push(hypothesis);this.history.push(structuredClone(hypothesis));
			}
		}
	}
	/** Diagnostic values, not a new inference path or confidence calibration. */
	diagnosePending(): Array<{ observationId: string; candidates: Array<{ observationId: string; directMaximum: number; supportingPairs: number }> }> {
		const state=this.graph.getState();
		return state.observations.filter(row=>row.nodeId===null).map(row=>({observationId:row.id,candidates:state.observations.filter(other=>other.id!==row.id).map(other=>{
			const pair=this.evidence.get(this.key(row.id,other.id));
			return {observationId:other.id,directMaximum:pair?Math.min(Math.max(0,...pair.bearings),Math.max(0,...(pair.backwardBearings??pair.bearings))):0,supportingPairs:this.sequenceSupport(row.id,other.id).length};
		}).filter(candidate=>candidate.directMaximum>=0.8||candidate.supportingPairs>=2)}));
	}
	/** Explicit positive contradictory evidence is required; weak similarity cannot revoke. */
	reject(observationId: string, targetNodeId: string, contradiction: { source: string; reason: string }): void {
		if (!contradiction.source.trim() || !contradiction.reason.trim()) throw new Error("Positive contradiction provenance required");
		const row = this.graph.getState().observations.find(row => row.id === observationId);
		if (!row || !this.graph.getState().nodes.some(node => node.id === targetNodeId)) throw new Error("Unknown identity");
		const previous = this.hypotheses.find(h => h.observationId === observationId && h.targetNodeId === targetNodeId);
		const value: AssociationHypothesis = { id: previous?.id ?? `association-${this.hypotheses.length+1}`, observationId, targetNodeId, status: "rejected", version: (previous?.version ?? 0)+1, reason: `${contradiction.source}: ${contradiction.reason}`, evidence: previous?.evidence ?? [], competitors: previous?.competitors ?? [] };
		this.history.push(structuredClone(value));
		if (previous) Object.assign(previous,value); else this.hypotheses.push(value);
		if (row.nodeId === targetNodeId) this.graph.rebind([observationId],null,value.reason);
	}
	getPendingTrajectories(): Array<{ visitId: string; observationIds: string[]; provisional: true }> {
		const state = this.graph.getState();
		const tracks: Array<{ visitId: string; observationIds: string[]; provisional: true }> = [];
		for (const visit of state.visits) {
			let current: typeof tracks[number] | null = null;
			for (const id of visit.observationIds) {
				if (state.observations.find(row=>row.id===id)!.nodeId !== null) { current=null;continue; }
				if (!current) { current={visitId:visit.id,observationIds:[],provisional:true};tracks.push(current); }
				current.observationIds.push(id);
			}
		}return tracks;
	}
}
