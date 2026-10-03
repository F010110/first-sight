/**
 * Trajectory report from recorded IMU (calibrated dead-reckoning).
 *
 * The trial server stores the raw IMU rows it uses for motion:
 *   - run/experiments/<session>/live/motion.jsonl   (the whole live session)
 *   - run/experiments/<session>/inputs/<runId>/motion.json  (one observation)
 *
 * This CLI replays `estimateMotionTrajectory` over those rows and writes a
 * self-contained HTML report with a top-down path, speed/path over time and the
 * calibration/summary stats. It also accepts a ground-truth distance so the
 * estimate can be scored directly.
 *
 * Usage:
 *   node dist/plot-trajectory.js                    # newest session
 *   node dist/plot-trajectory.js --session <id>
 *   node dist/plot-trajectory.js --session <id> --run <runId>
 *   node dist/plot-trajectory.js --session <id> --out run/analysis/my.html
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { estimateMotionTrajectory, type CalibrationInfo, type MotionCalibration, type TrajectorySummary } from "./dead-reckoning.js";

const experimentRoot = resolve(process.env.VLM_EXPERIMENT_ROOT || "run/experiments");
const MAX_POINTS_PER_DATASET = 1500;
const MAX_DATASETS = 30;

interface Dataset {
	id: string;
	label: string;
	source: "live" | "run";
	durationMs: number;
	summary: TrajectorySummary;
	calibration: CalibrationInfo;
	/** [tMs, x, y, z, pathM, speedMps, conf(0..2), stationary(0/1)] */
	points: Array<[number, number, number, number, number, number, number, number]>;
}

interface Args {
	session?: string;
	run?: string;
	out?: string;
	allRuns: boolean;
}

function parseArgs(argv: string[]): Args {
	const args: Args = { allRuns: true };
	for (let i = 0; i < argv.length; i += 1) {
		const value = argv[i]!;
		if (value === "--session") { const next = argv[++i]; if (next !== undefined) args.session = next; }
		else if (value === "--run") { const next = argv[++i]; if (next !== undefined) { args.run = next; args.allRuns = false; } }
		else if (value === "--no-runs") args.allRuns = false;
		else if (value === "--out") { const next = argv[++i]; if (next !== undefined) args.out = next; }
		else if (!value.startsWith("--") && !args.session) args.session = value;
	}
	return args;
}

async function newestSession(): Promise<string | null> {
	const entries = await readdir(experimentRoot, { withFileTypes: true });
	const dirs = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("vio-debug"));
	let best: { name: string; mtimeMs: number } | null = null;
	for (const dir of dirs) {
		const path = resolve(experimentRoot, dir.name, "live", "motion.jsonl");
		if (!existsSync(path)) continue;
		const { stat } = await import("node:fs/promises");
		const info = await stat(path);
		if (!best || info.mtimeMs > best.mtimeMs) best = { name: dir.name, mtimeMs: info.mtimeMs };
	}
	return best?.name ?? null;
}

function normalizeRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
	return rows
		.map((row) => {
			const timeMs = typeof row.timeMs === "number" ? row.timeMs : typeof row.timestampMs === "number" ? row.timestampMs : null;
			return timeMs === null ? row : { ...row, timeMs };
		})
		.sort((a, b) => Number(a.timeMs) - Number(b.timeMs));
}

