import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpatialTopologyService } from "./spatial-topology-service.js";

test("busy coalescing preserves inbox and failed recognition survives restart", async () => {
	const directory=await mkdtemp(join(tmpdir(),"topology-"));
	try {
		let fail!:()=>void;
		const path=join(directory,"graph.json");
		const service=new SpatialTopologyService(path,async()=>new Promise((_,reject)=>{fail=()=>reject(new Error("timeout"));}));
		await service.ingest({id:"a",atMs:0,frames:["a.jpg"],recordingId:"one"});
		const running=service.tick(10000);
		await new Promise(resolve=>setImmediate(resolve));
		await service.ingest({id:"b",atMs:11000,frames:["b.jpg"],recordingId:"one"});
		assert.equal(service.tick(12000),running);
		assert.equal(service.snapshot().pending.length,2);
		fail(); await assert.rejects(running,/timeout/);
		const restored=new SpatialTopologyService(path,async batch=>({places:[{id:"new-1",summary:"room"}],assignments:batch.map(o=>({observationId:o.id,placeId:"new-1",reason:"layout"}))}));
		await restored.load(); await restored.tick(20000,true);
		const id=restored.snapshot().nodes[0]!.id;
		const revisit=new SpatialTopologyService(path,async batch=>({places:[],assignments:batch.map(o=>({observationId:o.id,placeId:id,reason:"same instance"}))}));
		await revisit.load();await revisit.ingest({id:"c",atMs:21000,frames:["c.jpg"],recordingId:"two"});await revisit.tick(32000);
		assert.equal(revisit.snapshot().nodes.length,1);
		assert.equal(revisit.snapshot().edges.length,0);
	} finally { await rm(directory,{recursive:true,force:true}); }
});

test("durable inbox, restart, stable revisit and evidence edges", async () => {
	const directory = await mkdtemp(join(tmpdir(),"topology-"));
	try {
		const path = join(directory,"graph.json");
		const recognize: ConstructorParameters<typeof SpatialTopologyService>[1] = async (batch,history) => {
			const id = history.nodes[0]?.id ?? "new-1";
			return {places:[{id,summary:"kitchen"},{id:"new-2",summary:"bedroom"}],assignments:batch.map((o,i) => ({observationId:o.id,placeId:i===1?"new-2":id,reason:"visible layout"}))};
		};
		const first = new SpatialTopologyService(path,recognize);
		for (let i=0;i<3;i++) await first.ingest({id:String(i),atMs:i*3000,frames:[`${i}.jpg`]});
		const restored = new SpatialTopologyService(path,recognize); await restored.load();
		assert.equal(restored.snapshot().pending.length,3);
		await restored.tick(10000);
		const s=restored.snapshot(); assert.equal(s.nodes.length,2); assert.equal(s.edges.length,2);
		assert.equal(s.assignments[0]!.placeId,s.assignments[2]!.placeId);
		assert.equal(s.pending.length,0);
		const again = new SpatialTopologyService(path,recognize); await again.load(); assert.deepEqual(again.snapshot(),s);
	} finally { await rm(directory,{recursive:true,force:true}); }
});
