const $ = (id) => document.getElementById(id);

const state = {
  checkedAt: null,
  secureContext: window.isSecureContext,
  immersiveArSupported: null,
  testMode: null,
  requestedFeatures: [],
  optionalFeatures: [],
  enabledFeatures: null,
  depthRequestAttempted: false,
  failureStage: null,
  sessionStartedAt: null,
  sessionEndedAt: null,
  sessionDepthUsage: null,
  sessionDepthDataFormat: null,
  poseSamples: 0,
  depthSamples: 0,
  invalidDepthSamples: 0,
  firstPose: null,
  lastPose: null,
  maxTranslationFromStartMeters: 0,
  lastDepthMeters: null,
  lastDepthResolution: null,
  positionEmulated: null,
  errors: [],
};

const makeReportId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let reportId = makeReportId();
let reportSequence = 0;
let saveInProgress = false;
let saveQueued = false;
let reportSaveTimer = null;
let sessionAutoEndTimer = null;
let activeSession = null;
let referenceSpace = null;
let gl = null;
let xrLayer = null;
let lastUiUpdate = 0;

function setStatus(id, message, error = false) {
  const element = $(id);
  element.textContent = message;
  element.classList.toggle("error", error);
}

function renderState() {
  $("probe-output").textContent = JSON.stringify({
    ...state,
    rgbDepthPoseSynchronized: false,
    imageUpload: false,
    gpuRequired: false,
  }, null, 2);
  $("export-button").disabled = !state.checkedAt && !state.sessionStartedAt;
}

function savedSessionToken() { return sessionStorage.getItem("vlm-token"); }

function showProbeLogin(show, message = "") {
  $("probe-login-panel").hidden = !show;
  if (message) setStatus("save-status", message, show);
}

function diagnosticReport() {
  return {
    browser: {
      userAgent: navigator.userAgent.slice(0, 500),
      platform: String(navigator.platform || "unknown").slice(0, 100),
      language: String(navigator.language || "unknown").slice(0, 40),
      maxTouchPoints: Number(navigator.maxTouchPoints || 0),
      secureContext: window.isSecureContext,
      webXRApiAvailable: Boolean(navigator.xr?.isSessionSupported),
      getUserMediaAvailable: Boolean(navigator.mediaDevices?.getUserMedia),
    },
    result: {
      ...state,
      rgbDepthPoseSynchronized: false,
      imageUpload: false,
      gpuRequired: false,
    },
  };
}

async function saveDiagnostics() {
  if (!state.checkedAt && !state.sessionStartedAt && !state.errors.length) return;
  const token = savedSessionToken();
  if (!token) {
    showProbeLogin(true, "输入体验口令后，当前诊断结果会自动保存到后台。");
    return;
  }
  if (saveInProgress) { saveQueued = true; return; }
  saveInProgress = true;
  const sequence = reportSequence++;
  try {
    const response = await fetch("/api/spatial-probe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reportId, sequence, report: diagnosticReport() }),
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      sessionStorage.removeItem("vlm-token");
      sessionStorage.removeItem("vlm-session");
      showProbeLogin(true, "试用登录已过期，请重新输入口令以保存诊断。");
      return;
    }
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    showProbeLogin(false);
    setStatus("save-status", `诊断已自动保存到后台（${result.reportId}，记录 ${result.sequence + 1}）。`);
  } catch (error) {
    setStatus("save-status", `后台保存失败：${String(error)}`, true);
  } finally {
    saveInProgress = false;
    if (saveQueued) {
      saveQueued = false;
      void saveDiagnostics();
    }
  }
}

async function loginForProbe() {
  const button = $("probe-login-button");
  button.disabled = true;
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: $("probe-passcode").value }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    sessionStorage.setItem("vlm-token", result.token);
    sessionStorage.setItem("vlm-session", result.sessionId);
    $("probe-passcode").value = "";
    showProbeLogin(false);
    setStatus("save-status", "已登录，正在保存诊断……");
    await saveDiagnostics();
  } catch (error) {
    showProbeLogin(true, `登录失败：${String(error)}`);
  } finally {
    button.disabled = false;
  }
}

