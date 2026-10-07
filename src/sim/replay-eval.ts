/**
 * Simulator replay evaluator.
 *
 * Replays a recorded AI2-THOR/ProcTHOR episode through the place-recognition
 * pipeline and scores it against ground-truth rooms:
 *   - place accuracy / purity            (does recognition group rooms correctly?)
 *   - revisit consistency                (do repeat visits land on one place?)
 *   - transition connectivity P/R/F1     (does the learned graph match room adjacency?)
 *
 * Modes:
 *   --mode cheap   cheap CV only (SIFT inliers vs candidates), no VLM  [default]
 *   --mode vlm     the real SceneAgent (Qwen) — slow; use --limit
 * Motion fed to the pipeline: --motion none | perfect | noisy
 *
 * Usage:
 *   node dist/sim/replay-eval.js run/sim/<episode> [--mode cheap] [--motion perfect]
 */

import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PlaceMemory } from "../agent/place-memory.js";
import { matchImages } from "../agent/image-match.js";
import { parseMotionHint } from "../agent/motion-hint.js";
import { SceneAgent } from "../agent/scene-agent.js";
import type { FrameRef } from "../agent/types.js";

interface WindowRow {
	window: number;
	startTick: number;
	endTick: number;
	frame: string;
	room: string;
	motionPerfect: string;
	motionNoisy: string;
}

interface Observation { gt: string; pred: string; motion: string | null; }

const CLEAR_MATCH_INLIERS = 15;
const MAX_CANDIDATES = 5;
const REPS_PER_CANDIDATE = 3;

function parseArgs(argv: string[]) {
	const args: { episode?: string; mode: "cheap" | "vlm"; motion: "none" | "perfect" | "noisy"; limit: number; out?: string } = {
		mode: "cheap", motion: "perfect", limit: 0,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const value = argv[i]!;
		const next = argv[i + 1];
		if (value === "--mode" && next) { args.mode = next as "cheap" | "vlm"; i += 1; }
		else if (value === "--motion" && next) { args.motion = next as "none" | "perfect" | "noisy"; i += 1; }
		else if (value === "--limit" && next) { args.limit = Number(next); i += 1; }
		else if (value === "--out" && next) { args.out = next; i += 1; }
		else if (!value.startsWith("--") && !args.episode) args.episode = value;
	}
	return args;
}

function motionFor(row: WindowRow, mode: "none" | "perfect" | "noisy"): string | null {
	if (mode === "none") return null;
	return mode === "noisy" ? row.motionNoisy : row.motionPerfect;
}

/** Cheap-CV agent: candidate narrowing + SIFT score; no VLM. */
async function runCheap(rows: WindowRow[], dir: string, motion: "none" | "perfect" | "noisy"): Promise<{ observations: Observation[]; prediction: { tries: number; hits: number }; edges: Array<{ from: string; to: string; count: number; path: string }> }> {
	const memory = new PlaceMemory(null);
	const observations: Observation[] = [];
	const sceneRoom = new Map<string, Map<string, number>>();
	let tries = 0;
	let hits = 0;
	for (const row of rows) {
		const framePath = resolve(dir, row.frame);
		const previous = memory.getState().currentSceneId;
		const hint = parseMotionHint(motionFor(row, motion));
		// Does the graph "remember" where this path leads? (evaluated against GT room)
		const expected = memory.expectedNext(previous, hint);
		if (expected.length && expected[0]) {
			tries += 1;
			const rooms = sceneRoom.get(expected[0].sceneId);
			const predictedRoom = rooms ? [...rooms.entries()].sort((a, b) => b[1] - a[1])[0]![0] : null;
			if (predictedRoom && predictedRoom === row.room) hits += 1;
		}
		// Candidate tiers: 1-hop neighbours, then recent, then global fallback.
		const tiered = [
			...expected.map((item) => memory.getScene(item.sceneId)).filter((s): s is NonNullable<typeof s> => Boolean(s)),
			...memory.neighbors(previous).map((n) => memory.getScene(n.sceneId)).filter((s): s is NonNullable<typeof s> => Boolean(s)),
			...memory.candidates(previous, MAX_CANDIDATES),
			...memory.listScenes(),
		];
		const seen = new Set<string>();
		const candidatePaths: Array<{ id: string; path: string }> = [];
		for (const scene of tiered) {
			if (seen.has(scene.id) || candidatePaths.length >= 36) continue;
			seen.add(scene.id);
			for (const rep of scene.frames.slice(-REPS_PER_CANDIDATE)) candidatePaths.push({ id: scene.id, path: rep.path });
		}
		let matchedId: string | null = null;
		if (candidatePaths.length) {
			const response = await matchImages([framePath], candidatePaths, { minInliers: CLEAR_MATCH_INLIERS, maxDim: 640 });
			if (response.ok && response.best) matchedId = response.best.id;
		}
		let sceneId: string;
		if (matchedId && memory.getScene(matchedId)) {
			sceneId = matchedId;
		} else {
			const scene = memory.ensureScene(null, row.room, "", [], Date.now());
			sceneId = scene.id;
		}
		if (!sceneRoom.has(sceneId)) sceneRoom.set(sceneId, new Map());
		const bucket = sceneRoom.get(sceneId)!;
		bucket.set(row.room, (bucket.get(row.room) ?? 0) + 1);
		memory.addRepresentative(sceneId, { id: `rep-${row.window}`, path: framePath });
		await memory.onSceneResolved(sceneId, row.frame, hint, motionFor(row, motion), row.endTick * 1000);
		observations.push({ gt: row.room, pred: sceneId, motion: motionFor(row, motion) });
	}
	const edges = memory.getState().transitions.map((t) => ({ from: t.fromScene, to: t.toScene, count: t.count, path: t.path }));
	return { observations, prediction: { tries, hits }, edges };
}

