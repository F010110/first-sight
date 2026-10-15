import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpatialEventStore } from "./spatial-event-store.js";

test("comparison audit survives restart, is idempotent and respects historical/recording scope",async()=>{
	const root=await mkdtemp(join(tmpdir(),"spatial-events-"));
	try{
		const path=join(root,"changes.sqlite");let events=new SpatialEventStore(path);
		const value={observationId:"current",baselineId:"before",placeId:"p",recordingId:"r",atMs:10,changed:true,what:"chair moved",result:{confidence:0.8}};
		events.record(value);events.record(value);events.close();events=new SpatialEventStore(path);
		assert.equal(events.search({asOfMs:9},{}).length,0);
		assert.equal(events.search({asOfMs:11,recordingId:"other"},{}).length,0);
		assert.equal(events.search({asOfMs:11},{query:"chair",placeId:"p"}).length,1);
		assert.equal(events.search({asOfMs:11},{query:"door"}).length,0);
		events.close();
	}finally{await rm(root,{recursive:true,force:true});}
});
