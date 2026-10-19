import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { groupExperience } from "../../agent/experience-grouping.js";
import type { ExperienceSnapshot } from "../../agent/experience-graph.js";
import type { CorrespondenceEvidence } from "../../agent/experience-association.js";
const dir=resolve(process.argv[2]??"run/sim/multiview-val5-clean-20261007");
const {graph:state}=JSON.parse(await readFile(resolve(dir,"experience-sequence-bundle.json"),"utf8")) as {graph:ExperienceSnapshot};
const evidence=JSON.parse(await readFile(resolve(dir,"experience-directional-evidence.json"),"utf8")) as CorrespondenceEvidence[];
const rows=(await readFile(resolve(dir,"windows.jsonl"),"utf8")).trim().split(/\r?\n/).slice(0,40).map(line=>JSON.parse(line));
const experiments=[0.25,0.15,0.1].map(threshold=>{
	const result=groupExperience(state,evidence,threshold);let crossRoomPairs=0;
	for(const group of result.groups)for(let i=0;i<group.observationIds.length;i++)for(let j=i+1;j<group.observationIds.length;j++){
		const a=Number(group.observationIds[i]!.split("-").at(-1))-1,b=Number(group.observationIds[j]!.split("-").at(-1))-1;
		if(rows[a].room!==rows[b].room)crossRoomPairs++;
	}
	const summary={threshold,groups:result.groups.length,multiUnitGroups:result.groups.filter(group=>group.unitIds.length>1).length,unassignedObservations:40-result.groups.reduce((sum,group)=>sum+group.observationIds.length,0),crossRoomPairs};
	console.log(JSON.stringify(summary));return {...result,summary};
});
await writeFile(resolve(dir,"experience-grouping-eval.json"),JSON.stringify({note:"Optional Place proposals on fixed sequence anchors + pending observations. Thresholds are ablations, not tuned ground truth. Room labels only used posthoc; no activity-region annotations, so false merges/splits cannot yet be scored.",experiments},null,2));
const html=experiments.map(experiment=>`<h2>threshold ${experiment.threshold}: ${experiment.groups.length} groups</h2>${experiment.groups.map(group=>`<section><h3>${group.id} — ${group.unitIds.join(", ")}</h3>${group.observationIds.map(id=>{const index=Number(id.split("-").at(-1))-1;return `<figure><img loading="lazy" src="triple/${String(rows[index].endTick).padStart(4,"0")}.jpg"><figcaption>W${index+1}</figcaption></figure>`;}).join("")}</section>`).join("")}`).join("");
await writeFile(resolve(dir,"experience-grouping-inspection.html"),`<!doctype html><meta charset="utf-8"><title>Optional Place groups</title><style>body{font-family:sans-serif;background:#222;color:#eee}section{border:1px solid #777;margin:16px;padding:8px}figure{display:inline-block;width:45%;margin:8px}img{width:100%}</style><h1>Provisional groups, not verified physical regions</h1>${html}`);
