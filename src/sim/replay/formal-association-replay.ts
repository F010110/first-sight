/** Controlled algorithm correction replay. No labels/poses/actions loaded. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ExperienceGraph } from "../../agent/experience-graph.js";
import { ExperienceAssociation, type CorrespondenceEvidence } from "../../agent/experience-association.js";
const [directory, output, policy = "multi-bearing"] = process.argv.slice(2);
if (!directory || !output || !["legacy", "multi-bearing"].includes(policy)) throw new Error("Usage: formal-association-replay dataset NEW-output [legacy|multi-bearing]");
const rows=(await readFile(resolve(directory,"windows.jsonl"),"utf8")).trim().split(/\r?\n/).map(line=>JSON.parse(line));
const pairs: CorrespondenceEvidence[]=JSON.parse(await readFile(resolve(directory,"experience-directional-evidence.json"),"utf8"));
const graph=new ExperienceGraph(),association=new ExperienceAssociation(graph,true,policy as "legacy"|"multi-bearing");
const snapshots=[];
for (let i=0;i<rows.length;i++) {
	const id=`observation-${i+1}`,atMs=rows[i].endTick*1000;
	graph.addObservation({ id, atMs, visitId:"episode-1", frames:["frames","left","right"].map(view=>resolve(directory,view,`${String(rows[i].endTick).padStart(4,"0")}.jpg`)),objects:[],description:"",semanticSource:null });
	const seen=new Set(graph.getState().observations.map(row=>row.id));
	for(const pair of pairs) if((pair.a===id||pair.b===id)&&seen.has(pair.a)&&seen.has(pair.b)) association.addEvidence(pair);
	association.reconsider();snapshots.push({ atMs,assignments:Object.fromEntries(graph.getState().observations.map(row=>[row.id,row.nodeId])) });
}
await writeFile(output,JSON.stringify({protocol:"formal-association-prefix-replay-v1",algorithmPolicy:policy,evidenceBudget:"same-cached-directional-correspondences-arrived-endpoints-only",online:{snapshots},bundle:association.getBundle()},null,2),{flag:"wx"});
