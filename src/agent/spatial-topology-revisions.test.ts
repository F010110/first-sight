import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpatialTopologyService } from "./spatial-topology-service.js";

test("candidate split/merge rebuild graph and durable undo preserves originals",async()=>{
	const dir=await mkdtemp(join(tmpdir(),"topology-revise-"));
	try{
		const path=join(dir,"m.json");
		const recognize: ConstructorParameters<typeof SpatialTopologyService>[1]=async batch=>({places:[{id:"new-1",summary:"open room"}],assignments:batch.map(o=>({observationId:o.id,placeId:"new-1",reason:"layout"}))});
		const service=new SpatialTopologyService(path,recognize);
		for(let i=0;i<3;i++)await service.ingest({id:String(i),atMs:i*3000,frames:[`${i}.jpg`]});
		await service.tick(10000);const initial=service.snapshot(),id=initial.nodes[0]!.id;
		assert.equal(initial.nodes[0]!.status,"candidate");
		const split=await service.revise("split",id,"reviewed distinct side",["1"],{summary:"table side"});
		assert.equal(service.snapshot().edges.length,2);assert.equal(service.snapshot().assignments[1]!.originalPlaceId,id);
		const restored=new SpatialTopologyService(path,recognize);await restored.load();await restored.undo(split,"withdraw split");
		assert.deepEqual(restored.snapshot().assignments,initial.assignments);assert.equal(restored.snapshot().edges.length,0);
		await restored.revise("split",id,"reviewed side",["1"],{summary:"table side"});
		const second=restored.snapshot().nodes[1]!.id;
		const merged=await restored.revise("merge",second,"same region",["1"],{targetId:id});
		assert.equal(restored.snapshot().nodes[1]!.status,"retired");assert.equal(restored.snapshot().edges.length,0);
		await restored.undo(merged,"restore distinction");assert.equal(restored.snapshot().edges.length,2);
		await restored.revise("confirm",id,"human checked",["0"]);
		await assert.rejects(restored.undo(merged,"unsafe"),/conflicts/);
		assert.deepEqual(restored.snapshot().observations,initial.observations);
	}finally{await rm(dir,{recursive:true,force:true});}
});
