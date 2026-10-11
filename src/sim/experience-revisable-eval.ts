/** Recompute real directional evidence. Coordinates are used only for final diagnostics. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { matchImages } from "../agent/image-match.js";
import { ExperienceGraph } from "../agent/experience-graph.js";
import { ExperienceAssociation, type CorrespondenceEvidence } from "../agent/experience-association.js";
const dir=resolve(process.argv[2] ?? "run/sim/multiview-val5-clean-20261007");
const limitArg=process.argv.find(arg=>arg.startsWith("--limit="))?.slice(8);
const limit=limitArg === "all" ? Infinity : Number(limitArg ?? 40);
if (!(limit > 0) || (limit !== Infinity && !Number.isInteger(limit))) throw new Error("--limit must be a positive integer or all");
const rows=(await readFile(resolve(dir,"windows.jsonl"),"utf8")).trim().split(/\r?\n/).slice(0,limit).map(line=>JSON.parse(line));
const cache=resolve(dir,"experience-directional-evidence.json");
const views=(index:number)=>["frames","left","right"].map(direction=>({direction,frame:resolve(dir,direction,`${String(rows[index].endTick).padStart(4,"0")}.jpg`)}));
let pairs:CorrespondenceEvidence[];
if(process.argv.includes("--reuse")) pairs=JSON.parse(await readFile(cache,"utf8"));
else {
	const directional=new Map<string,number[]>();
	for(let i=0;i<rows.length;i++) {
		const query=views(i);const candidates=rows.flatMap((_,j)=>i===j?[]:views(j).map(view=>({id:`observation-${j+1}`,path:view.frame})));
		const result=await matchImages(query.map(view=>view.frame),candidates,{minInliers:15,maxDim:640,timeoutMs:120000});
		if(!result.ok) throw new Error(`Matcher failed at ${i+1}: ${result.error}`);
		for(let j=0;j<rows.length;j++) if(j!==i) {
			const scores=[0,0,0];for(const entry of result.results.filter(entry=>entry.id===`observation-${j+1}`)) {
				const index=query.findIndex(view=>view.frame===entry.queryPath);if(index>=0)scores[index]=Math.max(scores[index]!,Math.min(entry.inliers/60,1));
			}directional.set(`${i}:${j}`,scores);
		}console.log(`directional matching ${i+1}/${rows.length}`);
	}
	pairs=[];for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)pairs.push({a:`observation-${i+1}`,b:`observation-${j+1}`,bearings:directional.get(`${i}:${j}`)!,backwardBearings:directional.get(`${j}:${i}`)!,views:[...views(i),...views(j)],source:"SIFT inliers/60 capped at 1; three same-optical-center yaw views; bidirectional"});
	await writeFile(cache,JSON.stringify(pairs,null,2));
}
const sequence=process.argv.includes("--sequence");
const fault=process.argv.find(arg=>arg.startsWith("--fault="))?.slice(8);
if(fault && !["wrong-loop","dropout","weak"].includes(fault))throw new Error("Unknown fault mode");
if(fault==="wrong-loop")pairs=pairs.map(pair=>pair.a==="observation-6"&&pair.b==="observation-19"?{...pair,bearings:[1,1,1],backwardBearings:[1,1,1],source:"injected false loop"}:pair);
if(fault==="dropout")pairs=pairs.filter(pair=>!["observation-28","observation-38"].includes(pair.a)&&!["observation-28","observation-38"].includes(pair.b));
if(fault==="weak")pairs=pairs.map(pair=>({...pair,bearings:pair.bearings.map(score=>score*0.2),...(pair.backwardBearings?{backwardBearings:pair.backwardBearings.map(score=>score*0.2)}:{})}));
const suffix=(sequence ? "sequence" : "revisable")+(fault?`-${fault}`:"");
const graph=new ExperienceGraph();const controller=new ExperienceAssociation(graph,sequence);const log:unknown[]=[];
for(let i=0;i<rows.length;i++) {
	const id=`observation-${i+1}`;graph.addObservation({id,atMs:rows[i].endTick*1000,visitId:"episode-1",frames:views(i).map(view=>view.frame),objects:[],description:"",semanticSource:null});
	const known=new Set(graph.getState().observations.map(row=>row.id));
	for(const pair of pairs.filter(pair=>(pair.a===id||pair.b===id)&&known.has(pair.a)&&known.has(pair.b)))controller.addEvidence(pair);
	controller.reconsider();log.push({window:i+1,pending:graph.getState().observations.filter(row=>row.nodeId===null).length,nodes:graph.getState().nodes.length});
}
const bundle=resolve(dir,`experience-${suffix}-bundle.json`);await controller.persist(bundle);
const restored=new ExperienceAssociation(new ExperienceGraph());await restored.load(bundle);
if(JSON.stringify(restored.graph.getState())!==JSON.stringify(graph.getState()))throw new Error("Reload mismatch");
const state=graph.getState();let exactPairs=0,reused=0;const missed:unknown[]=[];
for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)if(Math.hypot(rows[i].endPose.x-rows[j].endPose.x,rows[i].endPose.z-rows[j].endPose.z)<=0.05){exactPairs++;const a=state.observations[i]!.nodeId,b=state.observations[j]!.nodeId;if(a&&a===b)reused++;else missed.push([i+1,j+1,a,b]);}
let crossRoomPairs=0,differentEndpointPairs=0;
for(const node of state.nodes)for(let i=0;i<node.observationIds.length;i++)for(let j=i+1;j<node.observationIds.length;j++){
	const a=rows[Number(node.observationIds[i]!.split("-").at(-1))-1],b=rows[Number(node.observationIds[j]!.split("-").at(-1))-1];
	if(a.room!==b.room)crossRoomPairs++;
	if(Math.hypot(a.endPose.x-b.endPose.x,a.endPose.z-b.endPose.z)>0.05)differentEndpointPairs++;
}
const summary={observations:state.observations.length,nodes:state.nodes.length,pending:state.observations.filter(row=>row.nodeId===null).length,exactPairs,reused,missed,crossRoomPairs,differentEndpointPairs,transitions:state.transitions.length,reloadVerified:true};
await writeFile(resolve(dir,`experience-${suffix}-eval.json`),JSON.stringify({note:"Causal replay; no coordinates, semantics or motion in recognition; retrospective pending backfill permitted. Heuristic short-sequence verification when --sequence is set; otherwise conservative representative verification. No production changes. Empty object semantics intentionally excluded from retrieval evaluation.",sequence,summary,log,nodes:state.nodes,hypotheses:controller.hypotheses,pendingDiagnostics:controller.diagnosePending()},null,2));console.log(JSON.stringify(summary));
