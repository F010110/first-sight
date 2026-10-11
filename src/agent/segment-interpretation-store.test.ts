import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SegmentInterpretationStore } from "./segment-interpretation-store.js";
const observations = [1, 2, 3].map(i => ({ id: `o${i}`, atMs: i, frames: [`f${i}`] }));
test("revision, retraction and atomic bundle preserve original observations", async () => {
	const store = new SegmentInterpretationStore(observations);
	store.revise({ boundaries: [{ id: "cut", beforeObservationId: "o2", source: "manual-oracle", reason: "review", frames: ["f2"] }], links: [], contradictions: [], reason: "first interpretation" });
	store.revise({ boundaries: [], links: [], contradictions: [], reason: "retracted cut" });
	const dir = await mkdtemp(join(tmpdir(), "first-sight-segment-"));
	try {
		const path = join(dir, "bundle.json"); await store.persist(path);
		const restored = new SegmentInterpretationStore([]); await restored.load(path);
		assert.deepEqual(restored.snapshot(), store.snapshot());
		assert.equal(store.snapshot().revisions[0]!.segmentation.segments.length, 2);
		assert.equal(store.snapshot().revisions[1]!.segmentation.segments.length, 1);
		await writeFile(path, '{"schemaVersion":1,"observations":[],"revisions":[{}]}');
		await assert.rejects(restored.load(path)); assert.deepEqual(restored.snapshot(), store.snapshot());
	} finally { await rm(dir, { recursive: true, force: true }); }
});
test("invalid re-interpretation does not partially update history", () => {
	const store = new SegmentInterpretationStore(observations);
	assert.throws(() => store.revise({ boundaries: [], links: [], contradictions: [], reason: "" }));
	assert.equal(store.snapshot().revisions.length, 0);
});
