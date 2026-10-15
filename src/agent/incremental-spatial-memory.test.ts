import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IncrementalSpatialMemory, type SpatialDecision } from "./incremental-spatial-memory.js";

test("incremental identities, bounded representatives, originals and restart", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spatial-"));
	try {
		const path = join(dir, "memory.json");
		const memory = new IncrementalSpatialMemory(path, async (_, history) => ({ kind: history.currentPlaceId ? "same" : "new", summary: "kitchen island", reason: "visible layout" }));
		for (let i = 0; i < 5; i++) await memory.enqueue({ id: String(i), atMs: i, frames: [`frame-${i}.jpg`] });
		assert.equal(memory.query("island").length, 1);
		assert.equal(memory.snapshot().places[0]!.representatives.length, 3);
		assert.equal(memory.snapshot().records.length, 5);
		const restored = new IncrementalSpatialMemory(path, async () => ({ kind: "unknown", summary: "", reason: "occluded" }));
		await restored.load();
		assert.deepEqual(restored.snapshot(), memory.snapshot());
		await restored.enqueue({ id: "unknown", atMs: 6, frames: ["new.jpg"] });
		assert.equal(restored.snapshot().currentPlaceId, null);
		assert.equal(restored.query("kitchen").length, 1);
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test("readers do not block; failed model call does not poison queue; no future evidence", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spatial-"));
	try {
		let release!: (value: SpatialDecision) => void;
		const memory = new IncrementalSpatialMemory(join(dir, "m.json"), async (observation, history) => {
			assert.equal(history.records.length, 0);
			if (observation.id === "a") return new Promise(resolve => { release = resolve; });
			return { kind: "new", summary: "bedroom", reason: "bed layout" };
		});
		const failed = memory.enqueue({ id: "a", atMs: 1, frames: ["a.jpg"] });
		await Promise.resolve();
		assert.equal(memory.snapshot().records.length, 0);
		await assert.rejects(memory.enqueue({ id: "a", atMs: 1, frames: ["a.jpg"] }), /Duplicate/);
		const next = memory.enqueue({ id: "b", atMs: 2, frames: ["b.jpg"] });
		release({ kind: "known", placeId: "invented", summary: "", reason: "invalid" });
		await assert.rejects(failed, /Unsupported/);
		await next;
		assert.equal(memory.snapshot().records.length, 1);
		await assert.rejects(memory.enqueue({ id: "c", atMs: 0, frames: ["c.jpg"] }), /Out-of-order/);
	} finally { await rm(dir, { recursive: true, force: true }); }
});
