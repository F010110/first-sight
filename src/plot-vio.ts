/**
 * VIO trajectory report from a `/vio` probe burst.
 *
 * Replays the on-device pipeline offline: blockFlow -> summarizeFlow -> the same
 * fusion (`fuseMotion`) the phone uses. Two paths are drawn:
 *   - PDR path: built from the fusion's own coherent segments (turn by the
 *     measured yaw during turns, step along the segment direction while moving).
 *     This is robust to the slow heading bias of `deviceorientation.alpha`.
 *   - raw flow path: integrate the per-frame residual translation (camera frame)
 *     without any heading correction, so the bias is visible for comparison.
 *
 * Monocular flow cannot recover metric scale, so paths are in relative units; the
 * point is to judge shape/direction/rotation against what actually happened.
 *
 * Usage:
 *   node dist/plot-vio.js                 # newest vio-debug burst
 *   node dist/plot-vio.js --dir <id>
 *   node dist/plot-vio.js --burst <path> --out run/analysis/vio.html
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const experimentRoot = resolve(process.env.VLM_EXPERIMENT_ROOT || "run/experiments");
const VIO_DEBUG = resolve(experimentRoot, "vio-debug");

interface FlowVector { x: number; y: number; dx: number; dy: number; sad: number }
interface FlowSummary { globalDx: number; globalDy: number; expansion: number; coherent: number; fracAtEdge: number; sad: number; count: number }
interface FlowModule {
	blockFlow: (prev: Uint8ClampedArray, cur: Uint8ClampedArray, width: number, height: number, options?: { block?: number; step?: number; search?: number }) => FlowVector[];
	summarizeFlow: (vectors: FlowVector[], width: number, height: number, search?: number) => FlowSummary;
	grayVariance: (gray: Uint8ClampedArray) => number;
}
interface Feature { t: number; expansion: number; globalDx: number; globalDy: number; dYaw: number; edge: number }
interface Segment { kind: string; direction: string | null; netDeg: number | null; magnitude: string | null; confidence: string; start: number; end: number }
interface FusionModule {
	fuseMotion: (features: Feature[], options?: Record<string, unknown>) => Segment[];
	describeMotion: (segments: Segment[]) => string;
}

const GW = 160;
const GH = 120;
const SEARCH = 10;
const FOCAL_PX = 140;
/** Arbitrary relative units per second for the PDR path (scale is not metric). */
const BUCKET = { slow: 0.5, moderate: 1.1, fast: 1.8 } as Record<string, number>;
const KIND = { still: 0, turn: 1, move: 2 } as Record<string, number>;

function wrapDegrees(value: number): number { return ((value + 180) % 360 + 360) % 360 - 180; }
function rad(deg: number): number { return (deg * Math.PI) / 180; }

interface Burst { width: number; height: number; fps: number; frames: string[]; imu: Array<{ t: number; alpha: number | null; beta: number | null; gamma: number | null; rate: unknown }> }

async function newestBurst(): Promise<string | null> {
	if (!existsSync(VIO_DEBUG)) return null;
	const dirs = (await readdir(VIO_DEBUG, { withFileTypes: true })).filter((entry) => entry.isDirectory());
	let best: { path: string; mtimeMs: number } | null = null;
	const { stat } = await import("node:fs/promises");
	for (const dir of dirs) {
		const path = resolve(VIO_DEBUG, dir.name, "burst.json");
		if (!existsSync(path)) continue;
		const info = await stat(path);
		if (!best || info.mtimeMs > best.mtimeMs) best = { path, mtimeMs: info.mtimeMs };
	}
	return best?.path ?? null;
}

interface VioReport {
	id: string;
	frameCount: number;
	durationMs: number;
	description: string;
	segments: Segment[];
	stats: {
		turnDeg: number;
		moveUnits: number;
		stillFraction: number;
		saturatedFraction: number;
		meanVariance: number;
		rawCamX: number;
		rawCamY: number;
	};
	/** PDR path: [tMs, x, y, headingDeg, kindIndex] */
	path: Array<[number, number, number, number, number]>;
	/** Raw camera-frame integration: [tMs, x, y] */
	cam: Array<[number, number, number]>;
	/** Per-frame series: [tMs, expansion, residX, yawRawDeg, edge, variance] */
	series: Array<[number, number, number, number, number, number]>;
}

