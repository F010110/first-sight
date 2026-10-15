import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpatialTopologyService } from "./spatial-topology-service.js";
import { SpatialTopologyWorker } from "./spatial-topology-worker.js";

test("capacity rejects explicitly, timer failure pauses, pending retained",async()=>{
	const dir=await mkdtemp(join(tmpdir(),"spatial-worker-"));
	try {
		let now=0,calls=0,fail=true;
		const service=new SpatialTopologyService(join(dir,"m.json"),async batch=>{
			calls++;if(fail)throw new Error("timeout");
			return {places:[{id:"new-1",summary:"room"}],assignments:batch.map(o=>({observationId:o.id,placeId:"new-1",reason:"layout"}))};
		},1,1);
		const worker=new SpatialTopologyWorker(service,()=>now);
		await worker.accept({id:"a",atMs:0,frames:["a.jpg"]});await worker.pump();
		assert.equal(calls,0);
		await assert.rejects(worker.accept({id:"b",atMs:1,frames:["b.jpg"]}),/inbox full/);
		now=10000;await worker.pump();assert.equal(worker.status().paused,true);
		await worker.pump();assert.equal(calls,1);assert.equal(worker.status().pending,1);
		fail=false;worker.resume();now=20000;await worker.pump();
		assert.equal(worker.status().pending,0);assert.equal(calls,2);
		worker.start();assert.equal(worker.status().running,true);await worker.stop();assert.equal(worker.status().running,false);
	}finally{await rm(dir,{recursive:true,force:true});}
});
