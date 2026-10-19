/** Re-review a saved replay without new identity calls or exposing GT to the agent. */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { SceneAgent } from "../../agent/scene-agent.js";

const input = process.argv[2];
if (!input) throw new Error("usage: node dist/current/sim/replay/review-eval.js <replay-report.json>");
const report = JSON.parse(await readFile(resolve(input), "utf8")) as { layered: { runDir: string }; observations: Array<{ gt: string; pred: string }> };
const runDir = resolve(dirname(resolve(input)), `review-${Date.now()}`);
await mkdir(runDir, { recursive: true });
const store = resolve(runDir, "memory.json");
await copyFile(resolve(report.layered.runDir, "memory.json"), store);
const agent = new SceneAgent(resolve(runDir, "images"), store);
await agent.load();
const before = agent.getState();
for (let pass = 0; pass < 4; pass++) {
	const revisionCount = agent.getState().revisions.length;
	await agent.reviewMemory();
	const state = agent.getState();
	console.log(`review pass ${pass + 1}: places=${state.scenes.length} revisions=${state.revisions.length}, error=${state.reviews.at(-1)?.error ?? "none"}`);
	if (state.revisions.length === revisionCount && state.reviews.slice(-2).every(review => !review.error)) break;
}
const after = agent.getState();
function score(state: typeof before) {
	const counts = new Map<string, Map<string, number>>();
	for (const [index, observation] of state.observations.entries()) {
		const gt = report.observations[index]?.gt;
		if (!gt || gt === "unknown") continue;
		const bucket = counts.get(observation.placeId) ?? new Map<string, number>();
		bucket.set(gt, (bucket.get(gt) ?? 0) + 1);
		counts.set(observation.placeId, bucket);
	}
	return { places: state.scenes.length, spaces: state.spaces.length, revisions: state.revisions.length, purity: [...counts.values()].reduce((sum, bucket) => sum + Math.max(...bucket.values()), 0) / state.observations.length };
}
const summary = { input: resolve(input), runDir, before: score(before), after: score(after), newReviews: after.reviews.slice(before.reviews.length), note: "GT used only in post-review scoring; purity is not room or local-place accuracy. Corrections are hypotheses, not validated truth." };
await writeFile(resolve(runDir, "report.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
