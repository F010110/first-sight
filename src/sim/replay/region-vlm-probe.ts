/** Offline structural VLM probe; no poses, room IDs, evaluation labels or memberships. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { createQwenModel } from "../../agent/qwen-provider.js";
const [directory, output] = process.argv.slice(2);
if (!directory || !output) throw new Error("Usage: region-vlm-probe dataset output.json");
const dir = resolve(directory);
const windows = (await readFile(resolve(dir, "windows.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
// Small diagnostic set includes suspicious loop and legitimate same-scope views.
// Pair selection is development-driven; not blind evaluation.
const temporal = process.argv.includes("--temporal-rotation-check");
const pairs = temporal ? [[28, 29]] : [[7, 13], [7, 38], [13, 38], [4, 5], [1, 57], [20, 24], [28, 29], [13, 21]];
const config = createQwenModel(1800);
async function ask(systemPrompt: string, prompt: string, paths: string[]) {
	const agent = new Agent({ initialState: { model: config.model, tools: [], systemPrompt }, streamFn: config.streamFn });
	const started = Date.now();
	await agent.prompt(prompt, await Promise.all(paths.map(async path => ({ type: "image" as const, data: (await readFile(path)).toString("base64"), mimeType: "image/jpeg" }))));
	if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
	const msg = [...agent.state.messages].reverse().find(item => item.role === "assistant");
	if (!msg || msg.role !== "assistant") throw new Error("No response");
	const raw = msg.content.filter(block => block.type === "text").map(block => block.text).join("\n");
	let parsed: unknown = null;
	try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")); } catch { /* Preserve invalid raw, never guess a verdict. */ }
	return { raw, parsed, elapsedMs: Date.now() - started };
}
const frame = (w: number) => resolve(dir, "triple", `${String(windows[w - 1].endTick).padStart(4, "0")}.jpg`);
const perceptions: Record<string, Awaited<ReturnType<typeof ask>>> = {};
const results: unknown[] = [];
const base = "LEFT/FRONT/RIGHT within EACH triptych are three relative-yaw views from ONE optical center, not temporal frames or stereo cameras. Different observations may have arbitrarily different headings AND different positions. LEFT in A does NOT denote the same world direction as LEFT in B. Three panels do NOT cover the entire surrounding scene: a formerly visible object may be outside the new field of view. Absence is not a structural contradiction by itself. Never infer identical optical centers from texture or same room alone. Use visible structural evidence only. No reliable position or motion is available. Do not infer navigation permission, metric distances, compass bearings, or historical object instance identity.";
for (const w of [...new Set(pairs.flat())]) {
	perceptions[w] = await ask(base, 'Inspect this observation independently. Return JSON: {localObserverScope, nearStructures, throughOpeningObjects, openingSideEvidence, uncertainties}. Distinguish nearby activity footprint from distant objects seen through a framed opening. Do not assign a historical Place ID.', [frame(w)]);
	console.log(`perception W${w}`);
}
for (const [a, b] of pairs) {
	const intermediate = temporal ? Array.from({ length: windows[b! - 1].endTick - windows[a! - 1].endTick + 1 }, (_, i) => resolve(dir, "frames", `${String(windows[a! - 1].endTick + i).padStart(4, "0")}.jpg`)) : [];
	const result = await ask(base, `First image is A, second B. ${temporal ? "Remaining images are actual recorded FRONT views in chronological order from A endpoint to B endpoint, inclusive; NOT interpolations. Inspect whether changes can be explained by turning, translation, or a crossing; no action labels are supplied." : ""} Independently extracted descriptions (fallible, verify against images): A=${perceptions[a!]!.raw}; B=${perceptions[b!]!.raw}. Compare observer-centered activity region, allowing heading changes and boundary points in either adjacent region. Open kitchen/dining and sofa-side living may be separate functional scopes, but visible object changes alone do not prove observer relocation. A bed seen remotely through a doorway must not authorize merging with bed-adjacent observation. Return JSON {relation:"same"|"different"|"unknown", confidence:"low"|"medium"|"high", observerSideEvidence:[], sharedRemoteContext:[], contradictions:[], reason}. Abstain if observer-side structure cannot settle the relation.`, [frame(a!), frame(b!), ...intermediate]);
	results.push({ a: `observation-${a}`, b: `observation-${b}`, ...result });
	console.log(`pair ${a}/${b}: ${JSON.stringify(result.parsed)}`);
}
await writeFile(resolve(output), JSON.stringify({ note: "Development-selected structural VLM diagnostics only. No evaluation labels/GT/old memberships sent. No automatic acceptance or production mutation. Confidence is uncalibrated self-report. Single trial, not independent accuracy.", temporal, perceptions, results }, null, 2), { flag: "wx" });
