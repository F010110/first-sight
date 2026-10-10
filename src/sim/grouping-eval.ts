/** Full-observation grouping, no VLM, motion, poses or room IDs in algorithms. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { matchImages } from "../agent/image-match.js";
import { proposePlaces, buildRegionEdges, proposeSpaces, type PairAffinity } from "../agent/topological-grouping.js";
const dir = resolve(process.argv[2] ?? "run/sim/multiview-val5-clean-20261007");
const rows = (await readFile(resolve(dir,"windows.jsonl"),"utf8")).trim().split(/\r?\n/).slice(0,40).map(line => JSON.parse(line));
const ids = rows.map((_,i) => `observation-${i + 1}`);
const cached = process.argv.includes("--reuse") ? JSON.parse(await readFile(resolve(dir,"grouping-experiment.json"),"utf8")) as { pairs: PairAffinity[] } : null;
if (cached && (rows.length !== 40 || cached.pairs.length !== 780)) throw new Error("Evidence cache does not match the 40-observation experiment");
const paths = (tick: number) => ["frames","left","right"].map((folder,i) => ({ direction: i, path: resolve(dir,folder,`${String(tick).padStart(4,"0")}.jpg`) }));
const pathDirections = new Map(rows.flatMap(row => paths(row.endTick).map(view => [view.path,view.direction] as const)));
const directional = new Map<string, { strengths: number[]; inliers: number; supported: number }>();
for (let i = 0; i < (cached ? 0 : rows.length); i++) {
	const query = paths(rows[i]!.endTick);
	const candidates = rows.flatMap((row,j) => i === j ? [] : paths(row.endTick).map(view => ({id: ids[j]!,path:view.path})));
	const result = await matchImages(query.map(view => view.path),candidates,{minInliers:15,maxDim:640,timeoutMs:120000});
	if (!result.ok) throw new Error(`Matcher failed at ${ids[i]}: ${result.error}`);
	for (const id of ids) {
		if (id === ids[i]) continue;
		const strengths = [0,0,0]; let inliers = 0;
		for (const entry of result.results.filter(entry => entry.id === id)) {
			inliers = Math.max(inliers,entry.inliers);
			const direction = entry.queryPath ? pathDirections.get(entry.queryPath) : undefined;
			if (direction !== undefined) strengths[direction] = Math.max(strengths[direction]!,Math.min(entry.inliers / 60,1));
		}
		directional.set(`${ids[i]}:${id}`,{strengths,inliers,supported:strengths.filter(value => value >= 0.25).length});
	}
	console.log(`grouping evidence ${i + 1}/${rows.length}`);
}
const pairs: PairAffinity[] = cached?.pairs ?? [];
for (let i = 0; i < (cached ? 0 : ids.length); i++) for (let j = i + 1; j < ids.length; j++) {
	const forward = directional.get(`${ids[i]}:${ids[j]}`)!, backward = directional.get(`${ids[j]}:${ids[i]}`)!;
	// Two camera bearings must support the pair in BOTH comparison directions.
	const second = (values: number[]) => values.slice().sort((a,b) => b-a)[1]!;
	pairs.push({a:ids[i]!,b:ids[j]!,score:Math.min(second(forward.strengths),second(backward.strengths)),directions:Math.min(forward.supported,backward.supported)});
}
const experiments = [{threshold:0.25,directions:2},{threshold:0.4,directions:2},{threshold:0.6,directions:2},{threshold:0.15,directions:1},{threshold:0.25,directions:1}].map(({threshold,directions}) => {
	const places = proposePlaces(ids,pairs,threshold,directions), edges = buildRegionEdges(ids,places), spaces = proposeSpaces(places,edges);
	const assignment = new Map(places.flatMap(place => place.members.map(member => [member,place.id] as const)));
	// Diagnostic annotations below are consulted ONLY after groups exist.
	let samePositionPairs=0, reused=0, crossRoomGroupedPairs=0;
	for (let i=0;i<rows.length;i++) for (let j=i+1;j<rows.length;j++) {
		const sameGroup=assignment.get(ids[i]!)===assignment.get(ids[j]!);
		if (Math.hypot(rows[i]!.endPose.x-rows[j]!.endPose.x,rows[i]!.endPose.z-rows[j]!.endPose.z)<=0.05) {samePositionPairs++;if(sameGroup)reused++;}
		if (sameGroup && rows[i]!.room!==rows[j]!.room) crossRoomGroupedPairs++;
	}
	const summary={threshold,minimumDirections:directions,places:places.length,spaces:spaces.length,samePositionPairs,reused,crossRoomGroupedPairs};
	console.log(JSON.stringify(summary));return {...summary,placeGroups:places,spaceGroups:spaces,edges};
});
await writeFile(resolve(dir,"grouping-experiment.json"),JSON.stringify({note:"Uncalibrated complete-link multiview surface-affinity groups are provisional visual-region candidates, not validated activity-region Places. Space candidates use repeated temporal adjacency and greedy modularity; common spatial scope is NOT verified. Motion disabled; no GT in grouping. Room disagreement and exact-position reuse are posthoc diagnostics, not semantic grouping accuracy. No production memory changed.",pairs,experiments},null,2));
const html = experiments.map(experiment => `<h2>Threshold ${experiment.threshold}, supported bearings ${experiment.minimumDirections}: ${experiment.places} Place candidates / ${experiment.spaces} Space candidates</h2>${experiment.placeGroups.map(place => `<section><h3>${place.id}: ${place.members.join(", ")}</h3>${place.members.map(member => {const i=ids.indexOf(member);return `<figure><img src="triple/${String(rows[i]!.endTick).padStart(4,"0")}.jpg"><figcaption>${member}</figcaption></figure>`;}).join("")}</section>`).join("")}`).join("");
await writeFile(resolve(dir,"grouping-inspection.html"),`<!doctype html><meta charset="utf-8"><title>Provisional grouping inspection</title><style>body{font-family:sans-serif;background:#222;color:#eee}section{border:1px solid #777;padding:12px;margin:12px}figure{display:inline-block;margin:4px;width:46%}img{width:100%}</style><h1>Provisional visual Place grouping — not ground truth</h1><p>No motion/VLM/coordinates. Compare candidate members visually; Space scope remains unverified.</p>${html}`);
