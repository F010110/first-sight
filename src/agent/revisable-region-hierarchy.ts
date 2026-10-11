/** Explicit revisable region/subregion organization, independent of raw graph. */
export interface RegionScope {
	id: string; layer: "region" | "subregion"; parentId: string | null;
	observationIds: string[]; source: "temporal-proposal" | "reviewed"; reason: string;
}
export function validateRegionHierarchy(scopes: RegionScope[], knownObservationIds: string[]) {
	const known = new Set(knownObservationIds), ids = new Set<string>(), membership = new Set<string>();
	if (known.size !== knownObservationIds.length) throw new Error("Duplicate original observation IDs");
	for (const scope of scopes) {
		if (!scope.id || ids.has(scope.id) || !["region", "subregion"].includes(scope.layer) || !["temporal-proposal", "reviewed"].includes(scope.source) || !scope.reason.trim() || !scope.observationIds.length || new Set(scope.observationIds).size !== scope.observationIds.length) throw new Error("Invalid region scope");
		ids.add(scope.id);
		for (const id of scope.observationIds) {
			const key = JSON.stringify([scope.layer, id]);
			if (!known.has(id) || membership.has(key)) throw new Error("Unknown/duplicate primary scope membership"); membership.add(key);
		}
	}
	for (const scope of scopes) {
		if (scope.layer === "region" && scope.parentId !== null) throw new Error("Region parent must be null");
		if (scope.layer === "subregion") {
			const parent = scopes.find(row => row.id === scope.parentId);
			if (!parent || parent.layer !== "region" || scope.observationIds.some(id => !parent.observationIds.includes(id))) throw new Error("Subregion must be contained by its parent region");
		}
	}
	return structuredClone(scopes);
}
