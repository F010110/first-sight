import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { RetrievalScope,RetrievalQuery } from "./spatial-retrieve.js";

/** Separate v2 audit DB; frozen v1 identity/observation database is not rewritten. */
export class SpatialEventStore {
	private readonly db:DatabaseSync;
	constructor(path:string){
		this.db=new DatabaseSync(path);this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS comparisons(id TEXT PRIMARY KEY,observation_id TEXT NOT NULL,baseline_id TEXT NOT NULL,place_id TEXT NOT NULL,recording_id TEXT,at_ms REAL NOT NULL,changed INTEGER NOT NULL,what TEXT,raw TEXT NOT NULL,UNIQUE(observation_id,baseline_id)); CREATE INDEX IF NOT EXISTS comparison_scope ON comparisons(place_id,at_ms);");
	}
	close(){this.db.close();}
	record(value:{observationId:string;baselineId:string;placeId:string;recordingId?:string;atMs:number;changed:boolean;what:string|null;result:unknown}){
		if(!value.observationId||!value.baselineId||!value.placeId||!Number.isFinite(value.atMs)||(value.changed&&!value.what?.trim()))throw new Error("Invalid comparison provenance");
		this.db.prepare("INSERT OR IGNORE INTO comparisons VALUES(?,?,?,?,?,?,?,?,?)").run(randomUUID(),value.observationId,value.baselineId,value.placeId,value.recordingId ?? null,value.atMs,Number(value.changed),value.what,JSON.stringify(value.result));
	}
	search(scope:RetrievalScope,query:RetrievalQuery){
		const clauses=["at_ms<=?","changed=1"],args:Array<string|number>=[Math.min(scope.asOfMs,query.beforeMs ?? scope.asOfMs)];
		if(scope.recordingId!==undefined){clauses.push("recording_id=?");args.push(scope.recordingId);}
		if(query.placeId!==undefined){clauses.push("place_id=?");args.push(query.placeId);}
		if(query.afterMs!==undefined){clauses.push("at_ms>=?");args.push(query.afterMs);}
		for(const term of (query.query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0,8)){clauses.push("instr(lower(what),?)>0");args.push(term);}
		return this.db.prepare(`SELECT observation_id,baseline_id,place_id,recording_id,at_ms,what FROM comparisons WHERE ${clauses.join(" AND ")} ORDER BY at_ms DESC LIMIT 6`).all(...args);
	}
}
