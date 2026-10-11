import { test } from "node:test";
import assert from "node:assert/strict";
import { compareHeadings, summarizeTurn, type HeadingSample } from "./orientation-evidence.js";
const sample = (yawDegrees: number, atMs = 0): HeadingSample => ({ observationId: `o${atMs}`, atMs, yawDegrees, uncertaintyDegrees: 1, referenceId: "session-camera-calibrated", source: "simulation-experiment", quality: "usable" });
test("angular constraints handle wrap and camera axes without metric displacement", () => {
	const result = compareHeadings(sample(350), sample(10), 90, 90);
	assert.equal(result.status === "available" && result.deltaDegrees, 20);
	assert.equal(compareHeadings(sample(0), sample(90), 90, 0).status, "available");
	assert.equal(compareHeadings(sample(0), sample(90), 90, 0).status === "available" && (compareHeadings(sample(0), sample(90), 90, 0) as any).deltaDegrees, 0);
});
test("all tested angles including multiple revolutions preserve angular history", () => {
	for (const step of [15, 30, 45, 60, 90, 120]) for (const direction of [-1, 1]) {
		const count = 720 / step;
		const result = summarizeTurn(Array.from({ length: count + 1 }, (_, i) => sample(i * step * direction, i * 1000)));
		assert.equal(result.status === "available" && result.totalDegrees, 720 * direction);
		assert.equal(result.status === "available" && result.provesStationary, false);
	}
});
test("dropout, reference change and uncertain half turns abstain", () => {
	assert.equal(compareHeadings(undefined, sample(0)).status, "unknown");
	assert.equal(compareHeadings(sample(0), { ...sample(90), referenceId: "reset" }).status, "unknown");
	assert.equal(summarizeTurn([sample(0), sample(90, 3000)]).status, "unknown");
	assert.equal(summarizeTurn([sample(0), sample(180, 1000)]).status, "unknown");
	assert.throws(() => compareHeadings({ ...sample(0), x: 1 } as HeadingSample, sample(90)));
});
