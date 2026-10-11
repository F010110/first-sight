import type { SegmentLink } from "./segment-association.js";
export interface RepairGrouping { assignments: Record<string,string>; groups: {id:string;observationIds:string[]}[] }
export interface GroupRepairProposal { id:string; sourceGroupId:string; targetGroupId:string; observationIds:string[]; confirmedAtObservationId:string; evidenceAnchorObservationIds:string[]; evidenceIds:string[]; reason:string }

/** Prefix-only suffix reassignment. Later coherent context must dominate old
 * coherent anchors for >=2 earlier observations. No labels or future inputs. */
export function proposeRetrospectiveRepairs(order:string[],grouping:RepairGrouping,links:SegmentLink[],lookback=8) {
	if(!Number.isInteger(lookback)||lookback<2||new Set(order).size!==order.length)throw new Error("Invalid repair inventory");
	const index=new Map(order.map((id,i)=>[id,i])),pairs=new Map<string,SegmentLink>();
	if(Object.keys(grouping.assignments).length!==order.length||order.some(id=>!grouping.assignments[id]))throw new Error("Missing current repair membership");
	const members=new Set<string>(),groupIds=new Set<string>();
	for(const group of grouping.groups) {
		if(!group.id||groupIds.has(group.id)||!group.observationIds.length)throw new Error("Invalid repair group");groupIds.add(group.id);
		for(const id of group.observationIds) {if(!index.has(id)||members.has(id)||grouping.assignments[id]!==group.id)throw new Error("Future/duplicate repair membership");members.add(id);}
	}
	if(members.size!==order.length)throw new Error("Incomplete repair partition");
	const key=(a:string,b:string)=>JSON.stringify([a,b].sort());
	for(const edge of links.filter(row=>row.kind==="visual")) {
		if(!index.has(edge.a)||!index.has(edge.b))throw new Error("Future repair evidence");
		const k=key(edge.a,edge.b);if(!pairs.has(k)||pairs.get(k)!.confidence<edge.confidence)pairs.set(k,edge);
	}
	const proposals:GroupRepairProposal[]=[],reserved=new Set<string>();
	for(const target of grouping.groups) {
		const targetIds=target.observationIds.slice().sort((a,b)=>index.get(a)!-index.get(b)!);
		if(targetIds.length<2)continue;
        // The entry view may see back through a doorway. Validate against both
        // entry and later target anchors, not merely its first shared surface.
        const refs=[...new Set([...targetIds.slice(0,2),...targetIds.slice(-2)])],targetSupport=pairs.get(key(refs[0]!,refs[1]!));
		if(!targetSupport||targetSupport.confidence<.4)continue;
		const start=index.get(refs[0]!)!;
		if(start<2)continue;
		const previous=order[start-1]!,source=grouping.groups.find(group=>group.id===grouping.assignments[previous]);
		if(!source||source.id===target.id||source.observationIds.length<4)continue;
		const sourceIds=source.observationIds.slice().sort((a,b)=>index.get(a)!-index.get(b)!);
		const oldRefs=sourceIds.slice(0,2),oldSupport=pairs.get(key(oldRefs[0]!,oldRefs[1]!));
		if(!oldSupport||oldSupport.confidence<.4)continue;
		const moving:string[]=[],evidence=new Set([targetSupport.id,oldSupport.id]);
		for(let i=start-1;i>=Math.max(0,start-lookback);i--) {
			const id=order[i]!;
			if(grouping.assignments[id]!==source.id||oldRefs.includes(id)||reserved.has(id))break;
			const later=refs.map(ref=>pairs.get(key(id,ref))),earlier=oldRefs.map(ref=>pairs.get(key(id,ref)));
			if([...later,...earlier].some(edge=>!edge))break;
			const strength=Math.min(...later.map(edge=>edge!.confidence)),oldStrength=Math.max(...earlier.map(edge=>edge!.confidence));
			if(strength<.4||strength-oldStrength<.2)break;
			moving.unshift(id);for(const edge of [...later,...earlier])evidence.add(edge!.id);
		}
		if(moving.length<2)continue;
		const support=pairs.get(key(moving[0]!,moving[1]!));if(!support||support.confidence<.4)continue;evidence.add(support.id);
		for(const id of moving)reserved.add(id);
        proposals.push({id:`repair-${moving[0]}-${target.id}`,sourceGroupId:source.id,targetGroupId:target.id,observationIds:moving,confirmedAtObservationId:order.at(-1)!,evidenceAnchorObservationIds:refs,evidenceIds:[...evidence],reason:"Later context entry AND tail anchors dominate two earlier source anchors for a coherent suffix. Confirmation time is the actual available prefix, not the old anchor timestamp. Revisable reassignment, not certified physical identity."});
	}
	return proposals;
}

export function applyRetrospectiveRepairs(grouping:RepairGrouping,proposals:GroupRepairProposal[]) {
	const result=structuredClone(grouping),moved=new Set<string>();
	for(const proposal of proposals) {
		if(!result.groups.some(group=>group.id===proposal.targetGroupId)||proposal.sourceGroupId===proposal.targetGroupId||proposal.observationIds.length<2)throw new Error("Invalid repair target");
		for(const id of proposal.observationIds) {
			if(moved.has(id)||result.assignments[id]!==proposal.sourceGroupId)throw new Error("Stale/overlapping repair");
			moved.add(id);result.assignments[id]=proposal.targetGroupId;
		}
	}
	for(const group of result.groups)group.observationIds=Object.keys(result.assignments).filter(id=>result.assignments[id]===group.id);
	result.groups=result.groups.filter(group=>group.observationIds.length);
	return result;
}
