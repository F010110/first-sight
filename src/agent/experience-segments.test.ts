import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentExperience, type BoundaryEvent } from "./experience-segments.js";
const observations = [1, 2, 3, 4].map(i => ({ id: `o${i}`, atMs: i * 1000, frames: [`f${i}.jpg`] }));
const event: BoundaryEvent = { id: "b1", beforeObservationId: "o3", source: "manual-oracle", reason: "reviewed crossing", frames: ["f2.jpg", "f3.jpg"] };
test("oracle batches preserve observations without leaking identity or navigation", () => {
	const before = JSON.stringify(observations), result = segmentExperience(observations, [event], 1);
	assert.deepEqual(result.segments.map(row => row.observationIds), [["o1", "o2"], ["o3", "o4"]]);
	assert.ok(result.segments.every(row => row.historicalRegionId === null));
	assert.equal(result.transitions[0]!.traversable, false); assert.equal(JSON.stringify(observations), before);
});
test("boundary retraction yields a new interpretation without modifying the old one", () => {
	const old = segmentExperience(observations, [event], 1);
	assert.equal(segmentExperience(observations, [], 2).segments.length, 1); assert.equal(old.segments.length, 2);
});
test("identity-bearing, duplicate and invalid boundary annotations fail", () => {
	assert.throws(() => segmentExperience(observations, [{ ...event, regionId: "answer" } as BoundaryEvent], 1));
	assert.throws(() => segmentExperience(observations, [event, { ...event, id: "b2" }], 1));
	assert.throws(() => segmentExperience(observations, [{ ...event, beforeObservationId: "o1" }], 1));
});
