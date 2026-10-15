import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpatialSqliteService } from "./spatial-sqlite-service.js";
import type { WindowRecognizer } from "./spatial-topology-service.js";

test("SQLite worker uses bounded context, survives restart and supports local edits",async()=>{
	const dir=await mkdtemp(join(tmpdir(),"sql-service-"));
	try{
		const recognize:WindowRecognizer=async(batch,history)=>{
			assert.equal(history.observations.length,0);assert.ok(history.nodes.length<=6);
			const id=history.nodes[0]?.id ?? "new-1";
			return {places:[{id,summary:"room"}],assignments:batch.map(o=>({observationId:o.id,placeId:id,reason:"same layout"}))};
		};
		const path=join(dir,"m.sqlite");let service=new SpatialSqliteService(path,recognize);await service.load();
		for(let i=0;i<8;i++)await service.ingest({id:`o${i}`,atMs:i*3000,frames:["a.jpg"],recordingId:"r"});
		await service.tick(30000);assert.equal(service.summary().pending,4);service.close();
		service=new SpatialSqliteService(path,recognize);await service.load();await service.tick(40000);
		assert.equal(service.summary().pending,0);assert.equal(service.snapshot().nodes.length,1);
		const id=service.context().nodes[0]!.id;
		const revision=await service.revise("split",id,"reviewed side",["o1"],{summary:"side"});
		assert.equal(service.snapshot().nodes.length,2);await service.undo(revision,"withdraw");assert.equal(service.snapshot().nodes.length,1);
		const first=service.page(3),second=service.page(3,first.nextCursor);assert.equal(first.observations.length,3);assert.notEqual(first.observations[0]!.id,second.observations[0]!.id);
		service.close();
		// Old JSON migration is explicit one-time import; original file remains readable.
		const old=join(dir,"old.json");await writeFile(old,JSON.stringify({version:1,observations:[],pending:[],nodes:[],edges:[],assignments:[],currentPlaceId:null}));
		const migrated=new SpatialSqliteService(join(dir,"import.sqlite"),recognize,old);await migrated.load();assert.equal(migrated.summary().pending,0);migrated.close();
	}finally{await rm(dir,{recursive:true,force:true});}
});
