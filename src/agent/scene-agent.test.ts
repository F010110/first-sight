import assert from "node:assert/strict";
import { test } from "node:test";
import { parseScene, unresolvedScene, parseCurrentPerception } from "./scene-agent.js";

const base = { place: "beside table", summary: "Local table-side position", objects: ["table"], anchors: ["table"], localRelations: ["beside table"], identityReason: "same table", confidence: 0.95, samePlaceAsPrevious: true, seenBeforeSceneId: "scene-1" };

test("unsupported reuse remains unresolved instead of claiming an identity", () => {
	const decision = parseScene(JSON.stringify(base), new Set(["scene-1"]));
	assert.equal(decision.samePlaceAsPrevious, null);
	assert.equal(decision.seenBeforeSceneId, null);
	assert.ok(decision.confidence < 0.6);
});

test("old identity needs positive position matches without contradictions", () => {
	const matches = ["observer between table and wall in both observations", "observer on the same inside side of doorway"];
	const accepted = parseScene(JSON.stringify({ ...base, positionMatchEvidence: matches, positionalContradictions: [] }), new Set(["scene-1"]));
	assert.equal(accepted.samePlaceAsPrevious, true);
	const rejected = parseScene(JSON.stringify({ ...base, positionMatchEvidence: matches, positionalContradictions: ["current observer is across the aisle"] }), new Set(["scene-1"]));
	assert.equal(rejected.seenBeforeSceneId, null);
	const duplicate = parseScene(JSON.stringify({ ...base, positionMatchEvidence: ["same relation", " SAME RELATION "] }), new Set(["scene-1"]));
	assert.equal(duplicate.seenBeforeSceneId, "scene-1");
});

test("one concrete compatible region relation is enough; exact point matches are not required", () => {
	const decision = parseScene(JSON.stringify({ ...base, positionMatchEvidence: ["both views place the observer in the sofa-to-coffee-table activity region despite rotation"], positionalContradictions: [] }), new Set(["scene-1"]));
	assert.equal(decision.seenBeforeSceneId, "scene-1");
	assert.equal(decision.samePlaceAsPrevious, true);
});

test("explicit new region survives contradictions against the OLD region", () => {
	const result = parseScene(JSON.stringify({ ...base, decision: "new", seenBeforeSceneId: null, regionChangeEvidence: ["crossed doorway into toilet/sink activity region"], positionalContradictions: ["old region is beside bed, current region is inside bathroom"] }), new Set(["scene-1"]), "scene-1");
	assert.equal(result.samePlaceAsPrevious, false);
	assert.equal(result.seenBeforeSceneId, null);
	assert.equal(result.confidence, 0.95);
	assert.throws(() => parseScene(JSON.stringify({ ...base, decision: "new", regionChangeEvidence: ["crossed doorway"] }), new Set(["scene-1"]), "scene-1"), /no old ID/);
});

test("contradictory explicit SAME must be reverified, not silently held", () => {
	assert.throws(() => parseScene(JSON.stringify({ ...base, decision: "same", positionMatchEvidence: ["table-side area"], positionalContradictions: ["now across aisle"] }), new Set(["scene-1"]), "scene-1"), /contradictions/);
});

test("failed re-verification retains perception without accepting an old or new identity", () => {
	for (const decision of ["same", "known", "new"]) {
		const result = unresolvedScene(JSON.stringify({ ...base, decision, changed: false, matchedSceneId: "scene-1", positionMatchEvidence: ["same table"], positionalContradictions: ["across doorway"], regionChangeEvidence: ["crossed doorway"] }));
		assert.equal(result.samePlaceAsPrevious, null);
		assert.equal(result.seenBeforeSceneId, null);
		assert.equal(result.confidence, 0);
		assert.deepEqual(result.anchors, ["table"]);
		assert.deepEqual(result.positionalContradictions, ["across doorway"]);
	}
});

test("invalid perception cannot be silently converted into unresolved evidence", () => {
	assert.throws(() => unresolvedScene("not JSON"));
	assert.throws(() => unresolvedScene(JSON.stringify({ decision: "same" })), /non-empty/);
});

test("first visible activity region can be established without inventing a boundary crossing", () => {
	const initial = { ...base, decision: "new", seenBeforeSceneId: null, regionChangeEvidence: [] };
	assert.equal(parseScene(JSON.stringify(initial), new Set(), null).samePlaceAsPrevious, false);
	assert.throws(() => parseScene(JSON.stringify(initial), new Set(["scene-1"]), "scene-1"), /change evidence/);
	assert.throws(() => parseScene(JSON.stringify({ ...initial, anchors: [] }), new Set(), null), /change evidence/);
});

test("independent perception retains visible relations but never accepts identity fields", () => {
	const perception = parseCurrentPerception(JSON.stringify({ place: "beside sink", summary: "Sink and toilet visible", objects: ["sink", "toilet"], anchors: ["sink"], localRelations: ["beside sink inside doorway"], uncertainties: ["bed position unknown"], decision: "same", seenBeforeSceneId: "bed-place" }));
	assert.deepEqual(perception.anchors, ["sink"]);
	assert.deepEqual(perception.localRelations, ["beside sink inside doorway"]);
	assert.equal("seenBeforeSceneId" in perception, false);
	assert.equal("decision" in perception, false);
	assert.throws(() => parseCurrentPerception(JSON.stringify({ ...base, uncertainties: [], anchors: "bed" })), /string array/);
});
