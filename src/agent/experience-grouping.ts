import type { ExperienceSnapshot } from "./experience-graph.js";
import type { CorrespondenceEvidence } from "./experience-association.js";
import { proposePlaces, type PairAffinity } from "./topological-grouping.js";

export interface ExperiencePlaceGroup {
	id: string; unitIds: string[]; observationIds: string[];
	status: "provisional"; scopeVerified: false;
}

/** Optional derived layer: never edits visual identity or observations. */
export function groupExperience(state: ExperienceSnapshot, evidence: CorrespondenceEvidence[], threshold: number) {
	const units = [
		...state.nodes.filter(node=>node.observationIds.length).map(node=>({id:node.id,observations:node.observationIds})),
		...state.observations.filter(row=>row.nodeId===null).map(row=>({id:`pending:${row.id}`,observations:[row.id]})),
	];
	const key=(a:string,b:string)=>[a,b].sort().join("\0");
	const second=(scores:number[])=>scores.slice().sort((a,b)=>b-a)[1]??0;
	const scores=new Map(evidence.map(pair=>[key(pair.a,pair.b),Math.min(second(pair.bearings),second(pair.backwardBearings??pair.bearings))]));
	const assignment=new Map(units.flatMap(unit=>unit.observations.map(id=>[id,unit.id] as const)));
	const adjacency=new Map<string,number>();
	for(const visit of state.visits)for(let i=1;i<visit.observationIds.length;i++){
		const a=assignment.get(visit.observationIds[i-1]!)!,b=assignment.get(visit.observationIds[i]!)!;
		if(a!==b)adjacency.set(key(a,b),(adjacency.get(key(a,b))??0)+1);
	}
	const pairs:PairAffinity[]=[];
	for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++){
		const a=units[i]!,b=units[j]!;
		// Each view needs some compatible counterpart, not all possible heading pairs.
		const coverage=Math.min(
			...a.observations.map(x=>Math.max(...b.observations.map(y=>scores.get(key(x,y))??0))),
			...b.observations.map(y=>Math.max(...a.observations.map(x=>scores.get(key(x,y))??0))),
		);
		pairs.push({a:a.id,b:b.id,score:coverage,directions:2});
	}
	const groups:ExperiencePlaceGroup[]=proposePlaces(units.map(unit=>unit.id),pairs,threshold).map(group=>({id:group.id,unitIds:group.members,observationIds:group.members.flatMap(id=>units.find(unit=>unit.id===id)!.observations),status:"provisional",scopeVerified:false}));
	return {threshold,units,groups,pairs:pairs.map(pair=>({...pair,temporalAdjacencyCount:adjacency.get(key(pair.a,pair.b))??0})),note:"Bidirectional two-bearing view coverage and complete-link over immutable units. Adjacency is diagnostic only; visual overlap does not prove same activity region. No semantics, GT, displacement or navigability inputs."};
}