function clearRunState() {
  state.testMode = null;
  state.requestedFeatures = [];
  state.optionalFeatures = [];
  state.enabledFeatures = null;
  state.depthRequestAttempted = false;
  state.failureStage = null;
  state.sessionStartedAt = null;
  state.sessionEndedAt = null;
  state.sessionDepthUsage = null;
  state.sessionDepthDataFormat = null;
  state.poseSamples = 0;
  state.depthSamples = 0;
  state.invalidDepthSamples = 0;
  state.firstPose = null;
  state.lastPose = null;
  state.maxTranslationFromStartMeters = 0;
  state.lastDepthMeters = null;
  state.lastDepthResolution = null;
  state.positionEmulated = null;
  state.errors = [];
}

async function checkSupport() {
  reportId = makeReportId();
  reportSequence = 0;
  state.checkedAt = new Date().toISOString();
  state.secureContext = window.isSecureContext;
  setStatus("secure-status", `安全上下文：${state.secureContext ? "是" : "否"}`, !state.secureContext);

  if (!state.secureContext) {
    state.immersiveArSupported = false;
    $("start-button").disabled = true;
    $("depth-start-button").disabled = true;
    setStatus("xr-status", "immersive-ar：需要 HTTPS 安全页面", true);
    setStatus("probe-status", "请通过现有 HTTPS 隧道打开本页，再检查。", true);
    renderState();
    await saveDiagnostics();
    return;
  }
  if (!navigator.xr?.isSessionSupported) {
    state.immersiveArSupported = false;
    setStatus("xr-status", "immersive-ar：此浏览器没有 WebXR Device API", true);
    setStatus("probe-status", "浏览器没有 WebXR。Android 可检查 Chrome 和 ARCore；其他平台需要对应的原生空间 API。", true);
    $("start-button").disabled = true;
    $("depth-start-button").disabled = true;
    renderState();
    await saveDiagnostics();
    return;
  }

  try {
    state.immersiveArSupported = await navigator.xr.isSessionSupported("immersive-ar");
    $("start-button").disabled = !state.immersiveArSupported;
    $("depth-start-button").disabled = !state.immersiveArSupported;
    setStatus("xr-status", `immersive-ar：${state.immersiveArSupported ? "支持，可继续请求传感器权限" : "设备或浏览器不支持"}`, !state.immersiveArSupported);
    setStatus("probe-status", state.immersiveArSupported
      ? "浏览器报告 AR 可用。分别运行基础位姿与深度检查，确认实际 session 能力。"
      : "未发现沉浸式 AR 支持。若这是 Android 手机，可检查 Chrome 和 ARCore 服务是否可用。", !state.immersiveArSupported);
  } catch (error) {
    state.immersiveArSupported = false;
    $("start-button").disabled = true;
    $("depth-start-button").disabled = true;
    state.errors.push(`isSessionSupported: ${String(error)}`);
    setStatus("xr-status", `immersive-ar 检查失败：${String(error)}`, true);
    setStatus("probe-status", "浏览器检查失败。", true);
  }
  renderState();
  await saveDiagnostics();
}

function recordPose(viewerPose) {
  const transform = viewerPose.transform;
  const position = transform.position;
  const orientation = transform.orientation;
  const current = {
    positionMeters: { x: position.x, y: position.y, z: position.z },
    orientationQuaternion: { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w },
  };
  if (!state.firstPose) state.firstPose = current;
  const origin = state.firstPose.positionMeters;
  const dx = position.x - origin.x;
  const dy = position.y - origin.y;
  const dz = position.z - origin.z;
  state.maxTranslationFromStartMeters = Math.max(state.maxTranslationFromStartMeters, Math.hypot(dx, dy, dz));
  state.lastPose = current;
  state.positionEmulated = viewerPose.emulatedPosition;
  state.poseSamples += 1;
}

function recordDepth(frame, view) {
  if (!state.depthRequestAttempted) return;
  if (typeof frame.getDepthInformation !== "function") return;
  try {
    const info = frame.getDepthInformation(view);
    if (!info) return;
    state.lastDepthResolution = { width: info.width, height: info.height };
    if (typeof info.getDepthInMeters !== "function") return;
    const samples = [
      info.getDepthInMeters(0.5, 0.5),
      info.getDepthInMeters(0.45, 0.5),
      info.getDepthInMeters(0.55, 0.5),
      info.getDepthInMeters(0.5, 0.45),
      info.getDepthInMeters(0.5, 0.55),
    ].filter((value) => Number.isFinite(value) && value > 0);
    if (samples.length === 0) {
      state.invalidDepthSamples += 1;
      return;
    }
    samples.sort((a, b) => a - b);
    state.lastDepthMeters = samples[Math.floor(samples.length / 2)];
    state.depthSamples += 1;
  } catch (error) {
    if (state.errors.length < 5) state.errors.push(`depth sample: ${String(error)}`);
  }
}

