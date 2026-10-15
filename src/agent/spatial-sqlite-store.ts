import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SpatialObservation } from "./incremental-spatial-memory.js";
import type { TopologyAssignment, TopologyNode, TopologyState } from "./spatial-topology-service.js";

/** Indexed durable history; full export is explicit, never needed for ingestion or retrieval. */
export class SpatialSqliteStore {
	private readonly db: DatabaseSync;
	constructor(path: string) {
		mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);
		this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
		CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS observations(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,at_ms REAL NOT NULL,recording_id TEXT,raw TEXT NOT NULL,pending INTEGER NOT NULL DEFAULT 1);
		CREATE INDEX IF NOT EXISTS observation_pending ON observations(pending,seq);
		CREATE INDEX IF NOT EXISTS observation_recording ON observations(recording_id,at_ms);
		CREATE TABLE IF NOT EXISTS places(id TEXT PRIMARY KEY,summary TEXT NOT NULL,status TEXT NOT NULL,last_seen_ms REAL NOT NULL,raw TEXT NOT NULL);
		CREATE INDEX IF NOT EXISTS place_recent ON places(status,last_seen_ms DESC);
		CREATE TABLE IF NOT EXISTS assignments(observation_id TEXT PRIMARY KEY REFERENCES observations(id),place_id TEXT REFERENCES places(id),reason TEXT NOT NULL,raw TEXT NOT NULL);
		CREATE INDEX IF NOT EXISTS assignment_place ON assignments(place_id,observation_id);
		CREATE TABLE IF NOT EXISTS transitions(from_observation_id TEXT NOT NULL REFERENCES observations(id),to_observation_id TEXT PRIMARY KEY REFERENCES observations(id),from_place TEXT NOT NULL REFERENCES places(id),to_place TEXT NOT NULL REFERENCES places(id));
		CREATE INDEX IF NOT EXISTS transition_places ON transitions(from_place,to_place);
		CREATE TABLE IF NOT EXISTS visits(id TEXT PRIMARY KEY,place_id TEXT NOT NULL REFERENCES places(id),recording_id TEXT,start_observation_id TEXT NOT NULL REFERENCES observations(id),end_observation_id TEXT NOT NULL REFERENCES observations(id),start_ms REAL NOT NULL,end_ms REAL NOT NULL);
		CREATE INDEX IF NOT EXISTS visits_place ON visits(place_id,end_ms DESC);
		CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,seq INTEGER UNIQUE NOT NULL,raw TEXT NOT NULL);
		CREATE VIRTUAL TABLE IF NOT EXISTS place_search USING fts5(id UNINDEXED,summary,tokenize='trigram');`);
		const version=this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get() as {value:string}|undefined;
		if(version && version.value!=="1")throw new Error("Unsupported spatial database schema");
		this.db.prepare("INSERT OR IGNORE INTO metadata VALUES('schema','1')").run();
	}
	close():void{this.db.close();}
	private atomic<T>(action:()=>T):T {
		this.db.exec("BEGIN IMMEDIATE");try{const value=action();this.db.exec("COMMIT");return value;}catch(error){this.db.exec("ROLLBACK");throw error;}
	}
	counts(){
		const count=(table:string)=>(this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {n:number}).n;
		return {observations:count("observations"),places:count("places"),assignments:count("assignments"),visits:count("visits"),transitions:count("transitions"),pending:(this.db.prepare("SELECT COUNT(*) AS n FROM observations WHERE pending=1").get() as {n:number}).n};
	}
	private insertObservation(observation:SpatialObservation,pending=true):void {
		if(!observation.id || !Number.isFinite(observation.atMs) || !observation.frames.length)throw new Error("Invalid observation");
		this.db.prepare("INSERT INTO observations(id,at_ms,recording_id,raw,pending) VALUES(?,?,?,?,?)").run(observation.id,observation.atMs,observation.recordingId ?? null,JSON.stringify(observation),Number(pending));
	}
	ingest(observation:SpatialObservation,maxPending=120):void {
		this.atomic(()=>{
			const pending=(this.db.prepare("SELECT COUNT(*) AS n FROM observations WHERE pending=1").get() as {n:number}).n;
			if(!Number.isInteger(maxPending)||maxPending<1 || pending>=maxPending)throw new Error("Spatial inbox full or invalid capacity");
			const last=this.db.prepare("SELECT at_ms FROM observations ORDER BY seq DESC LIMIT 1").get() as {at_ms:number}|undefined;
			if(last && observation.atMs<last.at_ms)throw new Error("Out-of-order observation");
			this.insertObservation(observation);
		});
	}
	pending(limit=4):SpatialObservation[]{
		this.limit(limit);return (this.db.prepare("SELECT raw FROM observations WHERE pending=1 ORDER BY seq LIMIT ?").all(limit) as Array<{raw:string}>).map(r=>JSON.parse(r.raw) as SpatialObservation);
	}
	private limit(value:number):void{if(!Number.isInteger(value)||value<1||value>1000)throw new Error("Limit must be 1..1000");}
	private upsertPlace(node:TopologyNode):void {
		if(!node.id || !node.summary.trim() || node.representatives.length>2)throw new Error("Invalid place or representative budget");
		this.db.prepare("INSERT INTO places VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET summary=excluded.summary,status=excluded.status,last_seen_ms=excluded.last_seen_ms,raw=excluded.raw").run(node.id,node.summary,node.status ?? "candidate",node.lastSeenMs,JSON.stringify(node));
		this.db.prepare("DELETE FROM place_search WHERE id=?").run(node.id);
		if(node.status!=="retired")this.db.prepare("INSERT INTO place_search(id,summary) VALUES(?,?)").run(node.id,node.summary);
	}
	private appendAssignment(assignment:TopologyAssignment):void {
		const row=this.db.prepare("SELECT raw,seq FROM observations WHERE id=?").get(assignment.observationId) as {raw:string;seq:number}|undefined;
		if(!row)throw new Error("Missing observation");
		const observation=JSON.parse(row.raw) as SpatialObservation;
		const previous=this.db.prepare("SELECT a.raw AS assignment,o.raw AS observation FROM assignments a JOIN observations o ON a.observation_id=o.id WHERE o.seq<? ORDER BY o.seq DESC LIMIT 1").get(row.seq) as {assignment:string;observation:string}|undefined;
		const a=previous?JSON.parse(previous.assignment) as TopologyAssignment:null;
		const o=previous?JSON.parse(previous.observation) as SpatialObservation:null;
		this.db.prepare("INSERT INTO assignments VALUES(?,?,?,?)").run(assignment.observationId,assignment.placeId,assignment.reason,JSON.stringify(assignment));
		if(a?.placeId && assignment.placeId && a.placeId!==assignment.placeId && o?.recordingId===observation.recordingId)this.db.prepare("INSERT INTO transitions VALUES(?,?,?,?)").run(a.observationId,assignment.observationId,a.placeId,assignment.placeId);
		if(assignment.placeId){
			const last=this.db.prepare("SELECT id,place_id,recording_id,end_observation_id FROM visits ORDER BY rowid DESC LIMIT 1").get() as {id:string;place_id:string;recording_id:string|null;end_observation_id:string}|undefined;
			if(last && last.place_id===assignment.placeId && last.recording_id===(observation.recordingId ?? null) && a?.observationId===last.end_observation_id)this.db.prepare("UPDATE visits SET end_observation_id=?,end_ms=? WHERE id=?").run(observation.id,observation.atMs,last.id);
			else this.db.prepare("INSERT INTO visits VALUES(?,?,?,?,?,?,?)").run(`visit:${observation.id}`,assignment.placeId,observation.recordingId ?? null,observation.id,observation.id,observation.atMs,observation.atMs);
		}
		this.db.prepare("UPDATE observations SET pending=0 WHERE id=?").run(assignment.observationId);
	}
	/** Nodes already carry stable IDs. Commit exactly the oldest pending batch, all or nothing. */
	commit(assignments:TopologyAssignment[],nodes:TopologyNode[]):void {
		if(!assignments.length)throw new Error("Empty commit");
		this.atomic(()=>{
			const expected=this.pending(assignments.length).map(o=>o.id);
			if(expected.length!==assignments.length || assignments.some((a,i)=>a.observationId!==expected[i] || !a.reason.trim()))throw new Error("Commit must match pending prefix");
			for(const node of nodes)this.upsertPlace(node);
			for(const assignment of assignments)this.appendAssignment(assignment);
		});
	}
	/** Bounded candidates; FTS handles partial English/Chinese substrings of >=3 chars. */
	candidates(query:string,limit=6):TopologyNode[]{
		this.limit(limit);
		const text=query.trim();
		const rows=text.length>=3 ? this.db.prepare("SELECT p.raw FROM place_search f JOIN places p ON p.id=f.id WHERE place_search MATCH ? ORDER BY rank LIMIT ?").all('"'+text.replace(/"/g,'""')+'"',limit) : this.db.prepare("SELECT raw FROM places WHERE status!='retired' ORDER BY last_seen_ms DESC LIMIT ?").all(limit);
		return (rows as Array<{raw:string}>).map(r=>JSON.parse(r.raw) as TopologyNode);
	}
	visits(placeId:string,limit=10){this.limit(limit);return this.db.prepare("SELECT * FROM visits WHERE place_id=? ORDER BY end_ms DESC LIMIT ?").all(placeId,limit);}
	importSnapshot(snapshot:TopologyState):void {
		this.atomic(()=>{
			if(this.counts().observations || this.counts().places)throw new Error("Import requires empty database");
			if(snapshot.version!==1)throw new Error("Unsupported snapshot");
			const pending=new Set(snapshot.pending);
			for(const observation of snapshot.observations)this.insertObservation(observation,pending.has(observation.id));
			for(const node of snapshot.nodes)this.upsertPlace(node);
			for(const assignment of snapshot.assignments)this.appendAssignment(assignment);
			(snapshot.revisions ?? []).forEach((revision,i)=>this.db.prepare("INSERT INTO revisions VALUES(?,?,?)").run(revision.id,i,JSON.stringify(revision)));
		});
	}
	exportSnapshot():TopologyState {
		const parse=<T>(rows:unknown[])=> (rows as Array<{raw:string}>).map(r=>JSON.parse(r.raw) as T);
		const assignments=parse<TopologyAssignment>(this.db.prepare("SELECT a.raw FROM assignments a JOIN observations o ON o.id=a.observation_id ORDER BY o.seq").all());
		const edges:TopologyState['edges']=[];
		for(const row of this.db.prepare("SELECT * FROM transitions ORDER BY rowid").all() as Array<{from_place:string;to_place:string;from_observation_id:string;to_observation_id:string}>){
			let edge=edges.find(e=>e.from===row.from_place && e.to===row.to_place);if(!edge){edge={from:row.from_place,to:row.to_place,evidence:[]};edges.push(edge);}
			edge.evidence.push({fromObservationId:row.from_observation_id,toObservationId:row.to_observation_id});
		}
		return {version:1,observations:parse<SpatialObservation>(this.db.prepare("SELECT raw FROM observations ORDER BY seq").all()),pending:(this.db.prepare("SELECT id FROM observations WHERE pending=1 ORDER BY seq").all() as Array<{id:string}>).map(r=>r.id),nodes:parse<TopologyNode>(this.db.prepare("SELECT raw FROM places ORDER BY rowid").all()),assignments,edges,currentPlaceId:assignments.at(-1)?.placeId ?? null,revisions:parse<NonNullable<TopologyState['revisions']>[number]>(this.db.prepare("SELECT raw FROM revisions ORDER BY seq").all())};
	}
}
