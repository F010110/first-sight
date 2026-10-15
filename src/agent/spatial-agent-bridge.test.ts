import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SpatialSqliteStore } from "./spatial-sqlite-store.js";
import { SpatialRetriever } from "./spatial-retrieve.js";
import { compareSpatialHistory } from "./spatial-agent-bridge.js";
import type { SceneChangeAgent,SceneChangeResult } from "./scene-change-agent.js";

test("change bridge restores earlier same-place front evidence and abstains on unknown",async()=>{
	const root=await mkdtemp(join(tmpdir(),"bridge-"));
	try{
		const image=join(root,"old.png");await writeFile(image,"fixture");
		const path=join(root,"memory.sqlite"),db=new SpatialSqliteStore(path);
		for(let i=0;i<4;i++){
			db.ingest({id:`o${i}`,atMs:i,recordingId:"r",frames:[image]});
			db.commit([{observationId:`o${i}`,placeId:i===2?null:i===3?"q":"p",reason:"layout"}],[{id:"p",summary:"p",representatives:[],lastSeenMs:i},{id:"q",summary:"q",representatives:[],lastSeenMs:i}]);
		}
		const retrieve=new SpatialRetriever(path);let calls=0;
		const agent:Pick<SceneChangeAgent,"observe"|"resetBaseline">={resetBaseline:()=>{},observe:async(frames,_motion,place,_label,baseline)=>{
			calls++;assert.equal(place,"p");assert.equal(frames.length,1);assert.equal(frames[0]!.id,"front");assert.equal(baseline,image);return {} as SceneChangeResult;
		}};
		const frames=[{id:"front",path:image,timestampMs:4},{id:"right",path:image,timestampMs:4}];
		assert.equal((await compareSpatialHistory(agent,retrieve.session({asOfMs:4}),frames,null)).status,"unknown");
		const result=await compareSpatialHistory(agent,retrieve.session({asOfMs:4}),frames,"p");assert.deepEqual(result.evidenceIds,["o1"]);assert.equal(calls,1);
		assert.equal(retrieve.session({asOfMs:4,recordingId:"r"}).path("p","q").status,"unknown");
		assert.equal(retrieve.session({asOfMs:4}).path("p","q").status,"unknown");
		retrieve.close();db.close();
	}finally{await rm(root,{recursive:true,force:true});}
});
