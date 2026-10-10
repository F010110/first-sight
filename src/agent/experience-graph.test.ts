import assert from "node:assert/strict";
import { test } from "node:test";
import { ExperienceGraph } from "./experience-graph.js";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const observation = (id: string, atMs: number, objects: string[] = []) => ({ id, atMs, visitId: "visit-1", frames: [`${id}.jpg`], objects, description: "", semanticSource: "test" });
test("pending observations are not forced into a new visual identity", () => {
	const graph = new ExperienceGraph(); graph.addObservation(observation("a",0));
	assert.equal(graph.getState().nodes.length,0);
	assert.throws(() => graph.createNode(["a"],"single image"),/two supported/);
});
test("deferred associations reconstruct directed temporal transitions and gaps", () => {
	const graph = new ExperienceGraph(); for (let i=0;i<5;i++) graph.addObservation(observation(String(i),i*100));
	const a = graph.createNode(["0","1"],"repeat support"), b = graph.createNode(["3","4"],"repeat support");
	let edges=graph.getState().transitions;
	assert.equal(edges.length,1); assert.equal(edges[0]?.from,a);assert.equal(edges[0]?.to,b);
	assert.equal(edges[0]?.evidence[0]?.gap,true);assert.equal(edges[0]?.traversable,false);
	graph.rebind(["2"],a,"later disambiguated");edges=graph.getState().transitions;
	assert.equal(edges[0]?.evidence[0]?.gap,false);assert.equal(edges[0]?.evidence[0]?.fromObservation,"2");
});
test("object search returns dated observations, including pending evidence", () => {
	const graph=new ExperienceGraph();graph.addObservation(observation("a",0,["cup"]));graph.addObservation(observation("b",1,[]));
	const hits=graph.searchObjects("cup");assert.equal(hits.length,1);assert.equal(hits[0]?.nodeId,null);assert.equal(hits[0]?.historicalOnly,true);
});

test("persisted evidence reloads; corrupt stores fail instead of silently resetting", async () => {
	await mkdir(resolve("run"),{recursive:true});
	const directory=await mkdtemp(resolve("run","experience-test-"));
	const path=resolve(directory,"memory.json"), graph=new ExperienceGraph(path);
	graph.addObservation(observation("a",0,["cup"]));graph.addObservation(observation("b",1));graph.createNode(["a","b"],"test correspondence");
	await graph.persist();const loaded=new ExperienceGraph(path);await loaded.load();
	assert.deepEqual(loaded.getState(),graph.getState());assert.equal(loaded.searchObjects("cup").length,1);
	await writeFile(path,"broken JSON");await assert.rejects(new ExperienceGraph(path).load());
});
