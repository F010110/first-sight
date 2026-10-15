import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface SpatialObservation { id: string; atMs: number; frames: string[]; recordingId?: string; sourceAtMs?: number; evidence?: Array<{ id: string; atMs: number; path: string }> }
export interface SpatialPlace { id: string; summary: string; representatives: SpatialObservation[]; observationIds: string[]; lastSeenMs: number }
export interface SpatialDecision { kind: "same" | "known" | "new" | "unknown"; placeId?: string; summary: string; reason: string }
export interface SpatialRecord { observation: SpatialObservation; decision: SpatialDecision; placeId: string | null }
export interface SpatialSnapshot { version: 1; currentPlaceId: string | null; records: SpatialRecord[]; places: SpatialPlace[] }
export type SpatialRecognizer = (observation: SpatialObservation, history: SpatialSnapshot) => Promise<SpatialDecision>;

/** Serialized background writer; readers never wait for model calls. Originals remain in records. */
export class IncrementalSpatialMemory {
	private state: SpatialSnapshot = { version: 1, currentPlaceId: null, records: [], places: [] };
	private tail: Promise<void> = Promise.resolve();
	private pending = new Set<string>();
	constructor(private readonly path: string, private readonly recognize: SpatialRecognizer, private readonly representativeLimit = 3) {
		if (!Number.isInteger(representativeLimit) || representativeLimit < 2) throw new Error("Representative limit must be at least two");
	}
	snapshot(): SpatialSnapshot { return structuredClone(this.state); }
	async load(): Promise<void> {
		if (this.pending.size) throw new Error("Cannot load while processing");
		try {
			const value = JSON.parse(await readFile(this.path, "utf8")) as SpatialSnapshot;
			if (value.version !== 1 || !Array.isArray(value.records) || !Array.isArray(value.places)) throw new Error("Invalid spatial memory");
			if (new Set(value.records.map(r => r.observation.id)).size !== value.records.length || new Set(value.places.map(p => p.id)).size !== value.places.length) throw new Error("Duplicate memory IDs");
			const ids = new Set(value.places.map(p => p.id));
			if ((value.currentPlaceId !== null && !ids.has(value.currentPlaceId)) || value.records.some(r => r.placeId !== null && !ids.has(r.placeId))) throw new Error("Dangling place identity");
			this.state = value;
		} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	}
	enqueue(input: SpatialObservation): Promise<SpatialRecord> {
		const observation = structuredClone(input);
		if (!observation.id || !Number.isFinite(observation.atMs) || !observation.frames.length || observation.frames.some(f => typeof f !== "string" || !f)) return Promise.reject(new Error("Invalid observation"));
		if (this.pending.has(observation.id) || this.state.records.some(r => r.observation.id === observation.id)) return Promise.reject(new Error("Duplicate observation"));
		this.pending.add(observation.id);
		const task = this.tail.then(async () => {
			const previous = this.state.records.at(-1)?.observation;
			if (previous && observation.atMs < previous.atMs) throw new Error("Out-of-order observation");
			// Model context folds old observations into place summaries/representatives.
			// Full raw history remains persisted and available to audit, not resent each call.
			const context = this.snapshot();
			context.records = context.records.slice(-3);
			for (const place of context.places) place.observationIds = place.representatives.map(r => r.id);
			const decision = await this.recognize(structuredClone(observation), context);
			if (!["same", "known", "new", "unknown"].includes(decision.kind) || !decision.reason?.trim() || typeof decision.summary !== "string") throw new Error("Invalid recognition decision");
			const next = this.snapshot();
			let placeId: string | null = null;
			if (decision.kind === "same") placeId = next.currentPlaceId;
			if (decision.kind === "known") placeId = decision.placeId ?? null;
			if ((decision.kind === "same" || decision.kind === "known") && (!placeId || !next.places.some(p => p.id === placeId))) throw new Error("Unsupported historical identity");
			if (decision.kind === "new") {
				placeId = randomUUID();
				next.places.push({ id: placeId, summary: decision.summary, representatives: [], observationIds: [], lastSeenMs: observation.atMs });
			}
			const place = next.places.find(p => p.id === placeId);
			if (place) {
				place.summary = decision.summary || place.summary;
				place.lastSeenMs = observation.atMs;
				place.observationIds.push(observation.id);
				place.representatives.push(observation);
				// Deterministic first + recent views; not claimed to be optimal visual selection.
				if (place.representatives.length > this.representativeLimit) place.representatives.splice(1, 1);
			}
			next.currentPlaceId = placeId; // Unknown must not present stale location as current.
			const record = { observation, decision, placeId };
			next.records.push(record);
			await mkdir(dirname(this.path), { recursive: true });
			const temporary = `${this.path}.${randomUUID()}.tmp`;
			await writeFile(temporary, JSON.stringify(next), "utf8");
			await rename(temporary, this.path);
			this.state = next;
			return structuredClone(record);
		}).finally(() => { this.pending.delete(observation.id); });
		this.tail = task.then(() => {}, () => {}); // One failed call does not poison later observations.
		return task;
	}
	async idle(): Promise<void> { await this.tail; }
	query(text: string): SpatialPlace[] {
		const needle = text.trim().toLocaleLowerCase();
		return this.snapshot().places.filter(p => !needle || p.summary.toLocaleLowerCase().includes(needle));
	}
}
