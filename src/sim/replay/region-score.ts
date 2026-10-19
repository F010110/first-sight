import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateRegions, type RegionJudgment } from "../../agent/region-evaluation.js";
const [predictionPath, labelPath, outputPath, experiment = "review-evidence"] = process.argv.slice(2);
if (!predictionPath || !labelPath || !outputPath) throw new Error("Usage: region-score prediction.json judgments.json output.json [experiment-name]");
const data = JSON.parse(await readFile(resolve(predictionPath), "utf8"));
const labels = JSON.parse(await readFile(resolve(labelPath), "utf8")) as { protocol: string; split: string; blind: boolean; judgments: RegionJudgment[] };
if (!labels.protocol || !labels.split || typeof labels.blind !== "boolean" || !Array.isArray(labels.judgments)) throw new Error("Judgment file requires protocol, split, blind and judgments");
const prediction = data.experiments ? data.experiments.find((row: { name: string }) => row.name === experiment) : data;
if (!prediction) throw new Error(`Experiment missing: ${experiment}`);
const result = { protocol: labels.protocol, split: labels.split, blind: labels.blind, warning: labels.blind ? "Pair judgments are not a complete region partition ground truth; inspect all groups and transitions too." : "Non-blind/development judgments: diagnostic only, not independent test accuracy.", ...evaluateRegions(prediction, labels.judgments) };
// Exclusive creation protects archived results and prevents input overwrite.
await writeFile(resolve(outputPath), JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify(result.summary, null, 2));
