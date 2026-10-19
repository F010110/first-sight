import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
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
	hasObservation(id:string):boolean{return !!this.db.prepare("SELECT 1 FROM observations WHERE id=?").get(id);}
	summary(){
		const pending=(this.db.prepare("SELECT COUNT(*) AS n FROM observations WHERE pending=1").get() as {n:number}).n;
		const row=this.db.prepare("SELECT a.place_id,o.at_ms FROM assignments a JOIN observations o ON o.id=a.observation_id ORDER BY o.seq DESC LIMIT 1").get() as {place_id:string|null;at_ms:number}|undefined;
		return {pending,currentPlaceId:row?.place_id ?? null,lastConfirmedAtMs:row?.at_ms ?? null};
	}
	lastObservationTime():number{return (this.db.prepare("SELECT at_ms FROM observations ORDER BY seq DESC LIMIT 1").get() as {at_ms:number}|undefined)?.at_ms ?? -1;}
	page(limit=100,after=0){
		this.limit(limit);if(!Number.isSafeInteger(after)||after<0)throw new Error("Invalid cursor");
		const rows=this.db.prepare("SELECT o.seq,o.raw,a.raw AS assignment FROM observations o LEFT JOIN assignments a ON a.observation_id=o.id WHERE o.seq>? ORDER BY o.seq LIMIT ?").all(after,limit) as Array<{seq:number;raw:string;assignment:string|null}>;
		return {observations:rows.map(r=>JSON.parse(r.raw) as SpatialObservation),assignments:rows.filter(r=>r.assignment).map(r=>JSON.parse(r.assignment!) as TopologyAssignment),nextCursor:rows.at(-1)?.seq ?? after};
	}
	context(query="",limit=6):TopologyState {
		this.limit(limit);const recent=this.candidates("",limit),matched=query.trim().length>=3?this.candidates(query,limit):[];
		const current=this.summary().currentPlaceId;
		const neighbors=current ? (this.db.prepare("SELECT p.raw FROM places p JOIN (SELECT to_place AS id,COUNT(*) AS n FROM transitions WHERE from_place=? GROUP BY to_place) t ON t.id=p.id WHERE p.status!='retired' ORDER BY t.n DESC,p.last_seen_ms DESC LIMIT ?").all(current,Math.min(limit,2)) as Array<{raw:string}>).map(r=>JSON.parse(r.raw) as TopologyNode) : [];
		const nodes=[...new Map([...recent.slice(0,1),...matched,...neighbors,...recent].map(n=>[n.id,n])).values()].slice(0,limit);
		const rows=this.db.prepare("SELECT a.raw FROM assignments a JOIN observations o ON o.id=a.observation_id ORDER BY o.seq DESC LIMIT 4").all() as Array<{raw:string}>;
		return {version:1,observations:[],pending:[],assignments:rows.reverse().map(r=>JSON.parse(r.raw) as TopologyAssignment),nodes,edges:[],currentPlaceId:this.summary().currentPlaceId,revisions:[]};
	}
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
 observation(id:string):SpatialObservation|null{const row=this.db.prepare('SELECT raw FROM observations WHERE id=?').get(id) as {raw:string}|undefined;return row?JSON.parse(row.raw) as SpatialObservation:null;}
 assignment(id:string):TopologyAssignment|null{const row=this.db.prepare('SELECT raw FROM assignments WHERE observation_id=?').get(id) as {raw:string}|undefined;return row?JSON.parse(row.raw) as TopologyAssignment:null;}
 workingHistory(cutoffMs:number){
  const select='SELECT o.raw AS observation,a.raw AS assignment FROM observations o JOIN assignments a ON a.observation_id=o.id WHERE o.at_ms<? AND o.pending=0';
  const recent=this.db.prepare(select+' ORDER BY o.at_ms DESC,o.seq DESC LIMIT 6').all(cutoffMs);
  const early=this.db.prepare(select+' ORDER BY o.at_ms ASC,o.seq ASC LIMIT 4').all(cutoffMs);
  const rows=new Map<string,{observation:SpatialObservation;assignment:TopologyAssignment}>();
  for(const row of [...early,...recent] as Array<{observation:string;assignment:string}>){const observation=JSON.parse(row.observation) as SpatialObservation;rows.set(observation.id,{observation,assignment:JSON.parse(row.assignment) as TopologyAssignment});}
  return [...rows.values()].sort((a,b)=>a.observation.atMs-b.observation.atMs);
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
 reassess(assignment:TopologyAssignment,node?:TopologyNode):void{
  this.atomic(()=>{
   const old=this.db.prepare('SELECT raw FROM assignments WHERE observation_id=?').get(assignment.observationId) as {raw:string}|undefined;
   if(!old||!assignment.reason.trim())throw Error('Reassessment needs processed observation');
   const previous=JSON.parse(old.raw) as TopologyAssignment;
   const nodes=[...new Set([previous.placeId,assignment.placeId].filter((id):id is string=>id!==null))];
   const affected=[assignment.observationId],before=this.capture(nodes,affected);
   if(node)this.upsertPlace(node);
   if(assignment.placeId&&!this.db.prepare('SELECT 1 FROM places WHERE id=?').get(assignment.placeId))throw Error('Unknown reassessment place');
   this.db.prepare('UPDATE assignments SET place_id=?,reason=?,raw=? WHERE observation_id=?').run(assignment.placeId,assignment.reason,JSON.stringify({...assignment,originalPlaceId:previous.originalPlaceId??previous.placeId}),assignment.observationId);
   this.rebuildRecordings(affected);for(const id of nodes)this.refreshPlace(id);
   this.logRevision({id:randomUUID(),kind:'reassess',reason:assignment.reason,evidenceIds:affected,before:JSON.stringify(before),after:JSON.stringify(this.capture(nodes,affected)),format:'sqlite-local-v1'});
  });
 }
	commit(assignments:TopologyAssignment[],nodes:TopologyNode[]):void {
		if(!assignments.length)throw new Error("Empty commit");
		this.atomic(()=>{
			const expected=this.pending(assignments.length).map(o=>o.id);
			if(expected.length!==assignments.length || assignments.some((a,i)=>a.observationId!==expected[i] || !a.reason.trim()))throw new Error("Commit must match pending prefix");
			for(const node of nodes)this.upsertPlace(node);
			for(const assignment of assignments){
				if(assignment.placeId!==null && !this.db.prepare("SELECT 1 FROM places WHERE id=? AND status!='retired'").get(assignment.placeId))throw new Error("Assignment needs active known place");
				this.appendAssignment(assignment);
			}
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
	place(id:string):TopologyNode|null{const row=this.db.prepare("SELECT raw FROM places WHERE id=?").get(id) as {raw:string}|undefined;return row?JSON.parse(row.raw) as TopologyNode:null;}
	visitSummaries(placeId:string,limit=10){
		this.limit(limit);
		// Fold each visit to interval, endpoint evidence and stable place description.
		return this.db.prepare("SELECT v.*,p.summary AS place_summary FROM visits v JOIN places p ON p.id=v.place_id WHERE v.place_id=? ORDER BY v.end_ms DESC LIMIT ?").all(placeId,limit);
	}
	neighbors(placeId:string,limit=20){this.limit(limit);return this.db.prepare("SELECT from_place,to_place,COUNT(*) AS evidence_count FROM transitions WHERE from_place=? OR to_place=? GROUP BY from_place,to_place LIMIT ?").all(placeId,placeId,limit);}
	private capture(nodeIds:string[],observationIds:string[]) {
		return {format:"sqlite-local-v1",nodes:nodeIds.map(id=>({id,raw:(this.db.prepare("SELECT raw FROM places WHERE id=?").get(id) as {raw:string}|undefined)?.raw ?? null,references:(this.db.prepare("SELECT COUNT(*) AS n FROM assignments WHERE place_id=?").get(id) as {n:number}).n})),assignments:observationIds.map(id=>({id,raw:(this.db.prepare("SELECT raw FROM assignments WHERE observation_id=?").get(id) as {raw:string}|undefined)?.raw ?? null}))};
	}
	private rebuildRecordings(observationIds:string[]):void {
		const recordings=new Set(observationIds.map(id=>(this.db.prepare("SELECT recording_id FROM observations WHERE id=?").get(id) as {recording_id:string|null}).recording_id));
		for(const recording of recordings){
			this.db.prepare("DELETE FROM transitions WHERE to_observation_id IN (SELECT id FROM observations WHERE recording_id IS ?)").run(recording);
			this.db.prepare("DELETE FROM visits WHERE recording_id IS ?").run(recording);
			const rows=this.db.prepare("SELECT a.raw AS assignment,o.raw AS observation FROM assignments a JOIN observations o ON a.observation_id=o.id WHERE o.recording_id IS ? ORDER BY o.seq").iterate(recording);
			let previous:TopologyAssignment|null=null,visitId:string|null=null;
			for(const value of rows){
				const row=value as {assignment:string;observation:string},a=JSON.parse(row.assignment) as TopologyAssignment,o=JSON.parse(row.observation) as SpatialObservation;
				if(previous?.placeId && a.placeId && previous.placeId!==a.placeId)this.db.prepare("INSERT INTO transitions VALUES(?,?,?,?)").run(previous.observationId,a.observationId,previous.placeId,a.placeId);
				if(a.placeId){
					if(visitId && previous?.placeId===a.placeId)this.db.prepare("UPDATE visits SET end_observation_id=?,end_ms=? WHERE id=?").run(o.id,o.atMs,visitId);
					else {visitId=`visit:${o.id}`;this.db.prepare("INSERT INTO visits VALUES(?,?,?,?,?,?,?)").run(visitId,a.placeId,recording,o.id,o.id,o.atMs,o.atMs);}
				}else visitId=null;
				previous=a;
			}
		}
	}
	private refreshPlace(id:string):void {
		const row=this.db.prepare("SELECT raw FROM places WHERE id=?").get(id) as {raw:string}|undefined;if(!row)return;
		const node=JSON.parse(row.raw) as TopologyNode;
		const first=this.db.prepare("SELECT o.raw FROM assignments a JOIN observations o ON o.id=a.observation_id WHERE a.place_id=? ORDER BY o.seq LIMIT 1").get(id) as {raw:string}|undefined;
		const last=this.db.prepare("SELECT o.raw FROM assignments a JOIN observations o ON o.id=a.observation_id WHERE a.place_id=? ORDER BY o.seq DESC LIMIT 1").get(id) as {raw:string}|undefined;
		node.representatives=[];if(first)node.representatives.push(JSON.parse(first.raw) as SpatialObservation);if(last && last.raw!==first?.raw)node.representatives.push(JSON.parse(last.raw) as SpatialObservation);
		node.lastSeenMs=node.representatives.at(-1)?.atMs ?? 0;this.upsertPlace(node);
	}
	private logRevision(value:Record<string,unknown>):void {
		const seq=(this.db.prepare("SELECT COALESCE(MAX(seq),-1)+1 AS n FROM revisions").get() as {n:number}).n;
		this.db.prepare("INSERT INTO revisions VALUES(?,?,?)").run(value.id as string,seq,JSON.stringify(value));
	}
	/** Local reversible identity edits. No complete graph snapshots are stored. */
	revise(kind:"merge"|"split"|"confirm",sourceId:string,reason:string,evidenceIds:string[],options:{targetId?:string;summary?:string}={}):string {
		return this.atomic(()=>{
			const sourceRow=this.db.prepare("SELECT raw FROM places WHERE id=? AND status!='retired'").get(sourceId) as {raw:string}|undefined;
			if(!sourceRow || !reason.trim() || !evidenceIds.length || new Set(evidenceIds).size!==evidenceIds.length)throw new Error("Invalid revision source/reason/evidence");
			for(const id of evidenceIds)if(!this.db.prepare("SELECT 1 FROM assignments WHERE observation_id=?").get(id))throw new Error("Evidence must be processed");
			const source=JSON.parse(sourceRow.raw) as TopologyNode;
			let affected:string[]=[],nodeIds=[sourceId],newId:string|undefined;
			if(kind==="merge"){
				if(!options.targetId || options.targetId===sourceId || !this.db.prepare("SELECT 1 FROM places WHERE id=? AND status!='retired'").get(options.targetId))throw new Error("Invalid merge target");
				nodeIds.push(options.targetId);affected=(this.db.prepare("SELECT observation_id FROM assignments WHERE place_id=? ORDER BY observation_id").all(sourceId) as Array<{observation_id:string}>).map(r=>r.observation_id);
			}else if(kind==="split"){
				if(!options.summary?.trim() || evidenceIds.some(id=>!(this.db.prepare("SELECT 1 FROM assignments WHERE observation_id=? AND place_id=?").get(id,sourceId))) || evidenceIds.length >= (this.db.prepare("SELECT COUNT(*) AS n FROM assignments WHERE place_id=?").get(sourceId) as {n:number}).n)throw new Error("Split needs proper source subset and summary");
				newId=randomUUID();nodeIds.push(newId);affected=[...evidenceIds];
			}else if(kind!=="confirm")throw new Error("Unknown revision kind");
			const before=this.capture(nodeIds,affected);
			if(kind==="confirm"){source.status="confirmed";this.upsertPlace(source);}
			if(kind==="merge"){source.status="retired";this.upsertPlace(source);}
			if(newId)this.upsertPlace({id:newId,summary:options.summary!,status:"candidate",representatives:[],lastSeenMs:0});
			for(const id of affected){
				const a=JSON.parse((this.db.prepare("SELECT raw FROM assignments WHERE observation_id=?").get(id) as {raw:string}).raw) as TopologyAssignment;
				if(a.originalPlaceId===undefined)a.originalPlaceId=a.placeId;a.placeId=kind==="merge"?options.targetId!:newId!;
				this.db.prepare("UPDATE assignments SET place_id=?,raw=? WHERE observation_id=?").run(a.placeId,JSON.stringify(a),id);
			}
			this.rebuildRecordings(affected);for(const id of nodeIds)this.refreshPlace(id);
			const id=randomUUID();this.logRevision({id,kind,reason,evidenceIds,before:JSON.stringify(before),after:JSON.stringify(this.capture(nodeIds,affected)),format:"sqlite-local-v1"});return id;
		});
	}
	undo(revisionId:string,reason:string):void {
		this.atomic(()=>{
			const row=this.db.prepare("SELECT raw FROM revisions WHERE id=?").get(revisionId) as {raw:string}|undefined;
			if(!row || !reason.trim())throw new Error("Invalid undo request");
			const revision=JSON.parse(row.raw) as {kind:string;format?:string;before:string;after:string;evidenceIds:string[]};
			if(revision.kind==="undo" || revision.format!=="sqlite-local-v1")throw new Error("Only local SQLite edits support this undo");
			const before=JSON.parse(revision.before) as ReturnType<SpatialSqliteStore['capture']>,after=JSON.parse(revision.after) as ReturnType<SpatialSqliteStore['capture']>;
			const nodes=after.nodes.map(n=>n.id),ids=after.assignments.map(a=>a.id);
			if(JSON.stringify(this.capture(nodes,ids))!==revision.after)throw new Error("Undo conflicts with subsequent identity changes");
			// A newly split node must not have acquired additional assignments since the edit.
			for(const node of before.nodes.filter(n=>n.raw===null)){
				const references=this.db.prepare("SELECT observation_id FROM assignments WHERE place_id=?").all(node.id) as Array<{observation_id:string}>;
				if(references.some(r=>!ids.includes(r.observation_id)))throw new Error("Undo conflicts with new assignments");
			}
			for(const node of before.nodes)if(node.raw)this.upsertPlace(JSON.parse(node.raw) as TopologyNode);
			for(const entry of before.assignments){const a=JSON.parse(entry.raw!) as TopologyAssignment;this.db.prepare("UPDATE assignments SET place_id=?,raw=? WHERE observation_id=?").run(a.placeId,entry.raw,entry.id);}
			this.rebuildRecordings(ids);
			for(const node of before.nodes)if(node.raw===null){this.db.prepare("DELETE FROM place_search WHERE id=?").run(node.id);this.db.prepare("DELETE FROM places WHERE id=?").run(node.id);}
			this.logRevision({id:randomUUID(),kind:"undo",undoOf:revisionId,reason,evidenceIds:revision.evidenceIds,format:"sqlite-local-v1",before:revision.after,after:revision.before});
		});
	}
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
