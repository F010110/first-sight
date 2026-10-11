/** Evaluation runs separately after inference; labels never enter verifier. */
import { readFile, writeFile } from "node:fs/promises";
import { evaluateRegionCores } from "../agent/region-core-evaluation.js";
import { evaluateRegions } from "../agent/region-evaluation.js";
const [predictionPath, labelsPath, output] = process.argv.slice(2);
if (!predictionPath || !labelsPath || !output) throw new Error("Usage: region-verifier-score verifier-eval labels output");
const prediction = JSON.parse(await readFile(predictionPath, "utf8"));
const labels = JSON.parse(await readFile(labelsPath, "utf8"));
const score = (partition: any) => Array.isArray(labels.labels) ? evaluateRegionCores(partition, labels.labels) : evaluateRegions(partition, labels.judgments);
const baseline = score(prediction.baseline), revised = score(prediction.revised);
await writeFile(output, JSON.stringify({ note: "Two-development-house diagnostic, not independent accuracy; visual identity nodes are not activity-region partitions. Compare veto benefits with coverage loss and new false splits.", labelsMetadata: { protocol: labels.protocol, blind: labels.blind, split: labels.split }, verifierSummary: prediction.summary, baseline, revised }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ verifierSummary: prediction.summary, baseline: baseline.summary, revised: revised.summary }, null, 2));
