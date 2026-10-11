/** Revisable temporal interpretation, independent of historical region identity. */
export interface SegmentObservation { id: string; atMs: number; frames: string[] }
export interface BoundaryEvent {
	id: string;
	/** First observation after the transition. No region IDs are accepted. */
	beforeObservationId: string;
	source: "manual-oracle" | "automatic";
	reason: string;
	frames: string[];
}
export function segmentExperience(observations: SegmentObservation[], boundaries: BoundaryEvent[], revision: number) {
	if (!Number.isInteger(revision) || revision < 1) throw new Error("Invalid segmentation revision");
	const positions = new Map<string, number>();
	for (const [i, row] of observations.entries()) {
		if (!row.id || positions.has(row.id) || !Number.isFinite(row.atMs) || !row.frames.length || (i > 0 && row.atMs < observations[i - 1]!.atMs)) throw new Error("Invalid observation sequence");
		positions.set(row.id, i);
	}
	const eventIds = new Set<string>(), cuts = new Map<number, BoundaryEvent>();
	for (const event of boundaries) {
		const index = positions.get(event.beforeObservationId);
		if (!event.id || eventIds.has(event.id) || index === undefined || index === 0 || cuts.has(index)
			|| !["manual-oracle", "automatic"].includes(event.source) || !event.reason.trim() || !event.frames.length
			|| Object.keys(event).some(key => !["id", "beforeObservationId", "source", "reason", "frames"].includes(key))) throw new Error(`Invalid boundary event: ${event.id}`);
		eventIds.add(event.id); cuts.set(index, structuredClone(event));
	}
	const starts = observations.length ? [0, ...cuts.keys()].sort((a, b) => a - b) : [];
	const segments = starts.map((start, i) => ({
		id: `segment-r${revision}-${i + 1}`, observationIds: observations.slice(start, starts[i + 1] ?? observations.length).map(row => row.id),
		boundaryEventId: cuts.get(start)?.id ?? null,
		historicalRegionId: null,
		status: "candidate" as const,
	}));
	return { revision, note: "Temporal candidate batches only. No detected boundary does not prove same physical region. Segment identity is revision-local; historical region association remains separate.", boundaries: [...cuts.values()], segments,
		transitions: segments.slice(1).map((segment, i) => ({ from: segments[i]!.id, to: segment.id, boundaryEventId: segment.boundaryEventId, traversable: false as const })) };
}