/** Full VLM agent (real Qwen). */
async function runVlm(rows: WindowRow[], dir: string, motion: "none" | "perfect" | "noisy", limit: number): Promise<{ observations: Observation[]; prediction: { tries: number; hits: number }; edges: Array<{ from: string; to: string; count: number; path: string }> }> {
	const memoryDir = resolve(dir, "_vlm-memory");
	const storePath = resolve(dir, "_vlm-place-memory.json");
	await rm(memoryDir, { recursive: true, force: true });
	await rm(storePath, { force: true });
	const agent = new SceneAgent(memoryDir, storePath);
	await agent.load();
	const observations: Observation[] = [];
	const selected = limit > 0 ? rows.slice(0, limit) : rows;
	for (const row of selected) {
		const frames: FrameRef[] = [];
		for (let tick = row.startTick + 1; tick <= row.endTick; tick += 1) {
			frames.push({ id: `sim-${tick}`, timestampMs: tick * 1000, path: resolve(dir, `frames/${String(tick).padStart(4, "0")}.jpg`) });
		}
		if (frames.length === 0) frames.push({ id: `sim-${row.endTick}`, timestampMs: row.endTick * 1000, path: resolve(dir, row.frame) });
		const result = await agent.observe(frames, motionFor(row, motion));
		observations.push({ gt: row.room, pred: result.sceneId, motion: motionFor(row, motion) });
	}
	const edges = agent.getState().transitions.map((t) => ({ from: t.fromScene, to: t.toScene, count: t.count, path: t.path }));
	return { observations, prediction: { tries: 0, hits: 0 }, edges };
}

function majorityMapping(observations: Observation[]): Map<string, string> {
	const counts = new Map<string, Map<string, number>>();
	for (const { gt, pred } of observations) {
		if (gt === "unknown") continue;
		if (!counts.has(pred)) counts.set(pred, new Map());
		const bucket = counts.get(pred)!;
		bucket.set(gt, (bucket.get(gt) ?? 0) + 1);
	}
	const mapping = new Map<string, string>();
	for (const [pred, bucket] of counts) mapping.set(pred, [...bucket.entries()].sort((a, b) => b[1] - a[1])[0]![0]);
	return mapping;
}

