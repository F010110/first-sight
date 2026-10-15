import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpatialSqliteStore } from "./spatial-sqlite-store.js";

test("SQLite local revisions rebuild visits/edges and undo across restart",async()=>{
	const dir=await mkdtemp(join(tmpdir(),"sql-revisions-"));
	try{
		const path=join(dir,"graph.sqlite");let db=new SpatialSqliteStore(path);
		for(let i=0;i<3;i++)db.ingest({id:`o${i}`,atMs:i,recordingId:"r",frames:[`${i}.jpg`]});
		db.commit([0,1,2].map(i=>({observationId:`o${i}`,placeId:"p",reason:"layout"})),[{id:"p",summary:"room",representatives:[],lastSeenMs:2}]);
		const original=db.exportSnapshot();
		const split=db.revise("split","p","distinct table side",["o1"],{summary:"table side"});
		assert.equal(db.counts().visits,3);assert.equal(db.counts().transitions,2);
		const child=db.exportSnapshot().nodes.find(n=>n.id!=="p")!.id;
		const merged=db.revise("merge",child,"same region",["o1"],{targetId:"p"});
		assert.equal(db.counts().visits,1);assert.equal(db.counts().transitions,0);
		db.undo(merged,"withdraw merge");assert.equal(db.counts().visits,3);
		db.close();db=new SpatialSqliteStore(path);db.undo(split,"withdraw split");
		assert.deepEqual(db.exportSnapshot().assignments,original.assignments);
		assert.deepEqual(db.exportSnapshot().nodes,original.nodes);
		assert.equal(db.counts().transitions,0);assert.equal(db.counts().visits,1);
		const confirmed=db.revise("confirm","p","checked",["o0"]);
		db.ingest({id:"new",atMs:10,recordingId:"r2",frames:["new.jpg"]});
		db.commit([{observationId:"new",placeId:"p",reason:"revisit"}],[]);
		assert.throws(()=>db.undo(confirmed,"unsafe"),/conflicts/);
		assert.throws(()=>db.revise("split","p","bad",["missing"],{summary:"x"}));
		assert.equal(db.counts().observations,4);db.close();
	}finally{await rm(dir,{recursive:true,force:true});}
});
