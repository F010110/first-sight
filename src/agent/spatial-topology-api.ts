import { mkdir,writeFile,statfs } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { type WindowRecognizer } from "./spatial-topology-service.js";
import { SpatialSqliteService } from "./spatial-sqlite-service.js";
import { SpatialTopologyWorker } from "./spatial-topology-worker.js";

/** Auth/session ownership is enforced by the caller; client paths are never accepted. */
export class SpatialTopologyApi {
	readonly service: SpatialSqliteService;
	readonly worker: SpatialTopologyWorker;
	private operations: Promise<void> = Promise.resolve();
	constructor(private readonly root: string, recognize: WindowRecognizer) {
		this.service=new SpatialSqliteService(join(root,"topology.sqlite"),recognize,join(root,"topology.json"));
		this.worker=new SpatialTopologyWorker(this.service);
	}
	async load(): Promise<void>{await this.service.load();} // Never starts billing on load.
	execute(input: Record<string,unknown>): Promise<unknown> {
		const task=this.operations.then(()=>this.handle(input));this.operations=task.then(()=>{},()=>{});return task;
	}
	private async handle(input: Record<string,unknown>): Promise<unknown> {
		const action=input.action ?? "status";
		if(action==="status")return this.worker.status();
		if(action==="snapshot")return {status:this.worker.status(),graph:{...this.service.page(typeof input.limit==="number"?input.limit:100,typeof input.cursor==="number"?input.cursor:0),nodes:this.service.context().nodes},note:"Paged observations; nodes are bounded recent candidates, not the complete graph."};
		if(action==="search"){
			if(typeof input.query!=="string" || input.query.length>1000)throw new Error("Invalid search query");
			return {status:this.worker.status(),nodes:this.service.context(input.query).nodes};
		}
		if(action==="place"){
			if(typeof input.placeId!=="string" || input.placeId.length>160)throw new Error("Invalid place ID");
			return this.service.place(input.placeId);
		}
		if(action==="start"){this.worker.resume();this.worker.start();return this.worker.status();}
		if(action==="stop"){await this.worker.stop();return this.worker.status();}
		if(action==="observe"){
			if(typeof input.id!=="string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(input.id) || typeof input.recordingId!=="string" || !/^[A-Za-z0-9_-]{1,80}$/.test(input.recordingId) || typeof input.sourceAtMs!=="number" || !Number.isFinite(input.sourceAtMs) || input.sourceAtMs<0 || !Array.isArray(input.frames) || input.frames.length<1 || input.frames.length>4)throw new Error("Invalid observation identity/time/frames");
			const frames=input.frames.map(value=>{
				const row=value as Record<string,unknown>;
				if(!row || typeof row.dataBase64!=="string" || row.dataBase64.length>2000000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(row.dataBase64))throw new Error("Invalid image encoding");
				const extension=row.mimeType==="image/jpeg"?"jpg":row.mimeType==="image/png"?"png":row.mimeType==="image/webp"?"webp":null;
				const bytes=Buffer.from(row.dataBase64,"base64");
				if(!extension || !bytes.length || bytes.length>1500000)throw new Error("Invalid image type/size");
				const valid=extension==="png" ? bytes.length>=33 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString("ascii",12,16)==="IHDR" && bytes.readUInt32BE(16)>0 && bytes.readUInt32BE(20)>0 && bytes.readUInt32BE(16)*bytes.readUInt32BE(20)<=20000000 : extension==="jpg" ? bytes.length>=4 && bytes[0]===255 && bytes[1]===216 && bytes.at(-2)===255 && bytes.at(-1)===217 : bytes.length>=12 && bytes.toString("ascii",0,4)==="RIFF" && bytes.toString("ascii",8,12)==="WEBP";
				if(!valid)throw new Error("Image header does not match MIME type");
				return {extension,bytes};
			});
			if(this.service.summary().pending>=120)throw new Error("Spatial inbox full; retain source and retry later");
			if(this.service.hasObservation(input.id))throw new Error("Duplicate observation");
			await mkdir(this.root,{recursive:true});const disk=await statfs(this.root);
			if(disk.bavail*disk.bsize<512*1024*1024+frames.reduce((n,f)=>n+f.bytes.length,0))throw new Error("Low disk space; retain source and retry later");
			const atMs=Math.max(Date.now(),this.service.lastObservationTime()+1);
			const directory=join(this.root,"images",new Date().toISOString().slice(0,7),input.recordingId,randomUUID());await mkdir(directory,{recursive:true});
			const paths=[];
			for(let i=0;i<frames.length;i++){const frame=frames[i]!,path=join(directory,`${i}.${frame.extension}`);await writeFile(path,frame.bytes,{flag:"wx"});paths.push(path);}
			await this.worker.accept({id:input.id,recordingId:input.recordingId,sourceAtMs:input.sourceAtMs,atMs,frames:paths});
			return {accepted:true,status:this.worker.status()};
		}
		if(action==="revise" || action==="undo"){
			if(this.worker.status().running || this.worker.status().busy)throw new Error("Stop worker before revision");
			if(typeof input.reason!=="string" || input.reason.length>2000)throw new Error("Invalid revision reason");
			if(action==="undo"){
				if(typeof input.revisionId!=="string")throw new Error("Missing revision ID");
				await this.service.undo(input.revisionId,input.reason);return {status:this.worker.status()};
			}
			if(!["merge","split","confirm"].includes(String(input.kind)) || typeof input.sourceId!=="string" || !Array.isArray(input.evidenceIds) || input.evidenceIds.some(id=>typeof id!=="string"))throw new Error("Invalid revision fields");
			if(input.targetId!==undefined && typeof input.targetId!=="string" || input.summary!==undefined && typeof input.summary!=="string")throw new Error("Invalid revision options");
			const id=await this.service.revise(input.kind as "merge"|"split"|"confirm",input.sourceId,input.reason,input.evidenceIds as string[],{...(typeof input.targetId==="string"?{targetId:input.targetId}:{}),...(typeof input.summary==="string"?{summary:input.summary}:{})});
			return {revisionId:id,status:this.worker.status()};
		}
		throw new Error("Unknown spatial action");
	}
}
