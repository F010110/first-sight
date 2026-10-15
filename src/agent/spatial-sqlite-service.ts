import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { SpatialSqliteStore } from "./spatial-sqlite-store.js";
import type { SpatialObservation } from "./incremental-spatial-memory.js";
import type { TopologyNode,TopologyState,WindowRecognizer } from "./spatial-topology-service.js";

/** Production v1: history stays in SQLite; inference receives a bounded candidate view. */
export class SpatialSqliteService {
	private database:SpatialSqliteStore|null=null;
	private processing:Promise<void>|null=null;
	private lastStarted=-Infinity;
	constructor(private readonly path:string,private readonly recognize:WindowRecognizer,private readonly legacyPath?:string){}
	private get db():SpatialSqliteStore{if(!this.database)throw new Error("Spatial service not loaded");return this.database;}
	async load():Promise<void>{
		if(this.database)return;
		const db=new SpatialSqliteStore(this.path);
		try{
			if(this.legacyPath && !db.counts().observations && !db.counts().places){
				try{db.importSnapshot(JSON.parse(await readFile(this.legacyPath,"utf8")) as TopologyState);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
			}
			this.database=db;
		}catch(error){db.close();throw error;}
	}
	close():void{if(this.processing)throw new Error("Stop processing before close");this.database?.close();this.database=null;}
	summary(){return this.db.summary();}
	lastObservationTime(){return this.db.lastObservationTime();}
	hasObservation(id:string){return this.db.hasObservation(id);}
	page(limit=100,after=0){return this.db.page(limit,after);}
	context(query=""){return this.db.context(query);}
	place(id:string){return {node:this.db.place(id),visits:this.db.visitSummaries(id),edges:this.db.neighbors(id)};}
	snapshot(){return this.db.exportSnapshot();} // Explicit backup/test only, not status path.
	async ingest(observation:SpatialObservation):Promise<void>{this.db.ingest(structuredClone(observation));}
	tick(nowMs:number,flush=false):Promise<void>{
		if(this.processing)return this.processing;
		const task=this.run(nowMs,flush);this.processing=task;
		void task.finally(()=>{if(this.processing===task)this.processing=null;}).catch(()=>{});return task;
	}
	private async run(nowMs:number,flush:boolean):Promise<void>{
		const batch=this.db.pending(4);if(!batch.length || (!flush && (nowMs-batch[0]!.atMs<10000 || nowMs-this.lastStarted<5000)))return;
		this.lastStarted=nowMs;
		const history=this.db.context();
		const answer=await this.recognize(batch,history);
		if(!answer || !Array.isArray(answer.places) || !Array.isArray(answer.assignments))throw new Error("Invalid topology answer");
		const existing=new Map(history.nodes.map(n=>[n.id,n]));const mapping=new Map([...existing.keys()].map(id=>[id,id]));
		const changed=new Map<string,TopologyNode>();
		for(const place of answer.places){
			if(typeof place.id!=="string" || !place.summary?.trim() || changed.has(mapping.get(place.id) ?? place.id))throw new Error("Invalid/duplicate place");
			if(existing.has(place.id))changed.set(place.id,structuredClone(existing.get(place.id)!));
			else {if(!/^new-[1-9][0-9]*$/.test(place.id))throw new Error("Unknown candidate identity");const id=randomUUID();mapping.set(place.id,id);changed.set(id,{id,summary:place.summary,status:"candidate",representatives:[],lastSeenMs:0});}
		}
		if(answer.assignments.length!==batch.length || new Set(answer.assignments.map(a=>a.observationId)).size!==batch.length)throw new Error("Incomplete assignments");
		const assignments=batch.map(o=>{
			const a=answer.assignments.find(a=>a.observationId===o.id);if(!a || !a.reason?.trim() || (a.placeId!==null && !mapping.has(a.placeId)))throw new Error("Invalid assignment identity");
			const placeId=a.placeId===null?null:mapping.get(a.placeId)!;
			if(placeId){const node=changed.get(placeId) ?? structuredClone(existing.get(placeId)!);node.lastSeenMs=o.atMs;node.representatives.push(o);if(node.representatives.length>2)node.representatives.splice(1,1);changed.set(placeId,node);}
			return {...a,placeId};
		});
		this.db.commit(assignments,[...changed.values()]);
	}
	async revise(...args:Parameters<SpatialSqliteStore['revise']>):Promise<string>{if(this.processing)throw new Error("Pause recognition before revising");return this.db.revise(...args);}
	async undo(...args:Parameters<SpatialSqliteStore['undo']>):Promise<void>{if(this.processing)throw new Error("Pause recognition before undo");this.db.undo(...args);}
}
