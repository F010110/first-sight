import { test } from "node:test";
import assert from "node:assert/strict";
import { associateSegments, type SegmentLink } from "./segment-association.js";
const segments = [{ id: "A1", observationIds: ["a", "b"] }, { id: "B", observationIds: ["c", "d"] }, { id: "A2", observationIds: ["e", "f"] }];
const link = (a: string, b: string, kind: SegmentLink["kind"] = "geometric"): SegmentLink => ({ id: a + b, a, b, kind, confidence: .9, source: "fixture", frames: [a, b] });
test("multiple anchors associate episodes without answer IDs", () => {
	assert.equal(associateSegments(segments, [link("a", "e"), link("b", "f")], [], 1).hypotheses[1]!.targetSegmentId, "A1");
});
test("pure appearance and one repeated anchor cannot authorize identity", () => {
	assert.equal(associateSegments(segments, [link("a", "e", "visual"), link("b", "f", "visual")], [], 1).hypotheses[1]!.status, "unknown");
	assert.equal(associateSegments(segments, [link("a", "e"), link("a", "f")], [], 1).hypotheses[1]!.status, "unknown");
});
test("conflicts, ambiguity and retraction stay revisable", () => {
	const links = [link("a", "e"), link("b", "f"), link("c", "e"), link("d", "f")];
	assert.equal(associateSegments(segments, links, [], 1).hypotheses[1]!.status, "ambiguous");
	const conflict = { id: "negative", a: "c", b: "e", source: "review", reason: "verified distinct scopes", frames: ["c", "e"] };
	assert.equal(associateSegments(segments, links, [conflict], 2).hypotheses[1]!.targetSegmentId, "A1");
	assert.equal(associateSegments(segments, [], [], 3).hypotheses[1]!.status, "unknown");
});
test("multiple episodes of one supported history no longer compete with each other", () => {
	const all = [...segments, { id: "A3", observationIds: ["g", "h"] }];
	const result = associateSegments(all, [link("a", "e"), link("b", "f"), link("a", "g"), link("b", "h"), link("e", "g"), link("f", "h")], [], 1);
	assert.equal(result.hypotheses[2]!.status, "supported"); assert.equal(result.hypotheses[2]!.targetSegmentId, "A1");
});
test("shared boundary context can retrieve candidates but cannot confirm identity alone", () => {
	const candidates = structuredClone(segments).map(segment => ({ ...segment, sharedBoundaryAnchorIds: segment.id === "A2" ? ["c", "d"] : [] }));
	const result = associateSegments(candidates, [link("a", "c"), link("b", "d")], [], 1);
	assert.equal(result.hypotheses[1]!.status, "unknown");
	assert.equal(result.hypotheses[1]!.candidates[0]!.supplementaryBoundaryEvidenceIds.length, 2);
});
