import { mkdir,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SpatialTopologyService, type WindowRecognizer } from "./spatial-topology-service.js";
import { SpatialTopologyWorker } from "./spatial-topology-worker.js";

/** Auth/session ownership is enforced by the caller; client paths are never accepted. */
export class SpatialTopologyApi {
	readonly service: SpatialTopologyService;
	readonly worker: SpatialTopologyWorker;
	private operations: Promise<void> = Promise.resolve();
	constructor(private readonly root: string, recognize: WindowRecognizer) {
		this.service=new SpatialTopologyService(join(root,"topology.json"),recognize);
		this.worker=new SpatialTopologyWorker(this.service);
	}
	async load(): Promise<void>{await this.service.load();} // Never starts billing on load.
	execute(input: Record<string,unknown>): Promise<unknown> {
		const task=this.operations.then(()=>this.handle(input));this.operations=task.then(()=>{},()=>{});return task;
	}
	private async handle(input: Record<string,unknown>): Promise<unknown> {
		const action=input.action ?? "status";
		if(action==="status")return this.worker.status();
		if(action==="snapshot")return {status:this.worker.status(),graph:this.service.snapshot()};
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
				return {extension,bytes};
			});
			const state=this.service.snapshot();
			if(state.pending.length>=120)throw new Error("Spatial inbox full; retain source and retry later");
			if(state.observations.some(o=>o.id===input.id))throw new Error("Duplicate observation");
			const atMs=Math.max(Date.now(),(state.observations.at(-1)?.atMs ?? 0)+1);
			const directory=join(this.root,"images",randomUUID());await mkdir(directory,{recursive:true});
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
