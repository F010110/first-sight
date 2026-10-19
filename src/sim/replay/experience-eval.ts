/** Causal Experience Graph experiment on cached image-only pair evidence. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ExperienceGraph } from "../../agent/experience-graph.js";
import type { PairAffinity } from "../../agent/topological-grouping.js";
const dir=resolve(process.argv[2] ?? "run/sim/multiview-val5-clean-20261007");
const evidence=JSON.parse(await readFile(resolve(dir,"grouping-experiment.json"),"utf8")) as {pairs:PairAffinity[]};
const rows=(await readFile(resolve(dir,"windows.jsonl"),"utf8")).trim().split(/\r?\n/).slice(0,40).map(line=>JSON.parse(line));
const semanticReport=JSON.parse(await readFile(resolve(dir,"eval-plus-independent-perception-perfect.json"),"utf8"));
const semantics=(await readFile(resolve(semanticReport.layered.runDir,"decisions.jsonl"),"utf8")).trim().split(/\r?\n/).map(line=>JSON.parse(line).result.currentPerception as {objects:string[];summary:string});
const graph=new ExperienceGraph(resolve(dir,"experience-graph-experiment.json"));
const log:unknown[]=[];
for(let i=0;i<rows.length;i++) {
	const id=`observation-${i+1}`, row=rows[i]!;
	graph.addObservation({id,atMs:row.endTick*1000,visitId:"episode-1",frames:[resolve(dir,"triple",`${String(row.endTick).padStart(4,"0")}.jpg`)],objects:semantics[i]?.objects??[],description:semantics[i]?.summary??"",semanticSource:"cached current-only VLM perception; not used for identity"});
	// Only earlier observations may be candidates; no future evidence affects this decision.
	const previous=graph.getState().observations.slice(0,-1);
	const scores=previous.map(observation=>{const pair=evidence.pairs.find(pair=>(pair.a===id&&pair.b===observation.id)||(pair.b===id&&pair.a===observation.id));return {observation,score:pair&&pair.directions>=2?pair.score:0};}).sort((a,b)=>b.score-a.score);
	const best=scores[0];
	// Compare distinct identities, not duplicate views of the same candidate.
	const alternative=scores.find(candidate=>best?.observation.nodeId ? candidate.observation.nodeId!==best.observation.nodeId : candidate.observation.id!==best?.observation.id);
	let action="pending";
	if(best && best.score>=0.4 && best.score-(alternative?.score??0)>=0.1) {
		if(best.observation.nodeId) {graph.rebind([id],best.observation.nodeId,`image-only correspondence ${best.score.toFixed(3)}`);action="associated";}
		else {graph.createNode([best.observation.id,id],`deferred image-only correspondence ${best.score.toFixed(3)}`);action="promoted-pair";}
	}
	await graph.persist();log.push({window:i+1,action,score:best?.score??0,nodeId:graph.getState().observations.at(-1)?.nodeId});
}
const state=graph.getState();
const objectSearch={toilet:graph.searchObjects("toilet"),bed:graph.searchObjects("bed")};
const summary={observations:state.observations.length,nodes:state.nodes.length,pending:state.observations.filter(row=>row.status==="pending").length,directedTemporalEdges:state.transitions.length,gappedEdges:state.transitions.filter(edge=>edge.evidence.some(row=>row.gap)).length,regions:0};
await writeFile(resolve(dir,"experience-eval.json"),JSON.stringify({note:"No Place/Space grouping. Causal recognition over cached all-pair multiview SIFT scores, heuristic thresholds, no coordinates/motion/semantics in identity. Cached independent VLM object descriptions attach only to individual observations; search is substring matching, not validated object detection or tracking. Nodes are visual correspondences, not physical regions. Deferred promotions use two strongly matching observations, not multi-frame sequence verification. Edges are directed temporal experiences and NOT authorized navigation links. No production memory changed.",summary,log,objectSearch},null,2));
console.log(JSON.stringify(summary));console.log(`historical searches: toilet=${objectSearch.toilet.length}, bed=${objectSearch.bed.length}`);
