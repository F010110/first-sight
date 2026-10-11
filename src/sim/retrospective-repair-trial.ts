/** Separate experimental repair; baseline/current outputs are untouched. */
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {proposeRetrospectiveRepairs,applyRetrospectiveRepairs} from "../agent/retrospective-group-repair.js";
import type {SegmentLink} from "../agent/segment-association.js";
const [dataset,prefixPath,output]=process.argv.slice(2);
if(!dataset||!prefixPath||!output)throw new Error("Usage: retrospective-repair-trial dataset current-prefix NEW-output");
const raw=JSON.parse(await readFile(prefixPath,"utf8")),pairs=JSON.parse(await readFile(resolve(dataset,"experience-directional-evidence.json"),"utf8"));
const second=(v:number[])=>[...v].sort((a,b)=>b-a)[1]??0;
const links:SegmentLink[]=pairs.map((pair:any,i:number)=>({id:`repair-evidence-${i}`,a:pair.a,b:pair.b,kind:"visual",confidence:Math.min(second(pair.bearings),second(pair.backwardBearings??[])),source:pair.source,frames:(pair.views??[]).map((v:any)=>v.frame)}));
const snapshots=[],repairs=[];
for(const [i,snapshot] of raw.online.snapshots.entries()) {
	const order=Object.keys(snapshot.assignments),visible=new Set(order),grouping=raw.groupingHistory[i];
	const proposals=proposeRetrospectiveRepairs(order,grouping,links.filter(edge=>visible.has(edge.a)&&visible.has(edge.b)));
	const result=applyRetrospectiveRepairs(grouping,proposals);
	snapshots.push({atMs:snapshot.atMs,assignments:result.assignments});repairs.push({atMs:snapshot.atMs,proposals});
}
await writeFile(output,JSON.stringify({protocol:"retrospective-repair-trial-v1",online:{snapshots},repairs,originalPrefix:prefixPath,note:"Prefix-specific reversible proposals; not production acceptance. Raw observations, first-arrival decisions and original groupingHistory retained in source. No label/pose/action inputs."},null,2),{flag:"wx"});
