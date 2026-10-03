import { blockFlow, summarizeFlow, grayVariance } from "./vio-flow.js";

const GW = 160;
const GH = 120;
const CAPTURE_INTERVAL_MS = 66; // ~15 fps
const SEARCH = 10;
const BLOCK = 16;
const STEP = 16;
const RECORD_MS = 12000;

const video = document.getElementById("video");
const capture = document.createElement("canvas");
capture.width = GW;
capture.height = GH;
const ctx = capture.getContext("2d", { willReadFrequently: true });
const el = (id) => document.getElementById(id);

let prevGray = null;
let orientation = { alpha: null, beta: null, gamma: null, rate: null };
let prevOrientation = null;
let running = false;
let recording = false;
let recordUntil = 0;
let recordFrames = [];
let recordImu = [];

window.addEventListener("deviceorientation", (event) => {
  orientation = { alpha: event.alpha, beta: event.beta, gamma: event.gamma, rate: null };
});
window.addEventListener("devicemotion", (event) => {
  const r = event.rotationRate;
  if (r && [r.alpha, r.beta, r.gamma].every(Number.isFinite)) orientation.rate = { alpha: r.alpha, beta: r.beta, gamma: r.gamma };
});

function wrapDegrees(value) { return ((value + 180) % 360 + 360) % 360 - 180; }

async function requestMotionPermission() {
  if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
    try { await DeviceMotionEvent.requestPermission(); } catch { /* ignored */ }
  }
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    try { await DeviceOrientationEvent.requestPermission(); } catch { /* ignored */ }
  }
}

function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function frame() {
  if (!running || video.videoWidth === 0) return;
  ctx.drawImage(video, 0, 0, GW, GH);
  const rgba = ctx.getImageData(0, 0, GW, GH).data;
  const gray = new Uint8ClampedArray(GW * GH);
  for (let i = 0; i < gray.length; i++) { const j = i * 4; gray[i] = (rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114) | 0; }

  if (recording) {
    recordFrames.push(gray.slice());
    recordImu.push({ t: Date.now(), ...orientation, rate: orientation.rate });
    if (Date.now() >= recordUntil) void stopRecording();
  }

  if (prevGray) {
    const flow = blockFlow(prevGray, gray, GW, GH, { block: BLOCK, step: STEP, search: SEARCH });
    const s = summarizeFlow(flow, GW, GH, SEARCH);
    const variance = grayVariance(gray);
    const motion = Math.hypot(s.globalDx, s.globalDy);
    let label;
    if (variance < 30) label = "纹理不足（白墙/严重模糊）";
    else if (s.count < 15) label = "有效匹配太少";
    else if (s.fracAtEdge > 0.4) label = "运动过大，超出搜索范围";
    else if (Math.abs(s.expansion) >= 1.2 && Math.abs(s.expansion) >= motion * 0.7 && s.coherent >= 0.35) label = s.expansion > 0 ? "前进" : "后退";
    else if (motion >= 1.5 && s.coherent >= 0.3) label = `整体位移 ${s.globalDx},${s.globalDy}（旋转或横向）`;
    else if (Math.abs(s.expansion) < 0.8 && motion < 1.5) label = "基本静止";
    else label = "不确定";

    let rotation = "-";
    if (prevOrientation && [orientation.alpha, orientation.beta, orientation.gamma, prevOrientation.alpha, prevOrientation.beta, prevOrientation.gamma].every(Number.isFinite)) {
      rotation = `yaw ${wrapDegrees(orientation.alpha - prevOrientation.alpha).toFixed(1)} / pitch ${wrapDegrees(orientation.beta - prevOrientation.beta).toFixed(1)}`;
    }
    el("label").textContent = label;
    el("expansion").textContent = s.expansion.toFixed(2);
    el("global").textContent = `${s.globalDx},${s.globalDy}`;
    el("coherence").textContent = s.coherent.toFixed(2);
    el("edge").textContent = s.fracAtEdge.toFixed(2);
    el("variance").textContent = variance.toFixed(0);
    el("rotation").textContent = rotation;
  }
  prevGray = gray;
  prevOrientation = { ...orientation };
}

async function stopRecording() {
  if (!recording) return;
  recording = false;
  el("record").textContent = "录制 12 秒";
  const frames = recordFrames.map((g) => toBase64(g));
  const payload = { width: GW, height: GH, fps: Math.round(1000 / CAPTURE_INTERVAL_MS), frames, imu: recordImu };
  recordFrames = [];
  recordImu = [];
  el("status").textContent = `正在上传 ${frames.length} 帧…`;
  try {
    const response = await fetch("/api/vio/burst", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    el("status").textContent = response.ok ? `录制已保存：${result.id}（${result.frameCount} 帧）` : `上传失败 ${response.status}`;
  } catch (error) {
    el("status").textContent = "上传失败：" + error.message;
  }
}

document.getElementById("start").addEventListener("click", async () => {
  try {
    await requestMotionPermission();
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 640 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    if (!running) { running = true; window.setInterval(frame, CAPTURE_INTERVAL_MS); }
    el("label").textContent = "运行中…";
    window.setTimeout(() => {
      el("status").textContent = Number.isFinite(orientation.alpha) || orientation.rate ? "IMU 已就绪（姿态/角速度可用）" : "IMU 不可用（姿态与角速度都为空，检查权限）";
    }, 1200);
  } catch (error) { el("label").textContent = "打开摄像头失败：" + error.message; }
});

document.getElementById("stop").addEventListener("click", () => {
  running = false;
  recording = false;
  if (video.srcObject) for (const track of video.srcObject.getTracks()) track.stop();
  video.srcObject = null;
  el("label").textContent = "已停止";
  el("record").textContent = "录制 12 秒";
});

document.getElementById("record").addEventListener("click", () => {
  if (recording) { void stopRecording(); return; }
  if (!running) { el("label").textContent = "请先开启摄像头"; return; }
  recordFrames = [];
  recordImu = [];
  recording = true;
  recordUntil = Date.now() + RECORD_MS;
  el("record").textContent = "停止录制";
});

window.addEventListener("pagehide", () => { running = false; if (video.srcObject) for (const track of video.srcObject.getTracks()) track.stop(); });
