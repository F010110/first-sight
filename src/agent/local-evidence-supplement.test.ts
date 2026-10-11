import { test } from "node:test";
import assert from "node:assert/strict";
import { supplementLocalEvidence } from "./local-evidence-supplement.js";
test("supplement never removes old members or merges established groups", () => {
	const base = { groups: [{ observationIds: ["a", "b"] }, { observationIds: ["c", "d"] }], unresolvedObservationIds: ["e", "f"] };
	const result = supplementLocalEvidence(base, [{ a: "a", b: "c" }, { a: "e", b: "f" }]);
	assert.deepEqual(result.groups.slice(0, 2).map(row => row.observationIds), [["a", "b"], ["c", "d"]]);
	assert.equal(result.unresolvedObservationIds.length, 0);
});
test("partial support cannot silently attach to a multi-anchor baseline", () => {
	const result = supplementLocalEvidence({ groups: [{ observationIds: ["a", "b"] }], unresolvedObservationIds: ["c"] }, [{ a: "a", b: "c" }]);
	assert.deepEqual(result.unresolvedObservationIds, ["c"]);
});
