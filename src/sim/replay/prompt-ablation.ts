/** Targeted prompt diagnostic: no poses, room IDs, or prior generated labels. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { createQwenModel } from "../../agent/qwen-provider.js";
import { SYSTEM_PROMPT } from "../../agent/scene-agent.js";

const dir = resolve(process.argv[2] ?? "run/sim/multiview-val5-clean-20261007");
const rows = (await readFile(resolve(dir, "windows.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line) as { endTick: number });
const configured = createQwenModel(1024);
const results: unknown[] = [];
const minimal = "Compare two first-person observations. Each labeled LEFT/FRONT/RIGHT triptych contains simultaneous views from ONE observer position. A Place is a local standing/activity region, independent of viewing direction. Rotating swaps image directions without changing Place. Facing a different object, an object moving between panels, or an object disappearing from view is NOT evidence of moving to another region. Shared objects alone also do not prove the same region. Examine all panels across directions. Choose same if compatible evidence supports the same region, new only with positive observer-position/boundary change evidence, otherwise unresolved. No exact metric position or room classification is requested. Do not invent unseen anchors.";
for (const [before, after] of [[8, 38], [7, 39]] as const) {
 for (const [condition, systemPrompt] of [["full-neutral-history", SYSTEM_PROMPT], ["minimal-neutral-history", minimal]] as const) {
  const agent = new Agent({ initialState: { model: configured.model, systemPrompt, tools: [] }, streamFn: configured.streamFn });
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let raw = "", error: string | null = null;
  try {
   const image = async (window: number) => ({ type: "image" as const, data: (await readFile(resolve(dir, "triple", `${String(rows[window - 1]!.endTick).padStart(4, "0")}.jpg`))).toString("base64"), mimeType: "image/jpeg" });
   await Promise.race([
    agent.prompt({ role: "user", timestamp: Date.now(), content: [
     { type: "text", text: 'PREVIOUS_PLACE: scene-a, descriptive label unavailable. No stored anchor descriptions. No other candidates. MOTION: unknown; these are separated observations, not a continuous motion window. REFERENCE scene-a:' }, await image(before),
     { type: "text", text: 'CURRENT target observation:' }, await image(after),
     { type: "text", text: 'Return only JSON with decision (same/new/unresolved), seenBeforeSceneId (scene-a for same, null otherwise), place, summary, anchors, localRelations, identityReason, positionMatchEvidence, positionalContradictions, regionChangeEvidence, confidence. Assess observer region, not image orientation.' },
    ] }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => { agent.abort(); reject(new Error("request timed out after 120000ms")); }, 120000); }),
   ]);
   if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
   const response = [...agent.state.messages].reverse().find(message => message.role === "assistant");
   if (response?.role === "assistant") raw = response.content.filter(block => block.type === "text").map(block => block.text).join("\n");
  } catch (cause) { error = String(cause); }
  finally { if (timer) clearTimeout(timer); }
  const result = { model: configured.model.id, before, after, condition, elapsedMs: Date.now() - started, raw, error };
  results.push(result); console.log(JSON.stringify(result));
  await writeFile(resolve(dir, "prompt-ablation.json"), JSON.stringify({ note: "Two targeted reverse-facing returns, one trial per prompt, neutral historical labels, no GT/motion supplied. Diagnostic, not a statistically validated model benchmark.", results }, null, 2));
 }
}
