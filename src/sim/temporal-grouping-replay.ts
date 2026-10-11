/** Actual current membership prefix adapter, no labels/poses/actions read. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { VisualExperienceMemory } from "../agent/visual-experience-memory.js";
import type { CorrespondenceEvidence } from "../agent/experience-association.js";
import type { SegmentLink } from "../agent/segment-association.js";
const [directory, output] = process.argv.slice(2);
if (!directory || !output) throw new Error("Usage: temporal-grouping-replay dataset NEW-output");
const rows = (await readFile(resolve(directory,"windows.jsonl"),"utf8")).trim().split(/\r?\n/).map(line=>JSON.parse(line));
const pairs: CorrespondenceEvidence[] = JSON.parse(await readFile(resolve(directory,"experience-directional-evidence.json"),"utf8"));
let geometry: { pairs: { a:string; b:string; source:string; matches:{frames:string[]}[] }[] }={pairs:[]};
try { geometry=JSON.parse(await readFile(resolve(directory,"local-rotation-evidence.json"),"utf8")); }
catch(error) { if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error; }
const memory = new VisualExperienceMemory(), seen = new Set<string>(), snapshots = [], legacySnapshots = [], history = [];
const second = (values: number[]) => [...values].sort((a,b)=>b-a)[1] ?? 0;
for (let i=0; i<rows.length; i++) {
	const id=`observation-${i+1}`,atMs=rows[i].endTick*1000;seen.add(id);
	const arrived=pairs.filter(pair=>(pair.a===id||pair.b===id)&&seen.has(pair.a)&&seen.has(pair.b));
	const links: SegmentLink[]=arrived.map((pair,j)=>({id:`link-${i}-${j}`,a:pair.a,b:pair.b,kind:"visual",confidence:Math.min(second(pair.bearings),second(pair.backwardBearings??[])),source:pair.source,frames:(pair.views??[]).map(view=>view.frame)}));
	for(const [j,pair] of geometry.pairs.entries()) if((pair.a===id||pair.b===id)&&seen.has(pair.a)&&seen.has(pair.b)) links.push({id:`geometry-${j}`,a:pair.a,b:pair.b,kind:"geometric",confidence:1,source:pair.source,frames:pair.matches.flatMap(match=>match.frames)});
	const result=memory.observe({id,atMs,visitId:"episode-1",frames:["frames","left","right"].map(view=>resolve(directory,view,`${String(rows[i].endTick).padStart(4,"0")}.jpg`)),objects:[],description:"",semanticSource:null},[],[],links,arrived);
	snapshots.push({atMs,assignments:result.grouping.assignments});history.push(result.grouping);
	legacySnapshots.push({atMs,assignments:Object.fromEntries(memory.association.graph.getState().observations.map(row=>[row.id,row.nodeId]))});
}
await writeFile(output,JSON.stringify({protocol:"temporal-current-prefix-replay-v1",evidenceBudget:"cached-directional-correspondences + existing local-rotation-geometry; arrived endpoints only",online:{snapshots},legacyOnline:{snapshots:legacySnapshots},groupingHistory:history,memory:memory.snapshot(),note:"Current membership, not baseline visual identity. Positive context anchor/cohort changes only, no certified physical crossing evidence: score mixed-group failures, not coverage alone."},null,2),{flag:"wx"});
