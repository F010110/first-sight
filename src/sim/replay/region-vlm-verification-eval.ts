/** Exhaustive verification of baseline within-node pairs; evaluation labels never loaded. */
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { createQwenModel } from "../../agent/qwen-provider.js";
import { partitionRegions, type RegionEvidence } from "../../agent/region-partition.js";
const [directory, prefix] = process.argv.slice(2);
if (!directory || !prefix) throw new Error("Usage: region-vlm-verification-eval dataset output-prefix");
const dir = resolve(directory), out = resolve(prefix);
const data = JSON.parse(await readFile(resolve(dir, "experience-sequence-eval.json"), "utf8"));
const windows = (await readFile(resolve(dir, "windows.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
const frame = (id: string) => resolve(dir, "triple", `${String(windows[Number(id.split("-").at(-1)) - 1].endTick).padStart(4, "0")}.jpg`);
const config = createQwenModel(1200);
const prompt = `You are a verifier of a visual algorithm's proposed association, not a mapper. Two triptychs A then B are supplied. Each triptych contains LEFT/FRONT/RIGHT yaw views from one optical center. Between A and B both heading and observer position may change. Panel labels are relative, NOT fixed world directions. They do not cover the full panorama. Object absence or changed panel position does NOT establish a new region. Repeated texture, shared furniture and objects visible through a doorway do NOT establish the same local region. Check specifically whether an object is remotely visible through a framed opening in one observation, while the observer is inside its region in the other. Do not split a region merely because orientation changes or observer takes a small step. Boundary observations may belong to either neighboring region. You have no coordinates, action labels or trusted motion. Do not invent distances, exact rotations, same optical center across A/B, or navigation permission. Return ONLY JSON {verdict:"compatible"|"contradiction"|"unknown", contradictionType:"opening-side"|"incompatible-local-layout"|"none", evidenceA:string, evidenceB:string, reason:string}. Use contradiction only when visible observer-side architecture establishes incompatible local scopes, NOT only different visible objects. compatible means no demonstrated conflict, not confirmed identity. When unsure use unknown.`;
const pairs: { a: string; b: string; nodeId: string }[] = [];
for (const node of data.nodes) for (let i = 0; i < node.observationIds.length; i++) for (let j = i + 1; j < node.observationIds.length; j++) pairs.push({ a: node.observationIds[i], b: node.observationIds[j], nodeId: node.id });
await writeFile(`${out}-calls.jsonl`, "", { flag: "wx" });
const results: any[] = [];
for (const [index, pair] of pairs.entries()) {
	const started = Date.now(); let raw = "", parsed: any = null, error: string | null = null;
	try {
		const agent = new Agent({ initialState: { model: config.model, tools: [], systemPrompt: prompt }, streamFn: config.streamFn });
		await agent.prompt("Verify proposed association. First image A; second image B. Do not assume the proposal is correct.", await Promise.all([pair.a, pair.b].map(async id => ({ type: "image" as const, data: (await readFile(frame(id))).toString("base64"), mimeType: "image/jpeg" }))));
		if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
		const message = [...agent.state.messages].reverse().find(item => item.role === "assistant");
		if (!message || message.role !== "assistant") throw new Error("No response");
		raw = message.content.filter(block => block.type === "text").map(block => block.text).join("\n");
		parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""));
		if (!["compatible", "contradiction", "unknown"].includes(parsed.verdict) || !["opening-side", "incompatible-local-layout", "none"].includes(parsed.contradictionType)
			|| [parsed.evidenceA, parsed.evidenceB, parsed.reason].some(value => typeof value !== "string" || !value.trim())
			|| (parsed.verdict === "contradiction" && parsed.contradictionType === "none")) throw new Error("Invalid verifier schema");
	} catch (e) { error = String(e); parsed = null; }
	const row = { ...pair, raw, parsed, error, elapsedMs: Date.now() - started };
	results.push(row); await appendFile(`${out}-calls.jsonl`, JSON.stringify(row) + "\n");
	console.log(`${index + 1}/${pairs.length}: ${pair.a}/${pair.b} ${parsed?.verdict ?? "error"}`);
}
// Derived, nonmutating proposal only. Compatible/unknown never creates a new link.
// All baseline within-node relationships remain positive except explicit vetoes.
const weight = pairs.length + 1;
const evidence: RegionEvidence[] = results.map((row, index) => ({ id: `verify-${index}`, a: row.a, b: row.b,
	relation: row.parsed?.verdict === "contradiction" ? "different" : "same",
	weight: row.parsed?.verdict === "contradiction" ? weight : 1,
	source: row.parsed?.verdict === "contradiction" ? "vlm-structural-veto" : "baseline-membership-retained-not-vlm-confirmation",
	reason: row.parsed?.reason ?? "Verifier failed; baseline unchanged", frames: [frame(row.a), frame(row.b)] }));
const supportedIds: string[] = data.nodes.flatMap((node: any) => node.observationIds);
const revised = partitionRegions(supportedIds, evidence, { refine: true });
const allIds = Array.from({ length: data.summary.observations }, (_, i) => `observation-${i + 1}`);
const pending = allIds.filter(id => !supportedIds.includes(id));
await writeFile(`${out}-eval.json`, JSON.stringify({ note: "Offline exhaustive auxiliary verifier on existing visual nodes, NOT automatic activity-region mapping or independent ground truth. No labels/poses/GT read. Unknown/errors retain baseline, compatible is not identity confirmation. Veto-based partition is a reversible derived proposal; production and original bundle unchanged. Singleton splits abstain rather than assert new physical regions.", prompt, summary: { observations: allIds.length, pairs: pairs.length, vetoes: results.filter(row => row.parsed?.verdict === "contradiction").length, unknown: results.filter(row => row.parsed?.verdict === "unknown").length, errors: results.filter(row => row.error).length, totalCallMs: results.reduce((sum, row) => sum + row.elapsedMs, 0) }, baseline: { groups: data.nodes, unresolvedObservationIds: pending }, revised: { ...revised, unresolvedObservationIds: [...pending, ...revised.unresolvedObservationIds] }, evidence }, null, 2), { flag: "wx" });
