import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpatialSqliteStore } from "./spatial-sqlite-store.js";
import { SpatialRetriever } from "./spatial-retrieve.js";

test("scoped retrieval recovers old nonrepresentatives without future/recording leaks",async()=>{
	const dir=await mkdtemp(join(tmpdir(),"retrieve-"));
	try{
		const path=join(dir,"memory.sqlite"),image=join(dir,"frame.png");await writeFile(image,"fixture");
		const db=new SpatialSqliteStore(path);
		for(let i=0;i<12;i++){
			db.ingest({id:`o${i}`,atMs:i,recordingId:i<10?"r1":"r2",frames:[image]});
			db.commit([{observationId:`o${i}`,placeId:"p",reason:i===1?"red sofa 红色沙发":"table"}],[{id:"p",summary:"future summary",representatives:[],lastSeenMs:i}]);
		}
		const retrieve=new SpatialRetriever(path),session=retrieve.session({asOfMs:8,recordingId:"r1"},1);
		assert.deepEqual(session.search({query:"red sofa"}).hits.map(h=>h.id),["o1"]);
		assert.equal(session.search({query:"future"}).status,"unknown");
		assert.equal(session.search({query:"不存在"}).hits.length,0);
		assert.equal(session.search({query:"红色"}).hits[0]!.id,"o1");
		assert.equal(session.baseline("p",5)!.observation.id,"o4");
		const first=session.search({limit:2});assert.equal(first.nextCursor,2);
		assert.equal(session.search({limit:2,cursor:first.nextCursor!}).hits[0]!.id,"o2");
		await assert.rejects(session.inspect(["o11"]),/retrieved/);
		assert.throws(()=>session.validateCitations(["o1"]),/inspected/);
		await session.inspect(["o1"]);session.validateCitations(["o1"]);
		await assert.rejects(session.inspect(["o1"]),/budget/);
		assert.equal(retrieve.session({asOfMs:100,recordingId:"r2"}).search().hits.length,2);
		const summarySession=retrieve.session({asOfMs:8,recordingId:'r1',judgmentUnavailableIds:['o1']});const summary=summarySession.memorySummary();
		assert.ok(!JSON.stringify(summary).includes('red sofa'));assert.ok(!JSON.stringify(summary).includes('future summary'));
		assert.ok(summary.entries.every(e=>e.atMs<8&&e.sourceIds!.every(id=>Number(id.slice(1))<8)));
		assert.equal(summarySession.inspected.size,0);await assert.rejects(summarySession.inspect(['o2']),/retrieved/);
		retrieve.close();db.close();
	}finally{await rm(dir,{recursive:true,force:true});}
});