function updateSensorStatus() {
  setStatus("pose-status", state.poseSamples > 0
    ? `相机位姿：已采样 ${state.poseSamples} 帧；${state.positionEmulated ? "位置为模拟值" : "位置由追踪提供"}`
    : "相机位姿：等待追踪", state.poseSamples === 0);
  setStatus("depth-status", state.depthSamples > 0
    ? `深度数据：${state.depthSamples} 次有效；中心约 ${state.lastDepthMeters.toFixed(2)} m，${state.lastDepthResolution.width}×${state.lastDepthResolution.height}`
    : state.depthRequestAttempted
      ? `深度数据：等待可用帧（有效 ${state.depthSamples} / 无效 ${state.invalidDepthSamples}）`
      : "深度数据：本次基础位姿检查未请求", state.depthRequestAttempted && state.sessionDepthUsage === null && state.depthSamples === 0);
  $("xr-hud-status").textContent = state.depthSamples > 0
    ? `位姿 ${state.poseSamples} 帧 · 深度 ${state.lastDepthMeters.toFixed(2)} m`
    : `正在追踪 · 位姿 ${state.poseSamples} 帧`;
  setStatus("probe-status", "传感器检查运行中。缓慢移动手机，观察清晰、有纹理的场景。", false);
}

function onXRFrame(_time, frame) {
  if (!activeSession || frame.session !== activeSession) return;
  activeSession.requestAnimationFrame(onXRFrame);
  const layer = activeSession.renderState.baseLayer;
  if (layer && gl) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }
  const viewerPose = frame.getViewerPose(referenceSpace);
  if (viewerPose) {
    recordPose(viewerPose);
    for (const view of viewerPose.views) recordDepth(frame, view);
  }
  if (_time - lastUiUpdate > 500) {
    lastUiUpdate = _time;
    updateSensorStatus();
    renderState();
  }
}

async function startSession(depthProbe = false) {
  if (!navigator.xr?.requestSession) {
    setStatus("probe-status", "当前浏览器无法创建 AR session。", true);
    state.failureStage = "requestSession-unavailable";
    state.errors.push("navigator.xr.requestSession is unavailable");
    renderState();
    await saveDiagnostics();
    return;
  }
  clearRunState();
  state.testMode = depthProbe ? "depth" : "pose";
  state.depthRequestAttempted = depthProbe;
  state.requestedFeatures = depthProbe ? ["local", "depth-sensing"] : [];
  state.optionalFeatures = [];
  if (!state.checkedAt) state.checkedAt = new Date().toISOString();
  setStatus("probe-status", depthProbe ? "正在单独请求 AR 与深度能力……" : "正在请求不附带额外能力的 immersive-ar session……");
  $("start-button").disabled = true;
  $("depth-start-button").disabled = true;
  let stage = "requestSession";
  try {
    const sessionInit = {
      requiredFeatures: state.requestedFeatures,
      optionalFeatures: state.optionalFeatures,
    };
    if (depthProbe) {
      sessionInit.depthSensing = {
        usagePreference: ["cpu-optimized"],
        dataFormatPreference: ["luminance-alpha", "float32", "unsigned-short"],
      };
    }
    const session = await navigator.xr.requestSession("immersive-ar", sessionInit);
    activeSession = session;
    state.sessionStartedAt = new Date().toISOString();
    try { state.enabledFeatures = session.enabledFeatures ? Array.from(session.enabledFeatures) : null; } catch { state.enabledFeatures = null; }
    if (depthProbe) {
      try { state.sessionDepthUsage = session.depthUsage ?? null; } catch (error) { state.errors.push(`read depthUsage: ${String(error)}`); }
      try { state.sessionDepthDataFormat = session.depthDataFormat ?? null; } catch (error) { state.errors.push(`read depthDataFormat: ${String(error)}`); }
    }
    stage = "requestReferenceSpace";
    referenceSpace = await session.requestReferenceSpace("local");
    const canvas = $("xr-canvas");
    stage = "webglContext";
    gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: true });
    if (!gl) throw new Error("浏览器无法创建 WebGL context");
    stage = "makeXRCompatible";
    await gl.makeXRCompatible();
    stage = "createXRWebGLLayer";
    xrLayer = new XRWebGLLayer(session, gl, { alpha: true, antialias: false });
    session.updateRenderState({ baseLayer: xrLayer });
    session.addEventListener("end", endSession, { once: true });
    $("stop-button").disabled = false;
    setStatus("xr-status", `immersive-ar：${depthProbe ? "深度检查" : "基础位姿检查"} session 已启动`);
    setStatus("depth-status", depthProbe
      ? `深度模式：${state.sessionDepthUsage ?? "浏览器未报告"} / ${state.sessionDepthDataFormat ?? "格式未报告"}`
      : "深度数据：本次基础位姿检查未请求");
    activeSession.requestAnimationFrame(onXRFrame);
    sessionAutoEndTimer = window.setTimeout(() => {
      if (activeSession === session) void session.end();
    }, 12_000);
    renderState();
    await saveDiagnostics();
    reportSaveTimer = window.setInterval(() => void saveDiagnostics(), 10_000);
  } catch (error) {
    if (sessionAutoEndTimer) window.clearTimeout(sessionAutoEndTimer);
    sessionAutoEndTimer = null;
    state.failureStage = stage;
    state.errors.push(`${stage}: ${String(error)}`);
    setStatus("probe-status", `空间检查失败（${stage}）：${String(error)}`, true);
    setStatus("depth-status", depthProbe ? "深度数据：session 未启动" : "深度数据：本次基础位姿检查未请求", depthProbe);
    setStatus("pose-status", "相机位姿：session 未启动", true);
    if (activeSession) {
      try { await activeSession.end(); } catch { /* session may already be ending */ }
    }
    activeSession = null;
    $("start-button").disabled = !state.immersiveArSupported;
    $("depth-start-button").disabled = !state.immersiveArSupported;
    renderState();
    await saveDiagnostics();
  }
}