async function buildReport(burst: Burst, id: string): Promise<VioReport> {
	const flow = (await import(pathToFileURL(resolve("web", "vio-flow.js")).href)) as unknown as FlowModule;
	const fusion = (await import(pathToFileURL(resolve("web", "motion-fusion.js")).href)) as unknown as FusionModule;

	const frames = burst.frames.map((b64) => new Uint8ClampedArray(Buffer.from(b64, "base64")));
	const imu = burst.imu;
	const features: Feature[] = [];
	const series: VioReport["series"] = [];

	for (let i = 1; i < frames.length; i++) {
		const vectors = flow.blockFlow(frames[i - 1]!, frames[i]!, GW, GH, { block: 16, step: 16, search: SEARCH });
		const summary = flow.summarizeFlow(vectors, GW, GH, SEARCH);
		const variance = flow.grayVariance(frames[i]!);
		const a0 = imu[i - 1]!.alpha, a1 = imu[i]!.alpha;
		const dYaw = a0 !== null && a1 !== null ? wrapDegrees(a1 - a0) : 0;
		const residX = summary.globalDx - FOCAL_PX * rad(dYaw);
		const t = (imu[i]!.t - imu[0]!.t) / 1000;
		features.push({ t, expansion: summary.expansion, globalDx: summary.globalDx, globalDy: summary.globalDy, dYaw, edge: summary.fracAtEdge });
		series.push([imu[i]!.t - imu[0]!.t, summary.expansion, residX, 0, summary.fracAtEdge, variance]);
	}

	const segments = fusion.fuseMotion(features);
	const description = fusion.describeMotion(segments);

	// PDR: turn by the measured yaw only while a turn segment is active; step only
	// while a move segment is active. This suppresses the slow heading bias.
	const segmentAt = (t: number): Segment | null => segments.find((s) => t >= s.start && (t < s.end || s === segments[segments.length - 1])) ?? null;
	let heading = 0, x = 0, y = 0, prevT = 0;
	const path: VioReport["path"] = [[0, 0, 0, 0, KIND.still ?? 0]];
	let turnDeg = 0, moveUnits = 0;
	let currentSegment: Segment | null = null;
	for (const f of features) {
		const segment = segmentAt(f.t);
		const dt = Math.max(0, f.t - prevT);
		prevT = f.t;
		let kind = KIND.still!;
		// Apply a turn once, using the fusion's own coherent netDeg.
		if (segment !== currentSegment) {
			if (segment?.kind === "turn") {
				heading += segment.netDeg ?? 0;
				turnDeg += segment.netDeg ?? 0;
			}
			currentSegment = segment;
		}
		if (segment?.kind === "turn") {
			kind = KIND.turn!;
		} else if (segment?.kind === "move") {
			kind = KIND.move!;
			const length = (BUCKET[segment.magnitude ?? "slow"] ?? 0.5) * dt;
			const forwardUnit = [-Math.sin(rad(heading)), Math.cos(rad(heading))];
			const rightUnit = [Math.cos(rad(heading)), Math.sin(rad(heading))];
			let dir: "forward" | "backward" | "left" | "right";
			if (segment.direction === "forward" || segment.direction === "backward" || segment.direction === "left" || segment.direction === "right") dir = segment.direction;
			else dir = Math.abs(f.expansion) >= Math.abs(f.globalDx) ? (f.expansion >= 0 ? "forward" : "backward") : f.globalDx >= 0 ? "right" : "left";
			if (dir === "forward") { x += forwardUnit[0]! * length; y += forwardUnit[1]! * length; }
			else if (dir === "backward") { x -= forwardUnit[0]! * length; y -= forwardUnit[1]! * length; }
			else if (dir === "left") { x -= rightUnit[0]! * length; y -= rightUnit[1]! * length; }
			else { x += rightUnit[0]! * length; y += rightUnit[1]! * length; }
			moveUnits += length;
		}
		path.push([f.t * 1000, x, y, heading, kind]);
	}

	// Raw camera-frame integration for comparison (no heading correction).
	let camX = 0, camY = 0, yawRaw = 0;
	const cam: VioReport["cam"] = [[0, 0, 0]];
	series[0]![3] = 0;
	for (let i = 0; i < features.length; i++) {
		const f = features[i]!;
		yawRaw += f.dYaw;
		camX += series[i]![2]!;
		camY += f.expansion;
		cam.push([features[i]!.t * 1000, camX, camY]);
		series[i]![3] = yawRaw;
	}

	const edgeValues = features.map((f) => f.edge);
	const varianceValues = series.map((s) => s[5]);
	const stillMs = segments.filter((s) => s.kind === "still").reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0) * 1000;
	const durationMs = features.length ? features[features.length - 1]!.t * 1000 : 0;

	return {
		id,
		frameCount: frames.length,
		durationMs,
		description,
		segments,
		stats: {
			turnDeg,
			moveUnits,
			stillFraction: durationMs > 0 ? Math.min(1, stillMs / durationMs) : 0,
			saturatedFraction: edgeValues.filter((v) => v > 0.4).length / Math.max(1, edgeValues.length),
			meanVariance: varianceValues.length ? varianceValues.reduce((a, b) => a + b, 0) / varianceValues.length : 0,
			rawCamX: camX,
			rawCamY: camY,
		},
		path,
		cam,
		series,
	};
}

