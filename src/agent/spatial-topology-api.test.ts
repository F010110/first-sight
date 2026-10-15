import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpatialTopologyApi } from "./spatial-topology-api.js";

test("upload persists without billing until explicit start; duplicate and unsafe fields rejected",async()=>{
	const dir=await mkdtemp(join(tmpdir(),"spatial-api-"));
	try{
		let calls=0;
		const recognize: ConstructorParameters<typeof SpatialTopologyApi>[1]=async batch=>{calls++;return {places:[{id:"new-1",summary:"room"}],assignments:batch.map(o=>({observationId:o.id,placeId:"new-1",reason:"layout"}))};};
		const api=new SpatialTopologyApi(dir,recognize);await api.load();
		const input={action:"observe",id:"r:1",recordingId:"r",sourceAtMs:3,frames:[{mimeType:"image/png",dataBase64:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII="}]};
		await api.execute(input);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
		assert.equal(api.service.snapshot().pending.length,1);
		await assert.rejects(api.execute(input),/Duplicate/);
		await assert.rejects(api.execute({...input,id:"../escape"}),/Invalid/);
		await assert.rejects(api.execute({...input,id:"bad-image",frames:[{mimeType:"image/png",dataBase64:Buffer.from("not an image").toString("base64")}]}),/header/);
		api.service.close();
		const restored=new SpatialTopologyApi(dir,recognize);await restored.load();assert.equal(restored.service.snapshot().pending.length,1);assert.equal(calls,0);
		await restored.execute({action:"start"});
		await assert.rejects(restored.execute({action:"revise",kind:"confirm",sourceId:"x",reason:"check",evidenceIds:["r:1"]}),/Stop/);
		await restored.execute({action:"stop"});assert.equal(restored.worker.status().running,false);
		restored.service.close();
	}finally{await rm(dir,{recursive:true,force:true});}
});
