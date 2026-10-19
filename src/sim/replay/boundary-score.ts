import { readFile, writeFile } from "node:fs/promises";
import { scoreTransitions } from "../../agent/region-event-evaluation.js";
const [truthPath, predictionPath, output] = process.argv.slice(2);
if (!truthPath || !predictionPath || !output) throw new Error("Usage: boundary-score oracle-truth predicted-candidates output");
const truth = JSON.parse(await readFile(truthPath, "utf8")), prediction = JSON.parse(await readFile(predictionPath, "utf8"));
if (truth.protocol !== "boundary-events-v1" || !truth.reviewed || prediction.protocol !== "boundary-events-v1") throw new Error("Invalid event annotations");
const predicted = prediction.boundaries.map((event: { id: string; beforeObservationId: string }) => ({ id: event.id, atMs: Number(event.beforeObservationId.split("-").at(-1)) * 1000 }));
const result = { note: "One-to-one event diagnostic at synthetic one-second tick timing. AI-reviewed polygon-suggested transitions only; not a complete boundary ground truth. Does not evaluate navigation.", condition: prediction.condition, ...scoreTransitions(truth.transitionIntervals, predicted, 3000) };
await writeFile(output, JSON.stringify(result, null, 2), { flag: "wx" }); console.log(JSON.stringify(result, null, 2));