function renderHtml(report: VioReport): string {
	const data = JSON.stringify(report).replace(/</g, "\\u003c");
	const segRows = report.segments.map((s) => `<tr><td>${s.kind}</td><td>${s.direction ?? "-"}</td><td>${s.netDeg ?? "-"}</td><td>${s.magnitude ?? "-"}</td><td>${s.confidence}</td><td>${s.start.toFixed(1)}–${s.end.toFixed(1)}s</td></tr>`).join("");
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VIO 轨迹 · ${report.id.slice(0, 8)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 18px; background: #0b1220; color: #e5eaf3; font: 14px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  h1 { font-size: 19px; margin: 0 0 4px; } h3 { font-size: 14px; margin: 14px 0 6px; color: #9fb0c9; }
  .muted { color: #8ea0ba; margin: 0 0 14px; }
  .panels { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-start; }
  .panel { background: #0f1829; border: 1px solid #22304a; border-radius: 13px; padding: 12px; }
  canvas { width: 100%; max-width: 680px; height: auto; display: block; background: #0a1220; border-radius: 9px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin: 12px 0; }
  .stat { background: #0f1829; border: 1px solid #22304a; border-radius: 10px; padding: 9px 11px; }
  .stat b { display: block; font-size: 15px; } .stat span { color: #8ea0ba; font-size: 12px; }
  table { border-collapse: collapse; font-size: 12px; } td, th { border: 1px solid #22304a; padding: 4px 8px; }
  .desc { background: #0f1829; border: 1px solid #22304a; border-radius: 10px; padding: 10px; margin: 10px 0; }
  .legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: #9fb0c9; margin-top: 8px; }
  .legend i { display: inline-block; width: 12px; height: 3px; vertical-align: middle; margin-right: 5px; }
</style>
</head>
<body>
<h1>VIO 轨迹（光流 + 陀螺仪）</h1>
<p class="muted">单目无法恢复真实尺度，路径为<b>相对单位</b>。主路径（融合分段/PDR）是算法根据自己的动作分段重建的；对照你实际的动作判断形状/方向/旋转。</p>
<div class="stats" id="stats"></div>
<div class="desc"><b>融合算法给出的动作描述：</b><br>${report.description}</div>
<div class="panels">
  <div class="panel">
    <h3>俯视轨迹</h3>
    <canvas id="xy" width="680" height="680"></canvas>
    <div class="legend">
      <label><input type="radio" name="frame" value="pdr" checked> 融合分段路径(PDR)</label>
      <label><input type="radio" name="frame" value="cam"> 原始光流积分</label>
      <span><i style="background:#64748b"></i>静止</span><span><i style="background:#a78bfa"></i>转身</span><span><i style="background:#38bdf8"></i>移动</span>
    </div>
  </div>
  <div class="panel">
    <h3>逐帧特征</h3>
    <canvas id="ts" width="680" height="400"></canvas>
    <div class="legend"><span><i style="background:#38bdf8"></i>expansion(前进)</span><span><i style="background:#f59e0b"></i>residX(横向)</span><span><i style="background:#a78bfa"></i>yaw累计(°)</span><span><i style="background:#ef4444"></i>edge(饱和)</span></div>
    <h3>融合分段</h3>
    <table><thead><tr><th>kind</th><th>dir</th><th>net°</th><th>mag</th><th>conf</th><th>时间</th></tr></thead><tbody>${segRows || "<tr><td colspan='6'>无</td></tr>"}</tbody></table>
  </div>
</div>
<script id="payload" type="application/json">${data}</script>
<script>
(function () {
  var R = JSON.parse(document.getElementById("payload").textContent);
  var xy = document.getElementById("xy"), ts = document.getElementById("ts"), stats = document.getElementById("stats");
  var mode = "pdr";
  var KCOLOR = ["#64748b", "#a78bfa", "#38bdf8"];

  stats.innerHTML = [
    st(R.frameCount + " 帧", "帧数"), st((R.durationMs / 1000).toFixed(1) + " s", "时长"),
    st(R.stats.turnDeg.toFixed(0) + "°", "转身合计"),
    st(R.stats.moveUnits.toFixed(1), "移动量(相对)"),
    st((R.stats.stillFraction * 100).toFixed(0) + "%", "静止占比"),
    st(R.stats.saturatedFraction.toFixed(2), "饱和帧比例"),
    st(R.stats.meanVariance.toFixed(0), "平均纹理方差"),
    st(R.segments.filter(function (s) { return s.kind === "turn"; }).length + "", "转身次数"),
  ].join("");
  function st(v, l) { return "<div class='stat'><b>" + v + "</b><span>" + l + "</span></div>"; }

  function draw() {
    var ctx = xy.getContext("2d"), W = xy.width, H = xy.height;
    ctx.clearRect(0, 0, W, H);
    var P = mode === "pdr" ? R.path.map(function (p) { return [p[1], p[2], p[4]]; }) : R.cam.map(function (p) { return [p[1], p[2], 0]; });
    var xs = P.map(function (p) { return p[0]; }), ys = P.map(function (p) { return p[1]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    var span = Math.max(maxX - minX, maxY - minY, 1) * 1.3;
    var scale = (Math.min(W, H) * 0.9) / span;
    function mx(v) { return W / 2 + (v - cx) * scale; }
    function my(v) { return H / 2 - (v - cy) * scale; }
    ctx.strokeStyle = "#1c2942"; ctx.lineWidth = 1;
    for (var g = -span / 2; g <= span / 2; g += span / 8) {
      ctx.beginPath(); ctx.moveTo(mx(cx + g), 0); ctx.lineTo(mx(cx + g), H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, my(cy + g)); ctx.lineTo(W, my(cy + g)); ctx.stroke();
    }
    ctx.lineWidth = 3; ctx.lineCap = "round";
    for (var i = 1; i < P.length; i++) {
      var a = P[i - 1], p = P[i];
      ctx.strokeStyle = mode === "pdr" ? KCOLOR[p[2]] : "#38bdf8";
      ctx.globalAlpha = mode === "pdr" ? 0.95 : 0.7;
      ctx.beginPath(); ctx.moveTo(mx(a[0]), my(a[1])); ctx.lineTo(mx(p[0]), my(p[1])); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    dot(mx(P[0][0]), my(P[0][1]), "#22c55e", "S");
    var e2 = P[P.length - 1]; dot(mx(e2[0]), my(e2[1]), "#ef4444", "E");
    function dot(x, y, c, t) { ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); ctx.fillStyle = "#06121f"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t, x, y); ctx.textAlign = "start"; ctx.textBaseline = "alphabetic"; }
  }

  function drawTs() {
    var ctx = ts.getContext("2d"), W = ts.width, H = ts.height, pad = 36;
    ctx.clearRect(0, 0, W, H);
    var S = R.series;
    var t0 = S[0][0], t1 = S[S.length - 1][0], dt = Math.max(1, t1 - t0);
    var maxV = 1; S.forEach(function (p) { maxV = Math.max(maxV, Math.abs(p[1]), Math.abs(p[2]), Math.abs(p[3])); });
    function px(t) { return pad + ((t - t0) / dt) * (W - pad - 10); }
    function py(v) { return 10 + (H - 40) - (Math.abs(v) / maxV) * (H - 50); }
    ctx.strokeStyle = "#1c2942"; for (var g = 0; g <= 4; g++) { var yy = 10 + ((H - 40) / 4) * g; ctx.beginPath(); ctx.moveTo(pad, yy); ctx.lineTo(W - 10, yy); ctx.stroke(); }
    ctx.fillStyle = "rgba(239,68,68,0.16)";
    S.forEach(function (p, i) { var X = px(p[0]), Y = 10 + (H - 40) * (1 - p[4]); if (i === 0) ctx.moveTo(X, 10 + (H - 40)); ctx.lineTo(X, Y); });
    ctx.lineTo(px(t1), 10 + (H - 40)); ctx.closePath(); ctx.fill();
    line(1, "#38bdf8"); line(2, "#f59e0b"); line(3, "#a78bfa");
    function line(idx, color) { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); S.forEach(function (p, i) { var X = px(p[0]), Y = py(p[idx]); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }); ctx.stroke(); }
    ctx.fillStyle = "#5b6d87"; ctx.font = "11px sans-serif"; ctx.fillText(maxV.toFixed(0), 4, 18); ctx.fillText("0", 4, 10 + (H - 40));
  }

  document.querySelectorAll("input[name=frame]").forEach(function (r) { r.addEventListener("change", function () { mode = r.value; draw(); }); });
  draw(); drawTs();
})();
</script>
</body>
</html>`;
}

function parseArgs(argv: string[]): { dir?: string; burst?: string; out?: string } {
	const args: { dir?: string; burst?: string; out?: string } = {};
	for (let i = 0; i < argv.length; i += 1) {
		const value = argv[i]!;
		const next = argv[i + 1];
		if (value === "--dir" && next !== undefined) { args.dir = next; i += 1; }
		else if (value === "--burst" && next !== undefined) { args.burst = next; i += 1; }
		else if (value === "--out" && next !== undefined) { args.out = next; i += 1; }
	}
	return args;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const burstPath = args.burst ? resolve(args.burst) : args.dir ? resolve(VIO_DEBUG, args.dir, "burst.json") : await newestBurst();
	if (!burstPath || !existsSync(burstPath)) throw new Error(`没有找到 burst.json（${VIO_DEBUG}）`);
	const id = burstPath.includes("vio-debug") ? (burstPath.split(/[\\/]/).slice(-2)[0] ?? "burst") : "burst";
	const burst = JSON.parse(await readFile(burstPath, "utf8")) as Burst;
	const report = await buildReport(burst, id);
	const out = args.out ? resolve(args.out) : resolve("run", "analysis", `vio-${id}.html`);
	await mkdir(dirname(out), { recursive: true });
	await writeFile(out, renderHtml(report), "utf8");
	console.log(`burst: ${burstPath}`);
	console.log(`帧数 ${report.frameCount}, 时长 ${(report.durationMs / 1000).toFixed(1)}s, 饱和帧 ${(report.stats.saturatedFraction * 100).toFixed(0)}%, 静止 ${(report.stats.stillFraction * 100).toFixed(0)}%`);
	console.log(`描述: ${report.description}`);
	const last = report.path[report.path.length - 1]!;
	console.log(`PDR 终点 (${last[1].toFixed(1)},${last[2].toFixed(1)}) 朝向 ${last[3].toFixed(0)}°, 转身合计 ${report.stats.turnDeg.toFixed(0)}°, 移动量 ${report.stats.moveUnits.toFixed(1)}`);
	console.log(`原始光流终点 (${report.stats.rawCamX.toFixed(0)},${report.stats.rawCamY.toFixed(0)})`);
	console.log(`报告: ${out}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
