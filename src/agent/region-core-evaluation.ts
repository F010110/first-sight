/** Manual core/boundary labels are evaluation only, never inference inputs. */
export interface CoreLabel {
	observationId: string;
	kind: "core" | "boundary" | "unknown";
	regions: string[];
	reason: string;
	frames: string[];
}
export function evaluateRegionCores(prediction: { groups: { observationIds: string[] }[]; unresolvedObservationIds: string[] }, labels: CoreLabel[]) {
	const membership = new Map<string, number>();
	for (const [i, group] of prediction.groups.entries()) for (const id of group.observationIds) {
		if (membership.has(id)) throw new Error(`Duplicate prediction: ${id}`);
		membership.set(id, i);
	}
	const unresolved = new Set<string>();
	for (const id of prediction.unresolvedObservationIds) {
		if (unresolved.has(id) || membership.has(id)) throw new Error(`Duplicate prediction: ${id}`);
		unresolved.add(id);
	}
	const seen = new Set<string>();
	for (const row of labels) {
		if (seen.has(row.observationId) || (!membership.has(row.observationId) && !unresolved.has(row.observationId))
			|| !["core", "boundary", "unknown"].includes(row.kind) || !row.reason.trim() || !row.frames.length
			|| new Set(row.regions).size !== row.regions.length || row.regions.some(id => !id.trim())
			|| (row.kind === "core" && row.regions.length !== 1) || (row.kind === "boundary" && !row.regions.length)
			|| (row.kind === "unknown" && row.regions.length)) throw new Error(`Invalid core label: ${row.observationId}`);
		seen.add(row.observationId);
	}
	// Partial annotation would hide mixed-region cores and inflate coverage.
	if (seen.size !== membership.size + unresolved.size) throw new Error("Every predicted observation requires a label (unknown is allowed)");
	const cores = labels.filter(row => row.kind === "core");
	const regions = [...new Set(cores.map(row => row.regions[0]!))].sort();
	const perRegion = regions.map(region => {
		const members = cores.filter(row => row.regions[0] === region);
		const groups = [...new Set(members.flatMap(row => membership.has(row.observationId) ? [membership.get(row.observationId)!] : []))];
		return { region, coreIds: members.map(row => row.observationId), supportedGroups: groups, missingCoreIds: members.filter(row => unresolved.has(row.observationId)).map(row => row.observationId), fragmented: groups.length > 1, fragmentationAssessable: members.length >= 2 };
	});
	const mixedGroups = prediction.groups.flatMap((group, index) => {
		const members = cores.filter(row => membership.get(row.observationId) === index);
		const regionIds = [...new Set(members.map(row => row.regions[0]!))];
		return regionIds.length > 1 ? [{ group: index, regions: regionIds, coreIds: members.map(row => row.observationId) }] : [];
	});
	const boundaries = labels.filter(row => row.kind === "boundary").map(row => {
		const group = membership.get(row.observationId);
		const coreRegions = group === undefined ? [] : [...new Set(cores.filter(core => membership.get(core.observationId) === group).map(core => core.regions[0]!))];
		return { observationId: row.observationId, outcome: group === undefined ? "abstained" : !coreRegions.length ? "unanchored" : coreRegions.every(region => row.regions.includes(region)) ? "allowed" : "wrong-region", coreRegions };
	});
	const covered = cores.filter(row => membership.has(row.observationId)).length;
	return { summary: { regions: regions.length, cores: cores.length, coveredCores: covered, coreCoverage: cores.length ? covered / cores.length : null,
		mixedGroups: mixedGroups.length, fragmentedRegions: perRegion.filter(row => row.fragmented).length,
		regionsWithMissingCores: perRegion.filter(row => row.missingCoreIds.length).length,
		unassessableRegions: perRegion.filter(row => !row.fragmentationAssessable).length }, perRegion, mixedGroups, boundaries };
}
