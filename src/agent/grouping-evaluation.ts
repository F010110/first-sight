import { scorePartitionLayer } from "./region-partition-metrics.js";
import { scorePrefixStability, type PrefixSnapshot } from "./region-online-evaluation.js";

type Labels = Record<string, string | null>;
const ratio = (a: number, b: number) => b ? a / b : null;
/** One explicitly reviewed granularity. Never infer room labels from predictions. */
export function scoreGroupingCorrectness(truth: Labels, prediction: Labels) {
	const partition = scorePartitionLayer(truth, prediction);
	const ids = Object.keys(truth).filter(id => truth[id] !== null);
	let same = 0, different = 0, recovered = 0, separated = 0, decided = 0, correct = 0;
	for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
		const a = ids[i]!, b = ids[j]!, expected = truth[a] === truth[b];
		if (expected) same++; else different++;
		if (prediction[a] === null || prediction[b] === null) continue;
		decided++;
		if ((prediction[a] === prediction[b]) === expected) { correct++; if (expected) recovered++; else separated++; }
	}
	const sameRecovery = ratio(recovered, same), differentSeparation = ratio(separated, different);
	return { ...partition, sameRecovery, differentSeparation,
		balancedGroupingScore: sameRecovery === null || differentSeparation === null ? null : (sameRecovery + differentSeparation) / 2,
		correctPairRate: ratio(correct, same + different), accuracyOnDecidedPairs: ratio(correct, decided),
		counts: { same, different, recovered, separated, decided, correct },
		note: "Balanced score equally weights same/different relations and counts unknown as unrecovered. Conditional accuracy must accompany coverage. Boundary/ambiguous truth excluded; evaluate region and subregion layers separately." };
}

export function scoreGroupingStability(snapshots: PrefixSnapshot[], truth: Labels) {
	const raw = scorePrefixStability(snapshots);
	let repairs = 0, regressions = 0, unreviewedFlips = 0, reviewedComparisons = 0, reviewedFlips = 0;
	for (const change of raw.changes) {
		if (change.before === "unknown" || change.after === "unknown") continue;
		if (truth[change.a] == null || truth[change.b] == null) { unreviewedFlips++; continue; }
		reviewedFlips++;
		const expected = truth[change.a] === truth[change.b] ? "same" : "different";
		if (change.after === expected) repairs++; else regressions++;
	}
	// Only previously decided, truth-reviewed pairs can sustain or change a decision.
	for (let s = 1; s < snapshots.length; s++) {
		const before = snapshots[s - 1]!.assignments, after = snapshots[s]!.assignments;
		const ids = Object.keys(before).filter(id => truth[id] != null && before[id] !== null && after[id] !== null);
		for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) reviewedComparisons++;
	}
	const last = snapshots.at(-1);
	return { ...raw, repairs, regressions, unreviewedFlips, reviewedComparisons,
		decisionPersistence: ratio(reviewedComparisons - reviewedFlips, reviewedComparisons),
		harmfulChangeRate: ratio(regressions, reviewedComparisons),
		finalCorrectness: last ? scoreGroupingCorrectness(truth, last.assignments) : null,
		note: "Node renaming is invariant. Repairs are not harmful instability. Persistence is not correctness; all-unknown has no stability score and stable wrong grouping still fails correctness." };
}

export interface GroupContentQuery {
	id: string; queryObservationId: string; relevantHistoricalObservationIds: string[];
	eligibleHistoricalObservationIds: string[]; returnedObservationIds: string[];
}
/** Score actual returned dated observations, not group labels or visual proxies. */
export function scoreGroupContentRecognition(queries: GroupContentQuery[]) {
	const seen = new Set<string>();
	let successes = 0, wrong = 0, unknown = 0, relevant = 0, returned = 0, trueReturned = 0;
	const rows = queries.map(query => {
		if (!query.id || seen.has(query.id) || !query.queryObservationId) throw new Error("Invalid content query identity"); seen.add(query.id);
		for (const list of [query.relevantHistoricalObservationIds, query.eligibleHistoricalObservationIds, query.returnedObservationIds]) if (new Set(list).size !== list.length || list.some(id => !id || id === query.queryObservationId)) throw new Error("Duplicate/self content result");
		const eligible = new Set(query.eligibleHistoricalObservationIds), expected = new Set(query.relevantHistoricalObservationIds);
		if (!expected.size || [...expected, ...query.returnedObservationIds].some(id => !eligible.has(id))) throw new Error("Future/ineligible result or missing reviewed relevance");
		const hits = query.returnedObservationIds.filter(id => expected.has(id)).length;
		const falseHits = query.returnedObservationIds.length - hits;
		if (!query.returnedObservationIds.length) unknown++; else if (falseHits) wrong++; else if (hits) successes++;
		relevant += expected.size; returned += query.returnedObservationIds.length; trueReturned += hits;
		return { id: query.id, hits, falseHits, precision: ratio(hits, query.returnedObservationIds.length), recall: hits / expected.size };
	});
	return { queryCount: queries.length, successes, wrong, unknown, correctRecognitionRate: ratio(successes, queries.length),
		wrongRecognitionRate: ratio(wrong, queries.length), answerCoverage: ratio(queries.length - unknown, queries.length),
		contentPrecision: ratio(trueReturned, returned), contentRecall: ratio(trueReturned, relevant), rows,
		note: "Success requires at least one relevant historical observation and no irrelevant returns. Partial content recall separate. Explicit historical inventory forbids self/future retrieval; it must be built from the executed prefix, not final memory." };
}