function endSession() {
  state.sessionEndedAt = new Date().toISOString();
  if (sessionAutoEndTimer) window.clearTimeout(sessionAutoEndTimer);
  sessionAutoEndTimer = null;
  if (reportSaveTimer) window.clearInterval(reportSaveTimer);
  reportSaveTimer = null;
  activeSession = null;
  referenceSpace = null;
  xrLayer = null;
  gl = null;
  $("start-button").disabled = !state.immersiveArSupported;
  $("depth-start-button").disabled = !state.immersiveArSupported;
  $("stop-button").disabled = true;
  setStatus("probe-status", state.poseSamples === 0
    ? "检查结束，但没有取得位姿样本。请查看自动保存的 failureStage 与浏览器错误。"
    : state.depthRequestAttempted
      ? state.depthSamples > 0
        ? "深度检查完成。已取得位姿和深度；RGB 与这些数据的时间配对仍需单独验证。"
        : "位姿检查成功，但未取得有效深度。请检查设备深度支持、光照，并缓慢移动手机。"
      : "基础位姿检查成功。深度能力尚未测试，可再单独运行深度检查。", state.poseSamples === 0 || (state.depthRequestAttempted && state.depthSamples === 0));
  setStatus("pose-status", state.poseSamples > 0
    ? `相机位姿：完成 ${state.poseSamples} 帧；最大平移 ${state.maxTranslationFromStartMeters.toFixed(3)} m`
    : "相机位姿：没有取得有效样本", state.poseSamples === 0);
  renderState();
  void saveDiagnostics();
}

function stopSession() {
  if (activeSession) void activeSession.end();
}

function exportDiagnostics() {
  const blob = new Blob([JSON.stringify({ ...state, rgbDepthPoseSynchronized: false, imageUpload: false, gpuRequired: false }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "spatial-probe.json";
  link.click();
  URL.revokeObjectURL(url);
}

$("check-button").addEventListener("click", () => void checkSupport());
$("start-button").addEventListener("click", () => void startSession(false));
$("depth-start-button").addEventListener("click", () => void startSession(true));
$("stop-button").addEventListener("click", stopSession);
$("xr-stop").addEventListener("click", stopSession);
$("export-button").addEventListener("click", exportDiagnostics);
$("probe-login-button").addEventListener("click", () => void loginForProbe());
$("probe-passcode").addEventListener("keydown", (event) => { if (event.key === "Enter") void loginForProbe(); });

showProbeLogin(!savedSessionToken());
setStatus("secure-status", `安全上下文：${window.isSecureContext ? "是" : "否"}`, !window.isSecureContext);
renderState();
