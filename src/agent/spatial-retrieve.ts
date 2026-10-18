import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { SpatialObservation } from "./incremental-spatial-memory.js";
import type { SpatialEventStore } from "./spatial-event-store.js";
import {calendarFilters,wallTime,type MemoryClock} from './memory-clock.js';
import {memorySummary,type MemoryFact} from './memory-summary.js';

/** Trusted caller scope, never accepted from model tool arguments. Times use server atMs. */
export interface RetrievalScope { asOfMs:number; recordingId?:string; judgmentUnavailableIds?:string[]; clock?:MemoryClock }
export interface RetrievalQuery { query?:string; placeId?:string; beforeMs?:number; afterMs?:number; cursor?:number; limit?:number; atTime?:string;afterTime?:string;beforeTime?:string }
export interface RetrievedObservation { observation:SpatialObservation; placeId:string|null; reason:string; cursor:number }

/** v2 read-only adapter: frozen v1 databases and inference protocol are unchanged. */
export class SpatialRetriever {
	private readonly db:DatabaseSync;
	constructor(path:string,private readonly events:SpatialEventStore|null=null){this.db=new DatabaseSync(path,{readOnly:true});}
	close(){this.db.close();}
	session(scope:RetrievalScope,imageBudget=8){
		if(!Number.isFinite(scope.asOfMs)||!Number.isInteger(imageBudget)||imageBudget<0||imageBudget>24)throw new Error("Invalid retrieval scope/budget");
		return new RetrievalSession(this.db,{...scope},imageBudget,this.events);
	}
}

