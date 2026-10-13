import type { SegmentLink } from "./segment-association.js";
import type { SegmentObservation, BoundaryEvent } from "./experience-segments.js";

/** Revisable batch departure, NOT a physical-crossing detector. Both old and
 * new cohorts need positive multi-bearing overlap. Missing comparisons abstain.
 * Does not require VO to recognise a context change: rotation can change views
 * without supplying movement evidence. Splits within one region are permitted.
 */
export function proposeCoherentContextChanges(observations: SegmentObservation[], links: SegmentLink[], maxGapMs: number, anchorPolicy: "legacy-first-pair" | "recover-weak-anchors" | "updating-context" | "updating-context-v2" = "legacy-first-pair") {
	const pairs = new Map<string, SegmentLink>();
	const key = (a: string, b: string) => JSON.stringify([a,b].sort());
	for (const link of links.filter(row => row.kind === "visual")) {
		const k=key(link.a,link.b), previous=pairs.get(k);
		if (!previous || previous.confidence<link.confidence) pairs.set(k,link);
	}
	const boundaries: BoundaryEvent[] = [], diagnostics=[];
	if(anchorPolicy==="updating-context"||anchorPolicy==="updating-context-v2") {
		let anchor: number | null=null;
		const score=(a:number,b:number)=>pairs.get(key(observations[a]!.id,observations[b]!.id))?.confidence;
		for(let i=1;i<observations.length;i++) {
			if(observations[i]!.atMs-observations[i-1]!.atMs>maxGapMs){anchor=null;continue;}
			const recent=i-1,support=score(recent,i);
			if(support===undefined||support<.4)continue;
			if(anchor===null){anchor=recent;continue;}
			if(anchor+1>=recent){
				// Sharing a frame is not enough: the new endpoint must positively
				// agree with the previous context before the representative advances.
				if((score(anchor,i)??0)>=.4)anchor=recent;
				continue;
			}
			const cross=[score(anchor,recent),score(anchor,i),score(anchor+1,recent),score(anchor+1,i)];
			const extendsContext=anchorPolicy==="updating-context"
				?cross.some(value=>value!==undefined&&value>=.4)
				:cross.every(value=>value!==undefined&&value>.1)
				 && Math.max(cross[0]!,cross[2]!)>=.4 && Math.max(cross[1]!,cross[3]!)>=.4;
			// Mixed cross evidence is pending: freeze the old context rather than
			// allowing a single doorway/shared-instance match to erase departure.
			if(extendsContext){anchor=recent;continue;}
			if(cross.some(value=>value===undefined||value!>.1))continue;
			const first=observations[recent]!;
			boundaries.push({id:`coherent-context-${first.id}`,beforeObservationId:first.id,source:"automatic",reason:`Updating context: candidate followed by positively consistent observation; confirmed at ${observations[i]!.id}. Context change, not certified crossing.`,frames:[...new Set([anchor,anchor+1,recent,i].flatMap(n=>observations[n]!.frames))]});
			diagnostics.push({beforeObservationId:first.id,confirmedAtObservationId:observations[i]!.id,status:"candidate-departure"});
			anchor=recent;
		}
		return {boundaries,diagnostics,note:"Representatives advance only on positive context support; missing evidence abstains. Two-frame confirmation is provisional, not physical identity."};
	}
	let start=0;
	for(let i=1;i<observations.length;i++) {
		if(observations[i]!.atMs-observations[i-1]!.atMs>maxGapMs) { start=i;continue; }
		if(i<start+3)continue;
		let anchor=start;
		if(anchorPolicy==="recover-weak-anchors") {
			// A weak initial pair cannot veto all later positive evidence. Choose
			// the earliest supported pair in this prefix, disjoint from recent.
			// Strong original anchors remain unchanged; no future evidence/gaps.
			while(anchor<=i-3 && (pairs.get(key(observations[anchor]!.id,observations[anchor+1]!.id))?.confidence??0)<.4)anchor++;
			if(anchor>i-3)continue;
		}
		const old=observations.slice(anchor,anchor+2), recent=observations.slice(i-1,i+1);
		const oldSupport=pairs.get(key(old[0]!.id,old[1]!.id)),newSupport=pairs.get(key(recent[0]!.id,recent[1]!.id));
		if(!oldSupport || !newSupport || oldSupport.confidence<.4 || newSupport.confidence<.4)continue;
		const cross=old.flatMap(a=>recent.map(b=>pairs.get(key(a.id,b.id))));
		if(cross.some(edge=>!edge)) { diagnostics.push({confirmedAtObservationId:observations[i]!.id,status:"missing-comparisons"});continue; }
		if(cross.some(edge=>edge!.confidence>.1))continue;
		const first=recent[0]!;
		boundaries.push({id:`coherent-context-${first.id}`,beforeObservationId:first.id,source:"automatic",reason:`Two positively coherent observations depart from two positively coherent context anchors in four attempted bidirectional comparisons. Confirmed at ${observations[i]!.id}; candidate context change, not certified crossing.`,frames:[...new Set([oldSupport,newSupport,...cross].flatMap(edge=>edge!.frames))]});
		diagnostics.push({beforeObservationId:first.id,confirmedAtObservationId:observations[i]!.id,status:"candidate-departure"});start=i-1;
	}
	return {boundaries,diagnostics,note:"Measured lack of overlap between positively supported cohorts is weak scope evidence, not proof of distinct physical regions. Retain failures and score mixed groups; never infer a change from an absent link."};
}
