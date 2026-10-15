import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm,readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpatialLibraryStore } from "./spatial-library.js";

test("durable library recovery requires secret, not just ID",async()=>{
	const directory=await mkdtemp(join(tmpdir(),"library-"));
	try{
		const original=new SpatialLibraryStore(directory),credentials=await original.create();
		const restored=new SpatialLibraryStore(directory);
		assert.equal(await restored.open(credentials.libraryId,credentials.recoveryKey),join(directory,credentials.libraryId));
		const raw=await readFile(join(directory,credentials.libraryId,"access.json"),"utf8");assert.equal(raw.includes(credentials.recoveryKey),false);
		await assert.rejects(restored.open(credentials.libraryId,"x".repeat(43)),/Invalid/);
		await assert.rejects(restored.open("../escape",credentials.recoveryKey),/Invalid/);
	}finally{await rm(directory,{recursive:true,force:true});}
});