function metrics(observations: Observation[]) {
	const mapping = majorityMapping(observations);
	const valid = observations.filter((o) => o.gt !== "unknown");
	const correct = valid.filter((o) => mapping.get(o.pred) === o.gt).length;
	const accuracy = valid.length ? correct / valid.length : 0;

	// Purity: within each predicted place, share of the most common GT room.
	const byPred = new Map<string, string[]>();
	for (const o of valid) { if (!byPred.has(o.pred)) byPred.set(o.pred, []); byPred.get(o.pred)!.push(o.gt); }
	let puritySum = 0;
	for (const rooms of byPred.values()) {
		const counts = new Map<string, number>();
		for (const room of rooms) counts.set(room, (counts.get(room) ?? 0) + 1);
		puritySum += Math.max(...counts.values());
	}
	const purity = valid.length ? puritySum / valid.length : 0;

	// Revisit consistency: for each GT room, the share of its windows using its dominant predicted place.
	const byRoom = new Map<string, string[]>();
	for (const o of valid) { if (!byRoom.has(o.gt)) byRoom.set(o.gt, []); byRoom.get(o.gt)!.push(o.pred); }
	let revisitSum = 0;
	const roomDetail: Array<{ room: string; windows: number; places: number; dominantShare: number }> = [];
	for (const [room, preds] of byRoom) {
		const counts = new Map<string, number>();
		for (const pred of preds) counts.set(pred, (counts.get(pred) ?? 0) + 1);
		const dominant = Math.max(...counts.values());
		revisitSum += dominant;
		roomDetail.push({ room, windows: preds.length, places: counts.size, dominantShare: Number((dominant / preds.length).toFixed(2)) });
	}
	const revisit = valid.length ? revisitSum / valid.length : 0;

	// Directed transition edges: GT (room->room adjacent) vs predicted (mapped to GT rooms).
	const gtEdges = new Set<string>();
	const predEdges = new Set<string>();
	for (let i = 1; i < observations.length; i += 1) {
		const prev = observations[i - 1]!;
		const cur = observations[i]!;
		if (prev.gt !== cur.gt && prev.gt !== "unknown" && cur.gt !== "unknown") gtEdges.add(`${prev.gt} -> ${cur.gt}`);
		if (prev.pred !== cur.pred) {
			const from = mapping.get(prev.pred) ?? prev.pred;
			const to = mapping.get(cur.pred) ?? cur.pred;
			if (from !== to) predEdges.add(`${from} -> ${to}`);
		}
	}
	const tp = [...predEdges].filter((edge) => gtEdges.has(edge)).length;
	const precision = predEdges.size ? tp / predEdges.size : 0;
	const recall = gtEdges.size ? tp / gtEdges.size : 0;
	const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;

	return {
		windows: observations.length,
		places: byPred.size,
		rooms: byRoom.size,
		accuracy: Number(accuracy.toFixed(3)),
		purity: Number(purity.toFixed(3)),
		revisitConsistency: Number(revisit.toFixed(3)),
		transitions: { gt: gtEdges.size, pred: predEdges.size, tp, precision: Number(precision.toFixed(3)), recall: Number(recall.toFixed(3)), f1: Number(f1.toFixed(3)) },
		gtEdges: [...gtEdges].sort(),
		predEdges: [...predEdges].sort(),
		roomsDetail: roomDetail.sort((a, b) => a.dominantShare - b.dominantShare),
	};
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (!args.episode) throw new Error("usage: node dist/sim/replay-eval.js <episodeDir> [--mode cheap|vlm] [--motion none|perfect|noisy] [--limit N]");
	const dir = resolve(args.episode);
	const windowsPath = resolve(dir, "windows.jsonl");
	if (!existsSync(windowsPath)) throw new Error(`no windows.jsonl in ${dir}; run sim/derive_motion.py first`);
	const rows = (await readFile(windowsPath, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as WindowRow);

	const useRows = args.limit > 0 ? rows.slice(0, args.limit) : rows;
	const result = args.mode === "vlm"
		? await runVlm(useRows, dir, args.motion, 0)
		: await runCheap(useRows, dir, args.motion);
	const graphPrediction = result.prediction.tries ? Number((result.prediction.hits / result.prediction.tries).toFixed(3)) : null;
	const summary = { episode: dir, mode: args.mode, motion: args.motion, ...metrics(result.observations), graphPrediction, learnedEdges: result.edges };

	console.log(`episode: ${dir}`);
	console.log(`mode=${args.mode} motion=${args.motion}`);
	console.log(`windows=${summary.windows} places=${summary.places} rooms=${summary.rooms}`);
	console.log(`place accuracy=${summary.accuracy} purity=${summary.purity} revisit=${summary.revisitConsistency}`);
	console.log(`transitions gt=${summary.transitions.gt} pred=${summary.transitions.pred} P=${summary.transitions.precision} R=${summary.transitions.recall} F1=${summary.transitions.f1}`);
	console.log(`same-path recall (graph expectedNext): ${graphPrediction === null ? "n/a" : `${graphPrediction} (${result.prediction.hits}/${result.prediction.tries})`}`);
	console.log(`GT edges: ${summary.gtEdges.join(", ")}`);
	console.log(`Pred edges: ${summary.predEdges.join(", ")}`);
	console.log("learned edges (usual path):");
	for (const edge of result.edges.slice(0, 10)) console.log(`  ${edge.from} -> ${edge.to}  x${edge.count}  path: ${edge.path}`);
	console.log("rooms (lowest consistency):");
	for (const item of summary.roomsDetail.slice(0, 6)) console.log(`  ${item.room}: windows=${item.windows} places=${item.places} dominant=${item.dominantShare}`);

	const out = args.out ? resolve(args.out) : resolve(dir, `eval-${args.mode}-${args.motion}.json`);
	await writeFile(out, JSON.stringify(summary, null, 2), "utf8");
	console.log(`report: ${out}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