export class RetrievalSession {
	private remaining:number;
	private allowed=new Map<string,RetrievedObservation>();
	private searches=0;
	readonly inspected=new Set<string>();
	constructor(private readonly db:DatabaseSync,private readonly scope:RetrievalScope,imageBudget:number,private readonly events:SpatialEventStore|null=null){this.remaining=imageBudget;}
	/** Prompt-only view of committed causal per-observation judgments. Does not
	 * register candidates/inspection or read mutable future place summaries. */
	memorySummary(){
		const conditions=['o.pending=0','o.at_ms<?','o.id NOT IN (SELECT value FROM json_each(?))'];
		const args:Array<string|number>=[this.scope.asOfMs,JSON.stringify(this.scope.judgmentUnavailableIds??[])];
		if(this.scope.recordingId!==undefined){conditions.push('o.recording_id=?');args.push(this.scope.recordingId);}
		const select=`SELECT o.id,o.at_ms,a.reason FROM observations o JOIN assignments a ON a.observation_id=o.id WHERE ${conditions.join(' AND ')} AND length(trim(a.reason))>0`;
		const recent=this.db.prepare(select+' ORDER BY o.at_ms DESC,o.seq DESC LIMIT 96').all(...args);
		const anchors=this.db.prepare(select+' ORDER BY o.at_ms ASC,o.seq ASC LIMIT 16').all(...args);
		const unique=new Map<string,MemoryFact>();for(const row of [...anchors,...recent] as Array<{id:string;at_ms:number;reason:string}>)unique.set(row.id,{id:row.id,atMs:row.at_ms,text:row.reason,sourceIds:[row.id],kind:'historical-judgment'});
		return memorySummary([...unique.values()],this.scope.asOfMs,2400,this.scope.clock);
	}
	identity(id:string):string|null{
		if(this.scope.judgmentUnavailableIds?.includes(id))return null;
		const row=this.db.prepare(`SELECT a.place_id FROM assignments a JOIN observations o ON o.id=a.observation_id WHERE o.id=? AND o.at_ms<=? ${this.scope.recordingId===undefined?"":"AND o.recording_id=?"}`).get(id,this.scope.asOfMs,...(this.scope.recordingId===undefined?[]:[this.scope.recordingId])) as {place_id:string|null}|undefined;
		return row?.place_id ?? null;
	}
	search(input:RetrievalQuery={}){
		input=calendarFilters(input,this.scope.clock);
		if(++this.searches>12)throw new Error("Retrieval search budget exceeded");
		const limit=input.limit ?? 6,cursor=input.cursor ?? 0;
		if(!Number.isInteger(limit)||limit<1||limit>24||!Number.isSafeInteger(cursor)||cursor<0)throw new Error("Invalid retrieval page");
		for(const time of [input.beforeMs,input.afterMs])if(time!==undefined&&!Number.isFinite(time))throw new Error("Invalid time filter");
		if(input.query!==undefined&&(typeof input.query!=="string"||input.query.length>1000))throw new Error("Invalid query");
		const terms=(input.query ?? "").trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean).slice(0,8);
		const conditions=["o.pending=0","o.at_ms<=?","o.seq>?"];
		const args:Array<string|number>=[Math.min(this.scope.asOfMs,input.beforeMs ?? this.scope.asOfMs),cursor];
		if(this.scope.recordingId!==undefined){conditions.push("o.recording_id=?");args.push(this.scope.recordingId);}
		if(input.placeId!==undefined){conditions.push("a.place_id=?");args.push(input.placeId);}
		if(input.afterMs!==undefined){conditions.push("o.at_ms>=?");args.push(input.afterMs);}
		// Only per-observation judgments: current mutable place summaries could leak future facts.
		for(const term of terms){conditions.push("instr(lower(a.reason),?)>0");args.push(term);}
		if((terms.length||input.placeId!==undefined)&&this.scope.judgmentUnavailableIds?.length){conditions.push('o.id NOT IN (SELECT value FROM json_each(?))');args.push(JSON.stringify(this.scope.judgmentUnavailableIds));}
		const rows=this.db.prepare(`SELECT o.seq,o.raw,a.place_id,a.reason FROM observations o JOIN assignments a ON a.observation_id=o.id WHERE ${conditions.join(" AND ")} ORDER BY o.seq LIMIT ?`).all(...args,limit+1) as Array<{seq:number;raw:string;place_id:string|null;reason:string}>;
		const hits=rows.slice(0,limit).map(row=>{const observation=JSON.parse(row.raw) as SpatialObservation;const hidden=this.scope.judgmentUnavailableIds?.includes(observation.id);return {observation,placeId:hidden?null:row.place_id,reason:hidden?'':row.reason,cursor:row.seq};});
		for(const hit of hits)this.allowed.set(hit.observation.id,hit);
		return {status:hits.length?"candidates":"unknown",hits:hits.map(hit=>({id:hit.observation.id,atMs:hit.observation.atMs,...this.scope.clock?{recordedTime:wallTime(hit.observation.atMs,this.scope.clock),timeBasis:this.scope.clock.kind}:{},sourceAtMs:hit.observation.sourceAtMs,recordingId:hit.observation.recordingId,placeId:hit.placeId,reason:hit.reason,imageCount:hit.observation.frames.length})),changes:this.events?.search(this.scope,input) ?? [],nextCursor:rows.length>limit?hits.at(-1)!.cursor:null,remainingImages:this.remaining,note:"Historical judgments/change reports are search hints, not visual proof or current state. Lexical AND retrieval; no visual embedding or relevance guarantee."};
	}
	/** Bounded reverse-time baseline lookup, excluding current observation and unknown identities. */
	baseline(placeId:string,beforeMs:number){
		if(!placeId||!Number.isFinite(beforeMs))throw new Error("Invalid baseline scope");
		const recording=this.scope.recordingId;
		const row=this.db.prepare(`SELECT o.seq,o.raw,a.reason FROM observations o JOIN assignments a ON a.observation_id=o.id WHERE a.place_id=? AND o.pending=0 AND o.at_ms<=? AND o.at_ms<? ${recording===undefined?"":"AND o.recording_id=?"} AND o.id NOT IN (SELECT value FROM json_each(?)) ORDER BY o.seq DESC LIMIT 1`).get(placeId,this.scope.asOfMs,beforeMs,...(recording===undefined?[]:[recording]),JSON.stringify(this.scope.judgmentUnavailableIds??[])) as {seq:number;raw:string;reason:string}|undefined;
		if(!row)return null;
		const hit={observation:JSON.parse(row.raw) as SpatialObservation,placeId,reason:row.reason,cursor:row.seq};this.allowed.set(hit.observation.id,hit);return hit;
	}
	async inspect(ids:string[]){
		if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!this.allowed.has(id)))throw new Error("Inspect requires retrieved evidence IDs");
		const hits=ids.map(id=>this.allowed.get(id)!);
		const count=hits.reduce((n,hit)=>n+hit.observation.frames.length,0);
		if(count>this.remaining)throw new Error("Historical image budget exceeded");
		this.remaining-=count;
		const images=await Promise.all(hits.flatMap(hit=>hit.observation.frames.map(async(path,index)=>({id:hit.observation.id,index,atMs:hit.observation.atMs,placeId:hit.placeId,mimeType:extname(path).toLowerCase()===".png"?"image/png":extname(path).toLowerCase()===".webp"?"image/webp":"image/jpeg",data:(await readFile(path)).toString("base64")}))));
		for(const id of ids)this.inspected.add(id);return images;
	}
	validateCitations(ids:string[],abstained=false){if(!Array.isArray(ids)||ids.some(id=>!this.inspected.has(id))||(!abstained&&!ids.length))throw new Error("Answer needs inspected historical evidence");}
	/** Recover a bounded actually recorded sequence, never a synthetic cross-recording route. */
	path(fromPlaceId:string,toPlaceId:string){
		if(!this.scope.recordingId)return {status:"unknown",reason:"Historical path requires one recording scope",observations:[]};
		const rows=this.db.prepare("SELECT o.id,o.seq,a.place_id FROM observations o JOIN assignments a ON a.observation_id=o.id WHERE o.recording_id=? AND o.at_ms<=? AND o.pending=0 ORDER BY o.seq LIMIT 1001").all(this.scope.recordingId,this.scope.asOfMs) as Array<{id:string;seq:number;place_id:string|null}>;
		if(rows.length>1000)return {status:"unknown",reason:"Path scan budget exceeded; narrow recording",observations:[]};
		for(const row of rows)if(this.scope.judgmentUnavailableIds?.includes(row.id))row.place_id=null;
		let start=-1;
		for(let i=0;i<rows.length;i++){
			const row=rows[i]!;
			if(row.place_id===null)start=-1;
			if(row.place_id===fromPlaceId)start=i;
			if(row.place_id===toPlaceId&&start>=0)return {status:"recorded-sequence",observations:rows.slice(start,i+1).map(r=>({id:r.id,placeId:r.place_id})),note:"Observed history only; not a traversability or navigation guarantee."};
		}
		return {status:"unknown",reason:"No uninterrupted recorded sequence in scope",observations:[]};
	}
}