async function readJsonl(path: string): Promise<Array<Record<string, unknown>>> {
	if (!existsSync(path)) return [];
	const text = await readFile(path, "utf8");
	return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function confIndex(confidence: string): number {
	return confidence === "high" ? 2 : confidence === "medium" ? 1 : 0;
}

function downsample(points: Dataset["points"]): Dataset["points"] {
	if (points.length <= MAX_POINTS_PER_DATASET) return points;
	const stride = Math.ceil(points.length / MAX_POINTS_PER_DATASET);
	const sampled: Dataset["points"] = [];
	for (let i = 0; i < points.length; i += stride) sampled.push(points[i]!);
	if (sampled[sampled.length - 1] !== points[points.length - 1]) sampled.push(points[points.length - 1]!);
	return sampled;
}

function buildDataset(id: string, label: string, source: Dataset["source"], rows: Array<Record<string, unknown>>, calibration?: MotionCalibration): Dataset | null {
	if (rows.length < 5) return null;
	const trajectory = estimateMotionTrajectory(rows, calibration ? { calibration } : undefined);
	if (trajectory.points.length === 0) return null;
	const points: Dataset["points"] = trajectory.points.map((point) => [
		point.timeMs,
		Number(point.positionM.x.toFixed(3)),
		Number(point.positionM.y.toFixed(3)),
		Number(point.positionM.z.toFixed(3)),
		Number(point.pathLengthM.toFixed(3)),
		Number(point.speedMps.toFixed(3)),
		confIndex(point.confidence),
		point.stationary ? 1 : 0,
	]);
	const durationMs = points.length ? points[points.length - 1]![0] - points[0]![0] : 0;
	return { id, label, source, durationMs, summary: trajectory.summary, calibration: trajectory.calibration, points: downsample(points) };
}

interface RunMeta { caseId: string; startedAt: string; goal: string | null; attentionMode: string | null }

async function readRunMeta(sessionDir: string): Promise<Map<string, RunMeta>> {
	const map = new Map<string, RunMeta>();
	const path = join(sessionDir, "runs.jsonl");
	if (!existsSync(path)) return map;
	const rows = await readJsonl(path);
	for (const row of rows) {
		const runId = typeof row.runId === "string" ? row.runId : null;
		if (!runId) continue;
		const input = (row.input ?? {}) as Record<string, unknown>;
		map.set(runId, {
			caseId: typeof row.caseId === "string" ? row.caseId : "",
			startedAt: typeof row.startedAt === "string" ? row.startedAt : "",
			goal: typeof input.goal === "string" ? input.goal : null,
			attentionMode: typeof input.attentionMode === "string" ? input.attentionMode : null,
		});
	}
	return map;
}

async function collectDatasets(sessionDir: string, args: Args): Promise<Dataset[]> {
	const datasets: Dataset[] = [];
	const meta = await readRunMeta(sessionDir);

	// Whole live session. Use the stored session calibration from the earliest run
	// when present, so the live plot matches what the server saw.
	const liveRows = normalizeRows(await readJsonl(join(sessionDir, "live", "motion.jsonl")));
	const runIds = (await readdir(join(sessionDir, "inputs"), { withFileTypes: true }).catch(() => []))
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
	const orderedRuns = runIds
		.map((runId) => ({ runId, meta: meta.get(runId) }))
		.sort((a, b) => (a.meta?.startedAt ?? "").localeCompare(b.meta?.startedAt ?? ""));
	let liveCalibration: MotionCalibration | undefined;
	for (const { runId } of orderedRuns) {
		const parsed = await readRunMotion(sessionDir, runId);
		if (parsed?.calibration) { liveCalibration = parsed.calibration; break; }
	}
	if (liveRows.length) {
		const dataset = buildDataset("live", "整段 live 录制", "live", liveRows, liveCalibration);
		if (dataset) datasets.push(dataset);
	}

	// Per-observation windows.
	const selected = args.run ? orderedRuns.filter((entry) => entry.runId === args.run) : args.allRuns ? orderedRuns : [];
	for (const { runId, meta: runMeta } of selected) {
		const parsed = await readRunMotion(sessionDir, runId);
		if (!parsed) continue;
		const time = runMeta?.startedAt ? runMeta.startedAt.slice(11, 19) : "";
		const goal = runMeta?.goal ? ` · ${runMeta.goal}` : runMeta?.attentionMode ? ` · ${runMeta.attentionMode}` : "";
		const dataset = buildDataset(runId, `片段 ${runId.slice(0, 8)} ${time}${goal}`, "run", normalizeRows(parsed.samples), parsed.calibration ?? undefined);
		if (dataset) datasets.push(dataset);
	}
	return datasets.slice(0, MAX_DATASETS);
}

async function readRunMotion(sessionDir: string, runId: string): Promise<{ calibration: MotionCalibration | null; samples: Array<Record<string, unknown>> } | null> {
	const path = join(sessionDir, "inputs", runId, "motion.json");
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(await readFile(path, "utf8")) as { calibration?: MotionCalibration | null; samples?: Array<Record<string, unknown>> };
		const samples = Array.isArray(parsed.samples) ? parsed.samples : [];
		return { calibration: parsed.calibration ?? null, samples };
	} catch {
		return null;
	}
}

