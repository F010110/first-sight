import assert from "node:assert/strict";
import { test } from "node:test";
import { ExperienceGraph } from "./experience-graph.js";
import { ExperienceAssociation } from "./experience-association.js";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
function setup() {
	const graph = new ExperienceGraph();
	for (const [i,id] of ["a","b","c","d"].entries()) graph.addObservation({id,atMs:i,visitId:"v",frames:[id],objects:["cup"],description:"",semanticSource:"test"});
	return {graph, controller:new ExperienceAssociation(graph)};
}
test("historical pending backfill requires all representatives, not a similarity chain", () => {
	const {graph,controller} = setup(); graph.createNode(["b","c"],"seed");
	controller.addEvidence({a:"a",b:"b",bearings:[1,1],source:"test"});controller.reconsider();
	assert.equal(graph.getState().observations[0]!.nodeId,null);
	controller.addEvidence({a:"a",b:"c",bearings:[1,1],source:"test"});controller.reconsider();
	assert.equal(graph.getState().observations[0]!.nodeId,"visual-1");
	assert.equal(controller.hypotheses[0]!.status,"supported");
});
test("revocation preserves raw history and cannot be silently reaccepted", () => {
	const {graph,controller} = setup(); const node=graph.createNode(["a","b"],"seed");
	const before=graph.getState().observations.map(({nodeId,status,...raw}) => raw);
	controller.reject("a",node,{source:"manual independent review",reason:"distinct observed instance"});
	controller.addEvidence({a:"a",b:"b",bearings:[1,1],source:"test"});controller.reconsider();
	assert.equal(graph.getState().observations[0]!.nodeId,null);
	assert.deepEqual(graph.getState().observations.map(({nodeId,status,...raw}) => raw),before);
	assert.equal(graph.searchObjects("cup").length,4);
	assert.ok(controller.getPendingTrajectories()[0]!.observationIds.includes("a"));
});
test("atomic bundle restores evidence and rejection history; invalid load leaves memory unchanged", async () => {
	const {graph,controller}=setup(); const node=graph.createNode(["b","c"],"seed");
	for (const b of ["b","c"]) controller.addEvidence({a:"a",b,bearings:[1,1],backwardBearings:[1,1],source:"test"});
	controller.reconsider(); controller.reject("a",node,{source:"review",reason:"distinct instance"});
	await mkdir(resolve("run"),{recursive:true});const directory=await mkdtemp(resolve("run","association-test-"));const path=resolve(directory,"bundle.json");
	await controller.persist(path);
	const loaded=new ExperienceAssociation(new ExperienceGraph());await loaded.load(path);
	assert.deepEqual(loaded.graph.getState(),graph.getState());assert.deepEqual(loaded.history,controller.history);
	loaded.reconsider();assert.equal(loaded.graph.getState().observations[0]!.nodeId,null);
	const before=loaded.graph.getState();const bundle=JSON.parse(await readFile(path,"utf8"));bundle.evidence[0].a="missing";await writeFile(path,JSON.stringify(bundle));
	await assert.rejects(loaded.load(path));assert.deepEqual(loaded.graph.getState(),before);
});
test("seed promotions record provenance and repeated reconsideration is idempotent", () => {
	const {controller}=setup();controller.addEvidence({a:"a",b:"b",bearings:[1,1],source:"test"});controller.reconsider();
	assert.equal(controller.hypotheses.length,2);const history=structuredClone(controller.history);controller.reconsider();assert.deepEqual(controller.history,history);
});
function sequenceSetup(gap=false) {
	const graph=new ExperienceGraph();
	for(let i=1;i<=10;i++)graph.addObservation({id:`o${i}`,atMs:i*1000+(gap&&i>=8?20000:0),visitId:"v",frames:[`${i}.jpg`],objects:[],description:"",semanticSource:null});
	const controller=new ExperienceAssociation(graph,true);
	for(const [a,b] of [[1,9],[3,7]])controller.addEvidence({a:`o${a}`,b:`o${b}`,bearings:[1,1],backwardBearings:[1,1],source:"independent neighbor match"});
	return {graph,controller};
}
test("one-bearing return needs two independent sequence matches; wrong isolated loop is rejected", () => {
	const {graph,controller}=sequenceSetup();
	controller.addEvidence({a:"o2",b:"o8",bearings:[1,0,0],backwardBearings:[0,1,0],source:"anchor"});
	controller.addEvidence({a:"o2",b:"o10",bearings:[1,1,1],backwardBearings:[1,1,1],source:"injected incorrect loop"});
	controller.reconsider();
	assert.equal(graph.getState().observations[1]!.nodeId,graph.getState().observations[7]!.nodeId);
	assert.ok(graph.getState().observations[1]!.nodeId);
	assert.equal(graph.getState().observations[9]!.nodeId,null);
	assert.equal(controller.hypotheses[0]!.evidence.length,3);
});
test("formal multi-bearing anchor policy refuses shared-surface sequence promotion", () => {
	const { graph, controller: legacy } = sequenceSetup();
	const controller = new ExperienceAssociation(graph, true, "multi-bearing");
	for (const pair of legacy.getBundle().evidence) controller.addEvidence(pair);
	controller.addEvidence({ a: "o2", b: "o8", bearings: [1,0,0], backwardBearings: [0,1,0], source: "single shared surface" });
	controller.reconsider();
	assert.equal(graph.getState().observations.find(row => row.id === "o2")!.nodeId, null);
	controller.addEvidence({ a: "o2", b: "o8", bearings: [1,1,0], backwardBearings: [1,1,0], source: "reciprocal multi-bearing anchor" });
	controller.reconsider();
	assert.ok(graph.getState().observations.find(row => row.id === "o2")!.nodeId);
});
test("formal anchor policy round-trips and invalid policy restore is atomic", () => {
	const controller = new ExperienceAssociation(new ExperienceGraph(), true, "multi-bearing");
	const bundle = controller.getBundle(), loaded = new ExperienceAssociation(new ExperienceGraph());
	loaded.restoreBundle(bundle); assert.deepEqual(loaded.getBundle(), bundle);
	const invalid = structuredClone(bundle) as any; invalid.sequenceAnchorPolicy = "unknown";
	assert.throws(() => loaded.restoreBundle(invalid)); assert.deepEqual(loaded.getBundle(), bundle);
});
test("sequence verification cannot confirm an anchor without direct visual support or across a gap", () => {
	for(const gap of [false,true]) {
		const {graph,controller}=sequenceSetup(gap);
		controller.addEvidence({a:"o2",b:"o8",bearings:gap?[1,0,0]:[0,0,0],source:"anchor"});controller.reconsider();
		assert.equal(graph.getState().observations[1]!.nodeId,null);
	}
});
test("sequence rejection survives bundle reload and cannot be reaccepted", async () => {
	const {graph,controller}=sequenceSetup();controller.addEvidence({a:"o2",b:"o8",bearings:[1,0,0],source:"anchor"});controller.reconsider();
	const node=graph.getState().observations[1]!.nodeId!;assert.ok(node);
	controller.reject("o2",node,{source:"review",reason:"positive contradictory evidence"});
	await mkdir(resolve("run"),{recursive:true});const path=resolve(await mkdtemp(resolve("run","sequence-test-")),"bundle.json");await controller.persist(path);
	const loaded=new ExperienceAssociation(new ExperienceGraph());await loaded.load(path);loaded.reconsider();
	assert.equal(loaded.graph.getState().observations[1]!.nodeId,null);
	assert.ok(loaded.hypotheses.some(h=>h.observationId==="o2"&&h.status==="rejected"));
});
