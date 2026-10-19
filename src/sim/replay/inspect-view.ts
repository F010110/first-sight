/** Isolate visual perception from place-memory suggestions; no poses/GT are sent. */
import { readFile, writeFile } from "node:fs/promises";
import { Agent } from "@earendil-works/pi-agent-core";
import { createQwenModel } from "../../agent/qwen-provider.js";

const path = process.argv[2];
if (!path) throw new Error("usage: node dist/current/sim/replay/inspect-view.js <triptych.jpg> [output.json]");
const configured = createQwenModel(1024);
const agent = new Agent({ initialState: { model: configured.model, tools: [], systemPrompt: "Independently inspect the supplied current image. There is NO previous place, candidate memory or motion input. The LEFT/FRONT/RIGHT panels are views from one optical center in a static scene, labeled by relative bearing. Describe only visible evidence; do not invent objects or camera relationships." }, streamFn: configured.streamFn });
await agent.prompt("Return JSON with left, front, right (visible objects/surfaces in each), observerPositionEvidence (only supported qualitative relations), uncertainties. Do not identify a historical place or infer motion.", [{ type: "image", data: (await readFile(path)).toString("base64"), mimeType: "image/jpeg" }]);
if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
const message = [...agent.state.messages].reverse().find(item => item.role === "assistant");
if (!message || message.role !== "assistant") throw new Error("No visual response");
const raw = message.content.filter(block => block.type === "text").map(block => block.text).join("\n");
console.log(raw);
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify({ image: path, condition: "current image only, no history/GT/motion", raw }, null, 2));