function renderHtml(sessionId: string, datasets: Dataset[]): string {
	const data = JSON.stringify({ sessionId, datasets }).replace(/</g, "\\u003c");
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>运动轨迹 · ${sessionId.slice(0, 8)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 18px; background: #0b1220; color: #e5eaf3; font: 14px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  h1 { font-size: 19px; margin: 0 0 4px; }
  h3 { font-size: 14px; margin: 14px 0 6px; color: #9fb0c9; }
  .muted { color: #8ea0ba; margin: 0 0 14px; }
  .row { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin-bottom: 12px; }
  select, input { background: #121d31; color: #e5eaf3; border: 1px solid #2f4058; border-radius: 9px; padding: 8px 10px; font: inherit; }
  .panels { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-start; }
  .panel { background: #0f1829; border: 1px solid #22304a; border-radius: 13px; padding: 12px; }
  canvas { width: 100%; max-width: 720px; height: auto; display: block; background: #0a1220; border-radius: 9px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 8px; margin: 12px 0; }
  .stat { background: #0f1829; border: 1px solid #22304a; border-radius: 10px; padding: 9px 11px; }
  .stat b { display: block; font-size: 16px; }
  .stat span { color: #8ea0ba; font-size: 12px; }
  .notes { color: #9fb0c9; font-size: 12px; margin-top: 8px; }
  .legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: #9fb0c9; margin-top: 8px; }
  .legend i { display: inline-block; width: 12px; height: 3px; vertical-align: middle; margin-right: 5px; }
  #truth-result { margin-top: 8px; font-size: 13px; }
  .good { color: #22c55e; } .warn { color: #f59e0b; } .bad { color: #ef4444; }
</style>
</head>
<body>
<h1>运动轨迹（IMU 航位推算 / VIO-lite）</h1>
<p class="muted">相对轨迹：起点在原点，方向为相对朝向。视觉/陀螺仪只用于补偿旋转，米制位移来自加速度二次积分并做零速校正。仅累计路程较可信，净位移/方向会漂移。</p>
<div class="row">
  <label>数据段：<select id="dataset"></select></label>
  <label>实际走了多少米（可选）：<input id="truth" type="number" min="0" step="0.1" placeholder="例如 5"></label>
  <label><input type="checkbox" id="arrows" checked> 显示朝向箭头</label>
</div>
<div class="stats" id="stats"></div>
<div class="panels">
  <div class="panel">
    <h3>俯视轨迹（米）</h3>
    <canvas id="xy" width="720" height="720"></canvas>
    <div class="legend">
      <span><i style="background:#22c55e"></i>高置信</span>
      <span><i style="background:#f59e0b"></i>中置信</span>
      <span><i style="background:#ef4444"></i>低置信</span>
      <span>S 起点 · E 终点 · 蓝点 = 静止(ZUPT)</span>
    </div>
  </div>
  <div class="panel">
    <h3>速度 / 累计路程（随时间）</h3>
    <canvas id="ts" width="720" height="360"></canvas>
    <div class="legend"><span><i style="background:#38bdf8"></i>速度 m/s</span><span><i style="background:#f59e0b"></i>累计路程 m</span></div>
    <div id="truth-result"></div>
    <div class="notes" id="notes"></div>
  </div>
</div>
<script id="payload" type="application/json">${data}</script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById("payload").textContent);
  var datasets = DATA.datasets;
  var select = document.getElementById("dataset");
  var xy = document.getElementById("xy");
  var ts = document.getElementById("ts");
  var stats = document.getElementById("stats");
  var notes = document.getElementById("notes");
  var truthInput = document.getElementById("truth");
  var truthResult = document.getElementById("truth-result");
  var arrows = document.getElementById("arrows");
  var CONF = ["#ef4444", "#f59e0b", "#22c55e"];

  if (!datasets.length) {
    stats.innerHTML = "<div class='stat'>没有可用数据：该会话里没有带加速度的 IMU 记录。</div>";
    return;
  }
  datasets.forEach(function (d, i) {
    var opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = d.label + "  (" + (d.durationMs / 1000).toFixed(1) + "s, " + d.summary.totalPathM.toFixed(1) + "m)";
    select.appendChild(opt);
  });

  function fmt(v, n) { return (v === null || v === undefined || isNaN(v)) ? "-" : Number(v).toFixed(n); }

  function draw(idx) {
    var d = datasets[idx];
    drawStats(d);
    drawXY(d);
    drawTimeseries(d);
    drawTruth(d);
    notes.textContent = (d.summary.notes || []).join("  ");
  }

  function drawStats(d) {
    var s = d.summary, c = d.calibration;
    stats.innerHTML = [
      stat(s.totalPathM.toFixed(2) + " m", "累计路程"),
      stat(s.netDisplacementM.toFixed(2) + " m", "净位移(3D)"),
      stat(s.horizontalDisplacementM.toFixed(2) + " m", "水平位移"),
      stat(s.maxSpeedMps.toFixed(2) + " m/s", "最大速度"),
      stat(s.confidence, "整体置信度"),
      stat(c.stable ? "稳定" : "不稳定", "标定"),
      stat((d.durationMs / 1000).toFixed(1) + " s", "时长"),
      stat(String(d.points.length), "点数(下采样)"),
    ].join("");
  }
  function stat(value, label) { return "<div class='stat'><b>" + value + "</b><span>" + label + "</span></div>"; }

  function bounds(d) {
    var xs = d.points.map(function (p) { return p[1]; });
    var ys = d.points.map(function (p) { return p[2]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    var span = Math.max(maxX - minX, maxY - minY, 1) * 1.25;
    return { cx: cx, cy: cy, span: span };
  }

  function drawXY(d) {
    var ctx = xy.getContext("2d");
    var W = xy.width, H = xy.height;
    ctx.clearRect(0, 0, W, H);
    var b = bounds(d);
    var scale = (Math.min(W, H) * 0.92) / b.span;
    function mx(x) { return W / 2 + (x - b.cx) * scale; }
    function my(y) { return H / 2 - (y - b.cy) * scale; }

    // Grid every nice step.
    var step = niceStep(b.span);
    ctx.strokeStyle = "#1c2942"; ctx.fillStyle = "#5b6d87"; ctx.lineWidth = 1; ctx.font = "11px sans-serif";
    var x0 = Math.ceil((b.cx - b.span / 2) / step) * step;
    for (var gx = x0; gx <= b.cx + b.span / 2; gx += step) { ctx.beginPath(); ctx.moveTo(mx(gx), 0); ctx.lineTo(mx(gx), H); ctx.stroke(); }
    var y0 = Math.ceil((b.cy - b.span / 2) / step) * step;
    for (var gy = y0; gy <= b.cy + b.span / 2; gy += step) { ctx.beginPath(); ctx.moveTo(0, my(gy)); ctx.lineTo(W, my(gy)); ctx.stroke(); }

    // Path, colored by the confidence of each point.
    ctx.lineWidth = 3; ctx.lineCap = "round";
    for (var i = 1; i < d.points.length; i++) {
      var a = d.points[i - 1], p = d.points[i];
      var ci = Math.min(a[6], p[6]);
      ctx.strokeStyle = CONF[ci];
      ctx.globalAlpha = ci === 2 ? 0.95 : ci === 1 ? 0.8 : 0.7;
      ctx.beginPath(); ctx.moveTo(mx(a[1]), my(a[2])); ctx.lineTo(mx(p[1]), my(p[2])); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Stationary points.
    ctx.fillStyle = "rgba(56,189,248,0.85)";
    for (var j = 0; j < d.points.length; j++) if (d.points[j][7] === 1) { ctx.beginPath(); ctx.arc(mx(d.points[j][1]), my(d.points[j][2]), 2, 0, Math.PI * 2); ctx.fill(); }

    // Heading arrows from velocity.
    if (arrows.checked) {
      ctx.fillStyle = "rgba(226,232,240,0.75)";
      var lastT = -Infinity;
      for (var k = 1; k < d.points.length; k++) {
        var q = d.points[k];
        if (q[5] < 0.15 || q[0] - lastT < 900) continue;
        var dx = q[1] - d.points[k - 1][1], dy = q[2] - d.points[k - 1][2];
        var len = Math.hypot(dx, dy); if (len < 1e-5) continue;
        lastT = q[0];
        arrow(ctx, mx(q[1]), my(q[2]), dx / len, -dy / len);
      }
    }

    // Start / end.
    var s = d.points[0], e = d.points[d.points.length - 1];
    marker(ctx, mx(s[1]), my(s[2]), "#22c55e", "S");
    marker(ctx, mx(e[1]), my(e[2]), "#ef4444", "E");
  }

  function arrow(ctx, x, y, ux, uy) {
    var size = 7, ang = 0.5;
    ctx.beginPath();
    ctx.moveTo(x + ux * size, y + uy * size);
    ctx.lineTo(x - ux * size * Math.cos(ang) - uy * size * Math.sin(ang), y - uy * size * Math.cos(ang) + ux * size * Math.sin(ang));
    ctx.lineTo(x - ux * size * Math.cos(ang) + uy * size * Math.sin(ang), y - uy * size * Math.cos(ang) - ux * size * Math.sin(ang));
    ctx.closePath(); ctx.fill();
  }

  function marker(ctx, x, y, color, text) {
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    ctx.fillStyle = "#06121f"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, x, y + 0.5);
    ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
  }

  function niceStep(span) {
    var raw = span / 8, pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / pow;
    var mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return mult * pow;
  }

  function drawTimeseries(d) {
    var ctx = ts.getContext("2d");
    var W = ts.width, H = ts.height, pad = 34;
    ctx.clearRect(0, 0, W, H);
    var pts = d.points;
    var t0 = pts[0][0], t1 = pts[pts.length - 1][0], dt = Math.max(1, t1 - t0);
    var maxSpeed = Math.max(0.5, d.summary.maxSpeedMps) * 1.1;
    var maxPath = Math.max(1, d.summary.totalPathM) * 1.1;
    var plotW = W - pad - 8, plotH = H - pad - 8;
    function px(t) { return pad + ((t - t0) / dt) * plotW; }
    function pyS(v) { return 8 + plotH - (v / maxSpeed) * plotH; }
    function pyP(v) { return 8 + plotH - (v / maxPath) * plotH; }

    ctx.strokeStyle = "#1c2942"; ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) { var yy = 8 + (plotH / 4) * g; ctx.beginPath(); ctx.moveTo(pad, yy); ctx.lineTo(W - 8, yy); ctx.stroke(); }

    ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 2; ctx.beginPath();
    pts.forEach(function (p, i) { var X = px(p[0]), Y = pyS(p[5]); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }); ctx.stroke();
    ctx.strokeStyle = "#f59e0b"; ctx.beginPath();
    pts.forEach(function (p, i) { var X = px(p[0]), Y = pyP(p[4]); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }); ctx.stroke();

    ctx.fillStyle = "#5b6d87"; ctx.font = "11px sans-serif";
    ctx.fillText(maxSpeed.toFixed(1) + " m/s", 4, 16);
    ctx.fillText("0", 4, 8 + plotH);
    ctx.fillText(maxPath.toFixed(1) + " m", W - 52, 16);
    ctx.fillText((dt / 1000).toFixed(0) + "s", W - 30, 8 + plotH + 18);
  }

  function drawTruth(d) {
    var truth = parseFloat(truthInput.value);
    if (!truth || truth <= 0) { truthResult.innerHTML = ""; return; }
    var est = d.summary.totalPathM;
    var err = ((est - truth) / truth) * 100;
    var cls = Math.abs(err) <= 15 ? "good" : Math.abs(err) <= 40 ? "warn" : "bad";
    var disp = d.summary.horizontalDisplacementM;
    truthResult.innerHTML = "累计路程估计 <b>" + est.toFixed(2) + " m</b> vs 实际 " + truth.toFixed(2) +
      " m → 误差 <b class='" + cls + "'>" + (err >= 0 ? "+" : "") + err.toFixed(1) + "%</b>；净水平位移 " + disp.toFixed(2) + " m。";
  }

  select.addEventListener("change", function () { draw(parseInt(select.value, 10)); });
  truthInput.addEventListener("input", function () { draw(parseInt(select.value, 10)); });
  arrows.addEventListener("change", function () { draw(parseInt(select.value, 10)); });
  draw(0);
})();
</script>
</body>
</html>`;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const sessionId = args.session ?? (await newestSession());
	if (!sessionId) throw new Error(`没有找到带 live/motion.jsonl 的会话（${experimentRoot}）`);
	const sessionDir = resolve(experimentRoot, sessionId);
	if (!existsSync(sessionDir)) throw new Error(`会话不存在：${sessionDir}`);

	const datasets = await collectDatasets(sessionDir, args);
	const out = args.out ? resolve(args.out) : resolve("run", "analysis", `${sessionId}-trajectory.html`);
	await mkdir(dirname(out), { recursive: true });
	await writeFile(out, renderHtml(sessionId, datasets), "utf8");

	console.log(`会话: ${sessionId}`);
	console.log(`数据段: ${datasets.length}`);
	for (const dataset of datasets) {
		console.log(`  - ${dataset.label}: 路程 ${dataset.summary.totalPathM.toFixed(2)}m, 净位移 ${dataset.summary.netDisplacementM.toFixed(2)}m, 置信度 ${dataset.summary.confidence}, 标定 ${dataset.calibration.stable ? "稳定" : "不稳定"}`);
	}
	console.log(`报告: ${out}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
