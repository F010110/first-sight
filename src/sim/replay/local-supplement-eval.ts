import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { supplementLocalEvidence } from "../../agent/local-evidence-supplement.js";
const [directory, output] = process.argv.slice(2);
if (!directory || !output) throw new Error("Usage: local-supplement-eval dataset output");
const dir = resolve(directory);
const original = JSON.parse(await readFile(resolve(dir, "vlm-verifier-all-eval.json"), "utf8"));
const geometry = JSON.parse(await readFile(resolve(dir, "local-rotation-evidence.json"), "utf8"));
await writeFile(output, JSON.stringify({ note: "No VLM decisions used: baseline member field only. Positive geometry supplement is derived and nonmutating, not replacement.", baseline: supplementLocalEvidence(original.baseline, geometry.pairs) }, null, 2), { flag: "wx" });
