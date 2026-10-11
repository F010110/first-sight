import type { SegmentLink } from "./segment-association.js";
import type { SegmentObservation, BoundaryEvent } from "./experience-segments.js";

/** Revisable batch departure, NOT a physical-crossing detector. Both old and
 * new cohorts need positive multi-bearing overlap. Missing comparisons abstain.
 * Does not require VO to recognise a context change: rotation can change views
 * without supplying movement evidence. Splits within one region are permitted.
 */
export function proposeCoherentContextChanges(observations: SegmentObservation[], links: SegmentLink[], maxGapMs: number) {
	const pairs = new Map<string, SegmentLink>();
	const key = (a: string, b: string) => JSON.stringify([a,b].sort());
	for (const link of links.filter(row => row.kind === "visual")) {
		const k=key(link.a,link.b), previous=pairs.get(k);
		if (!previous || previous.confidence<link.confidence) pairs.set(k,link);
	}
	const boundaries: BoundaryEvent[] = [], diagnostics=[];
	let start=0;
	for(let i=1;i<observations.length;i++) {
		if(observations[i]!.atMs-observations[i-1]!.atMs>maxGapMs) { start=i;continue; }
		if(i<start+3)continue;
		const old=observations.slice(start,start+2), recent=observations.slice(i-1,i+1);
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
