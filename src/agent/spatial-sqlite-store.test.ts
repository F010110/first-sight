import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpatialSqliteStore } from "./spatial-sqlite-store.js";

test("indexed durable history, bounded retrieval, atomic failure, visits and restart",async()=>{
	const dir=await mkdtemp(join(tmpdir(),"spatial-sql-"));
	try {
		const path=join(dir,"memory.sqlite");let store=new SpatialSqliteStore(path);
		const total=Number(process.env.SPATIAL_STRESS_RECORDS ?? 1000);assert.ok(Number.isSafeInteger(total) && total>=1000 && total<=100000);
		for(let i=0;i<total;i++){
			const id=`o${i}`,place=`p${i%10}`,recordingId=`r${Math.floor(i/100)}`;
			store.ingest({id,atMs:i,recordingId,frames:[`${id}.jpg`]});
			store.commit([{observationId:id,placeId:place,reason:"test layout"}],[{id:place,summary:`厨房区域 kitchen ${i%10}`,status:"candidate",representatives:[],lastSeenMs:i}]);
		}
		assert.equal(store.counts().observations,total);assert.equal(store.counts().pending,0);
		assert.ok(store.context().nodes.length<=6);assert.equal(store.context().observations.length,0);
		assert.equal(store.candidates("kitchen",3).length,3);assert.equal(store.candidates("厨房区域",2).length,2);
		assert.equal(store.candidates("",4).length,4);assert.equal(store.visits("p1",2).length,2);
		store.ingest({id:"pending",atMs:total+1,frames:["pending.jpg"]});
		assert.throws(()=>store.commit([{observationId:"pending",placeId:"invented",reason:"bad"}],[]));
		assert.equal(store.pending().length,1);store.close();store=new SpatialSqliteStore(path);
		assert.equal(store.pending()[0]!.id,"pending");
		const exported=store.exportSnapshot();store.close();
		const copy=new SpatialSqliteStore(join(dir,"copy.sqlite"));copy.importSnapshot(exported);
		assert.deepEqual(copy.exportSnapshot(),exported);assert.throws(()=>copy.importSnapshot(exported),/empty/);copy.close();
	}finally{await rm(dir,{recursive:true,force:true});}
});
