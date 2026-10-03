const $ = (id) => document.getElementById(id);
const CAPTURE_SECONDS = 25;
const FRAME_INTERVAL_MS = 200;
const MAX_FRAME_WIDTH = 640;
const GRAY_WIDTH = 64;
const GRAY_HEIGHT = 48;

const state = {
  token: sessionStorage.getItem("vlm-token"),
  sessionId: sessionStorage.getItem("vlm-session"),
  stream: null,
  recording: false,
  uploading: false,
  frameCallbackId: null,
  progressTimer: null,
  startPerf: null,
  lastFramePerf: 0,
  frames: [],
  motionSamples: [],
  lastMotionEvent: null,
  motionEventTimes: [],
  currentCapture: null,
  chartValues: [],
  sensorTestRunning: false,
  model: null,
  view: { yaw: -0.72, pitch: 0.46, zoom: 1 },
};

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers, cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) {
    sessionStorage.removeItem("vlm-token");
    sessionStorage.removeItem("vlm-session");
    state.token = null;
    state.sessionId = null;
    showLogin("会话已过期，请重新输入口令。", true);
  }
  if (!response.ok) throw new Error(result.error || `请求失败（${response.status}）`);
  return result;
}

function setMessage(id, text, error = false) {
  const element = $(id);
  element.textContent = text;
  element.classList.toggle("error", error);
}

function showLogin(message = "", error = false) {
  $("login-panel").hidden = false;
  $("workspace").hidden = true;
  if (message) setMessage("login-status", message, error);
}

function showWorkspace() {
  $("login-panel").hidden = true;
  $("workspace").hidden = false;
}

async function login() {
  const button = $("login-button");
  button.disabled = true;
  setMessage("login-status", "正在连接试验记录……");
  try {
    const result = await api("/api/login", { method: "POST", body: JSON.stringify({ passcode: $("passcode").value }) });
    state.token = result.token;
    state.sessionId = result.sessionId;
    sessionStorage.setItem("vlm-token", state.token);
    sessionStorage.setItem("vlm-session", state.sessionId);
    $("passcode").value = "";
    showWorkspace();
    await loadLatest();
    setMessage("global-status", "已连接。开启相机后可开始一次 25 秒空间采集。");
  } catch (error) {
    setMessage("login-status", error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function restoreSession() {
  if (!state.token) return showLogin();
  try {
    await api("/api/state");
    showWorkspace();
    await loadLatest();
  } catch (error) {
    if (state.token) showLogin(error.message, true);
  }
}

async function loadLatest() {
  try {
    const result = await api("/api/spatial/latest");
    if (result.available) showResult(result.capture);
  } catch (error) {
    setMessage("global-status", `读取最近一次空间结果失败：${error.message}`, true);
  }
}

function normalizeEventTime(timestamp) {
  if (!Number.isFinite(timestamp)) return performance.now();
  return timestamp > 1e12 ? timestamp - performance.timeOrigin : timestamp;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function vectorFromEvent(value) {
  if (!value) return null;
  const result = { x: finiteOrNull(value.x), y: finiteOrNull(value.y), z: finiteOrNull(value.z) };
  return Object.values(result).every((item) => item === null) ? null : result;
}

function rateFromRecentSamples() {
  const recent = state.motionEventTimes.slice(-40);
  if (recent.length < 3) return 0;
  const span = recent.at(-1) - recent[0];
  return span > 0 ? Math.round((recent.length - 1) * 1000 / span) : 0;
}

function onDeviceMotion(event) {
  const now = performance.now();
  const timeMs = normalizeEventTime(event.timeStamp);
  const acceleration = vectorFromEvent(event.acceleration);
  const accelerationIncludingGravity = vectorFromEvent(event.accelerationIncludingGravity);
  const rotationRate = event.rotationRate ? {
    alpha: finiteOrNull(event.rotationRate.alpha),
    beta: finiteOrNull(event.rotationRate.beta),
    gamma: finiteOrNull(event.rotationRate.gamma),
  } : null;
  const gyroHasData = rotationRate && Object.values(rotationRate).some((value) => value !== null);
  const accelHasData = acceleration || accelerationIncludingGravity;
  if (!gyroHasData && !accelHasData) return;

  const sample = { eventTimeMs: timeMs, receivedTimeMs: now, acceleration, accelerationIncludingGravity, rotationRate };
  state.lastMotionEvent = sample;
  state.motionEventTimes.push(timeMs);
  if (state.motionEventTimes.length > 80) state.motionEventTimes.shift();
  if (state.recording && state.startPerf !== null) {
    sample.timeMs = Math.max(0, timeMs - state.startPerf);
    sample.receivedTimeMs = Math.max(0, now - state.startPerf);
    state.motionSamples.push(sample);
    if (state.motionSamples.length > 10_000) state.motionSamples.shift();
  }

  const chartValue = rotationRate
    ? Math.hypot(rotationRate.alpha || 0, rotationRate.beta || 0, rotationRate.gamma || 0)
    : acceleration ? Math.hypot(acceleration.x || 0, acceleration.y || 0, acceleration.z || 0) : 0;
  state.chartValues.push(Math.min(1, chartValue / (rotationRate ? 180 : 10)));
  if (state.chartValues.length > 100) state.chartValues.shift();
  updateSignalCards();
  drawMotionChart();
}

function updateSignalCards() {
  const settings = state.stream?.getVideoTracks()[0]?.getSettings?.() || {};
  $("camera-state").textContent = state.stream ? "图像流已开启" : "未连接";
  $("camera-detail").textContent = settings.width ? `${settings.width} × ${settings.height} · ${Math.round(settings.frameRate || 0)} fps` : "等待授权";
  $("camera-state").closest(".signal-card").dataset.state = state.stream ? "ok" : "warn";

  const latest = state.lastMotionEvent;
  const hasGyro = latest?.rotationRate && Object.values(latest.rotationRate).some((value) => value !== null);
  const hasAccel = latest?.acceleration || latest?.accelerationIncludingGravity;
  $("gyro-state").textContent = hasGyro ? "正在读取" : "等待数据";
  $("gyro-detail").textContent = hasGyro ? `${rateFromRecentSamples()} Hz · deg/s` : "转动手机以触发角速度读数";
  $("gyro-state").closest(".signal-card").dataset.state = hasGyro ? "ok" : "warn";
  $("accel-state").textContent = hasAccel ? "正在读取" : "等待数据";
  $("accel-detail").textContent = hasAccel ? `${rateFromRecentSamples()} Hz · m/s²` : "移动手机以触发加速度读数";
  $("accel-state").closest(".signal-card").dataset.state = hasAccel ? "ok" : "warn";
  $("sample-rate").textContent = `${rateFromRecentSamples()} Hz`;

  const video = $("camera");
  const videoFrameApi = typeof video.requestVideoFrameCallback === "function";
  $("sync-state").textContent = videoFrameApi ? "浏览器时钟可对齐" : "低精度时间戳";
  $("sync-detail").textContent = videoFrameApi ? "帧回调与传感器使用同一性能时钟" : "使用视频刷新回调估算；非硬件曝光时间";
  $("sync-state").closest(".signal-card").dataset.state = videoFrameApi ? "ok" : "warn";
}

function sensorError(error) {
  return {
    name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
    message: typeof error?.message === "string" ? error.message.slice(0, 180) : String(error || "未知错误").slice(0, 180),
  };
}

function querySensorPermission(name) {
  if (!navigator.permissions?.query) return Promise.resolve({ state: "unsupported" });
  return navigator.permissions.query({ name }).then((permission) => ({ state: permission.state })).catch((error) => ({ state: "query_error", error: sensorError(error) }));
}

function requestLegacySensorPermission(constructorName) {
  const constructor = window[constructorName];
  if (typeof constructor?.requestPermission !== "function") return Promise.resolve({ status: "not_exposed" });
  try {
    return Promise.resolve(constructor.requestPermission()).then((status) => ({ status: String(status) })).catch((error) => ({ status: "error", error: sensorError(error) }));
  } catch (error) {
    return Promise.resolve({ status: "error", error: sensorError(error) });
  }
}

function summarizeSamples(samples) {
  if (!samples.length) return { count: 0, first: null, last: null, maxMagnitude: null };
  const magnitudes = samples.map((sample) => Math.hypot(sample.x ?? sample.alpha ?? 0, sample.y ?? sample.beta ?? 0, sample.z ?? sample.gamma ?? 0));
  return {
    count: samples.length,
    first: samples[0],
    last: samples.at(-1),
    maxMagnitude: Number(Math.max(...magnitudes).toFixed(5)),
  };
}

function renderSensorTest(report) {
  const { deviceMotion, deviceOrientation, genericGyroscope, diagnosis, permissions } = report;
  setMessage("sensor-test-status", `${diagnosis.message} · 已自动保存到后台`);
  const permissionText = Object.entries(permissions.states).map(([name, item]) => `${name}: ${item.state}${item.error ? ` (${item.error.name})` : ""}`).join(" / ");
  const requestText = Object.entries(permissions.requests).map(([name, item]) => `${name}: ${item.status}${item.error ? ` (${item.error.name})` : ""}`).join(" / ");
  const lines = [
    `结论: ${diagnosis.code}`,
    `权限查询: ${permissionText || "无"}`,
    `权限请求接口: ${requestText || "无"}`,
    `DeviceMotion: 事件 ${deviceMotion.eventCount}，加速度 ${deviceMotion.accelerationSamples}，rotationRate 有效 ${deviceMotion.rotationRate.count}`,
    `Generic Gyroscope: ${genericGyroscope.state}，读数 ${genericGyroscope.readings.count}，单位 rad/s${genericGyroscope.error ? `，错误 ${genericGyroscope.error.name}: ${genericGyroscope.error.message}` : ""}`,
    `DeviceOrientation: 事件 ${deviceOrientation.eventCount}，有效方向 ${deviceOrientation.orientation.count}，绝对方向 ${deviceOrientation.absoluteSamples}`,
  ];
  $("sensor-test-output").textContent = lines.join("\n");
  $("sensor-test-output").hidden = false;
}

async function runSensorTest() {
  if (state.sensorTestRunning) return;
  if (!window.isSecureContext) {
    setMessage("sensor-test-status", "传感器测试需要 HTTPS 安全页面。", true);
    return;
  }
  state.sensorTestRunning = true;
  const button = $("sensor-test-button");
  button.disabled = true;
  button.textContent = "采样中…";
  $("sensor-test-output").hidden = true;
  setMessage("sensor-test-status", "请平稳转动手机约 6 秒。测试不需要开启相机，结束后结果会自动上传。 ");

  // Invoke legacy permission prompts synchronously within the tap gesture when a browser exposes them.
  const motionPermissionPromise = requestLegacySensorPermission("DeviceMotionEvent");
  const orientationPermissionPromise = requestLegacySensorPermission("DeviceOrientationEvent");
  const startedAt = new Date().toISOString();
  const startedPerf = performance.now();
  const motion = { eventCount: 0, accelerationSamples: 0, gravitySamples: 0, nullRotationRateEvents: 0, rotationRateSamples: [] };
  const orientation = { eventCount: 0, absoluteSamples: 0, samples: [] };
  const generic = { state: typeof window.Gyroscope === "function" ? "starting" : "unsupported", readings: [], error: null };
  let gyroSensor = null;

  const onMotion = (event) => {
    motion.eventCount++;
    if (event.acceleration) motion.accelerationSamples++;
    if (event.accelerationIncludingGravity) motion.gravitySamples++;
    if (!event.rotationRate) { motion.nullRotationRateEvents++; return; }
    const sample = {
      alpha: finiteOrNull(event.rotationRate.alpha),
      beta: finiteOrNull(event.rotationRate.beta),
      gamma: finiteOrNull(event.rotationRate.gamma),
      timeMs: Math.round(performance.now() - startedPerf),
    };
    if ([sample.alpha, sample.beta, sample.gamma].some((value) => value !== null)) motion.rotationRateSamples.push(sample);
    else motion.nullRotationRateEvents++;
  };
  const onOrientation = (event) => {
    orientation.eventCount++;
    if (event.absolute === true) orientation.absoluteSamples++;
    const sample = {
      alpha: finiteOrNull(event.alpha), beta: finiteOrNull(event.beta), gamma: finiteOrNull(event.gamma),
      timeMs: Math.round(performance.now() - startedPerf),
    };
    if ([sample.alpha, sample.beta, sample.gamma].some((value) => value !== null)) orientation.samples.push(sample);
  };
  window.addEventListener("devicemotion", onMotion, { passive: true });
  window.addEventListener("deviceorientation", onOrientation, { passive: true });

  if (typeof window.Gyroscope === "function") {
    try {
      gyroSensor = new window.Gyroscope({ frequency: 60 });
      gyroSensor.addEventListener("activate", () => { generic.state = "active"; });
      gyroSensor.addEventListener("reading", () => {
        const sample = { x: finiteOrNull(gyroSensor.x), y: finiteOrNull(gyroSensor.y), z: finiteOrNull(gyroSensor.z), timeMs: Math.round(performance.now() - startedPerf) };
        if ([sample.x, sample.y, sample.z].some((value) => value !== null)) {
          generic.readings.push(sample);
          if (generic.state === "starting") generic.state = "active";
        }
      });
      gyroSensor.addEventListener("error", (event) => {
        generic.state = "error";
        generic.error = sensorError(event.error || event);
      });
      gyroSensor.start();
    } catch (error) {
      generic.state = "error";
      generic.error = sensorError(error);
    }
  }

  try {
    const permissionNames = ["accelerometer", "gyroscope", "magnetometer"];
    const permissionStatesPromise = Promise.all(permissionNames.map(async (name) => [name, await querySensorPermission(name)]));
    await new Promise((resolve) => window.setTimeout(resolve, 6000));
    window.removeEventListener("devicemotion", onMotion);
    window.removeEventListener("deviceorientation", onOrientation);
    try { gyroSensor?.stop(); } catch { /* sensor may already have stopped after an error */ }
    const [permissionEntries, motionPermission, orientationPermission] = await Promise.all([
      permissionStatesPromise, motionPermissionPromise, orientationPermissionPromise,
    ]);

    let deviceInfo = { platform: navigator.userAgentData?.platform || navigator.platform || null, mobile: navigator.userAgentData?.mobile ?? null, brands: navigator.userAgentData?.brands || null };
    try {
      const highEntropy = await navigator.userAgentData?.getHighEntropyValues?.(["model", "platformVersion", "fullVersionList"]);
      if (highEntropy) deviceInfo = { ...deviceInfo, ...highEntropy };
    } catch { /* browser identity details are optional */ }

    const rotationRate = summarizeSamples(motion.rotationRateSamples);
    const orientationSummary = summarizeSamples(orientation.samples);
    const gyroSummary = summarizeSamples(generic.readings);
    let diagnosis;
    if (gyroSummary.count > 0 || rotationRate.count > 0) {
      diagnosis = { code: "gyro_readable", message: `已读到旋转数据（DeviceMotion ${rotationRate.count} 条，Generic Gyroscope ${gyroSummary.count} 条）` };
    } else if (orientationSummary.count > 0) {
      diagnosis = { code: "orientation_only", message: `没有角速度读数，但浏览器提供了 ${orientationSummary.count} 条方向角` };
    } else if (motion.accelerationSamples + motion.gravitySamples > 0) {
      diagnosis = { code: "acceleration_only", message: "读到了加速度，但浏览器没有提供角速度或方向角" };
    } else {
      diagnosis = { code: "no_motion_data", message: "没有收到运动事件；请检查浏览器传感器权限或系统限制" };
    }
    if (generic.state === "starting") generic.state = "no_readings";
    const report = {
      schemaVersion: 1,
      testId: crypto.randomUUID(),
      startedAt,
      durationMs: Math.round(performance.now() - startedPerf),
      browser: {
        secureContext: window.isSecureContext,
        visibilityState: document.visibilityState,
        userAgent: navigator.userAgent,
        device: deviceInfo,
        apiSupport: {
          deviceMotionEvent: typeof window.DeviceMotionEvent === "function",
          deviceOrientationEvent: typeof window.DeviceOrientationEvent === "function",
          genericGyroscope: typeof window.Gyroscope === "function",
          permissionsQuery: typeof navigator.permissions?.query === "function",
        },
      },
      permissions: {
        states: Object.fromEntries(permissionEntries),
        requests: { deviceMotion: motionPermission, deviceOrientation: orientationPermission },
      },
      deviceMotion: {
        eventCount: motion.eventCount,
        accelerationSamples: motion.accelerationSamples,
        gravitySamples: motion.gravitySamples,
        nullRotationRateEvents: motion.nullRotationRateEvents,
        rotationRate: rotationRate.count ? rotationRate : { ...rotationRate, maxMagnitude: null },
        rotationRateUnits: "degrees_per_second",
      },
      deviceOrientation: {
        eventCount: orientation.eventCount,
        absoluteSamples: orientation.absoluteSamples,
        orientation: orientationSummary,
        orientationUnits: "degrees",
      },
      genericGyroscope: {
        state: generic.state,
        readings: gyroSummary,
        units: "radians_per_second",
        error: generic.error,
      },
      diagnosis,
    };
    const saved = await api("/api/spatial/sensor-test", { method: "POST", body: JSON.stringify({ report }) });
    report.reportId = saved.reportId;
    renderSensorTest(report);
  } catch (error) {
    window.removeEventListener("devicemotion", onMotion);
    window.removeEventListener("deviceorientation", onOrientation);
    try { gyroSensor?.stop(); } catch { /* best effort cleanup */ }
    setMessage("sensor-test-status", `测试未能保存：${error.message}`, true);
  } finally {
    state.sensorTestRunning = false;
    button.disabled = false;
    button.textContent = "再测一次";
  }
}

async function startCamera() {
  if (!window.isSecureContext) throw new Error("相机与运动传感器需要通过 HTTPS 页面访问。");
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器没有可用的相机接口。");
  if (!/Android/i.test(navigator.userAgent)) setMessage("global-status", "当前诊断目标是 Android 手机；请在手机 Chrome 中完成实测。", true);

  const button = $("camera-button");
  button.disabled = true;
  button.textContent = "正在请求相机权限…";
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
    });
    const video = $("camera");
    video.srcObject = state.stream;
    await video.play();
    $("camera-placeholder").hidden = true;
    $("camera-resolution").textContent = `${video.videoWidth} × ${video.videoHeight}`;
    $("camera-button").textContent = "关闭相机";
    $("camera-button").disabled = false;
    $("camera-button").dataset.active = "true";
    $("record-button").disabled = false;
    window.addEventListener("devicemotion", onDeviceMotion, { passive: true });
    startVideoFrameLoop();
    updateSignalCards();
    setMessage("capture-status", "相机已连接。轻轻转动手机，确认陀螺仪和加速度计卡片出现数据。等待约 2 秒后可开始扫描。");
    window.setTimeout(() => {
      if (state.stream && state.motionSamples.length === 0) {
        setMessage("capture-status", "相机已连接，但尚未收到运动事件。请转动手机；若仍无读数，本次诊断会把缺失情况记入后台。", true);
      }
    }, 1800);
  } catch (error) {
    state.stream = null;
    button.disabled = false;
    button.textContent = "开启相机与运动传感器";
    throw new Error(`无法开启相机：${error.message}`);
  }
}

function stopCamera() {
  if (state.recording || state.uploading) return;
  if (state.stream) for (const track of state.stream.getTracks()) track.stop();
  state.stream = null;
  $("camera").srcObject = null;
  $("camera-placeholder").hidden = false;
  $("camera-resolution").textContent = "等待相机";
  $("camera-button").textContent = "开启相机与运动传感器";
  $("camera-button").dataset.active = "false";
  $("record-button").disabled = true;
  updateSignalCards();
}

function startVideoFrameLoop() {
  const video = $("camera");
  if (!state.stream || state.frameCallbackId !== null) return;
  if (typeof video.requestVideoFrameCallback === "function") {
    const onFrame = (now, metadata) => {
      state.frameCallbackId = null;
      if (!state.stream) return;
      if (state.recording && now - state.lastFramePerf >= FRAME_INTERVAL_MS) {
        state.lastFramePerf = now;
        state.currentCapture = captureFrame(now, metadata).catch((error) => setMessage("capture-status", error.message, true));
      }
      state.frameCallbackId = video.requestVideoFrameCallback(onFrame);
    };
    state.frameCallbackId = video.requestVideoFrameCallback(onFrame);
    state.frameCallbackKind = "video";
  } else {
    const onFrame = (now) => {
      state.frameCallbackId = null;
      if (!state.stream) return;
      if (state.recording && now - state.lastFramePerf >= FRAME_INTERVAL_MS) {
        state.lastFramePerf = now;
        state.currentCapture = captureFrame(now, null).catch((error) => setMessage("capture-status", error.message, true));
      }
      state.frameCallbackId = requestAnimationFrame(onFrame);
    };
    state.frameCallbackId = requestAnimationFrame(onFrame);
    state.frameCallbackKind = "animation-frame-fallback";
  }
}

function stopVideoFrameLoop() {
  if (state.frameCallbackId === null) return;
  if (state.frameCallbackKind === "video") $("camera").cancelVideoFrameCallback?.(state.frameCallbackId);
  else cancelAnimationFrame(state.frameCallbackId);
  state.frameCallbackId = null;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图像读取失败"));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.readAsDataURL(blob);
  });
}

async function captureFrame(callbackTime, metadata) {
  if (!state.recording || $("camera").videoWidth === 0) return;
  const video = $("camera");
  const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  context.drawImage(video, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.58));
  if (!blob) throw new Error("无法编码相机图像");

  const grayCanvas = document.createElement("canvas");
  grayCanvas.width = GRAY_WIDTH;
  grayCanvas.height = GRAY_HEIGHT;
  const grayContext = grayCanvas.getContext("2d", { willReadFrequently: true });
  grayContext.drawImage(canvas, 0, 0, GRAY_WIDTH, GRAY_HEIGHT);
  const pixels = grayContext.getImageData(0, 0, GRAY_WIDTH, GRAY_HEIGHT).data;
  const gray = new Uint8Array(GRAY_WIDTH * GRAY_HEIGHT);
  for (let index = 0; index < gray.length; index++) {
    const offset = index * 4;
    gray[index] = Math.round(pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114);
  }
  const frame = {
    index: state.frames.length,
    timeMs: Math.max(0, callbackTime - state.startPerf),
    callbackPerfMs: callbackTime,
    mediaTimeMs: Number.isFinite(metadata?.mediaTime) ? metadata.mediaTime * 1000 : null,
    presentedFrames: Number.isSafeInteger(metadata?.presentedFrames) ? metadata.presentedFrames : null,
    width,
    height,
    grayWidth: GRAY_WIDTH,
    grayHeight: GRAY_HEIGHT,
    grayBase64: bytesToBase64(gray),
    dataBase64: await blobToBase64(blob),
  };
  state.frames.push(frame);
  $("frame-count").textContent = `${state.frames.length} 帧`;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function startRecording() {
  if (!state.stream || state.recording || state.uploading) return;
  state.frames = [];
  state.motionSamples = [];
  state.startPerf = performance.now();
  state.lastFramePerf = 0;
  state.recording = true;
  $("record-button").hidden = true;
  $("stop-button").hidden = false;
  $("camera-button").disabled = true;
  $("recording-badge").hidden = false;
  $("frame-count").textContent = "0 帧";
  $("result-panel").hidden = true;
  setMessage("capture-status", "正在记录图像与手机运动。缓慢平移、转动手机，尽量扫过近处物体和背景。  ");
  state.progressTimer = window.setInterval(() => {
    const elapsed = Math.min(CAPTURE_SECONDS, (performance.now() - state.startPerf) / 1000);
    $("progress-fill").style.width = `${elapsed / CAPTURE_SECONDS * 100}%`;
    setMessage("capture-status", `采集 ${elapsed.toFixed(1)} / ${CAPTURE_SECONDS} 秒 · ${state.frames.length} 帧 · ${state.motionSamples.length} 条运动读数`);
    if (elapsed >= CAPTURE_SECONDS) void finishRecording();
  }, 100);
}

async function finishRecording() {
  if (!state.recording || state.uploading) return;
  state.recording = false;
  state.uploading = true;
  if (state.progressTimer) window.clearInterval(state.progressTimer);
  state.progressTimer = null;
  $("stop-button").disabled = true;
  $("stop-button").textContent = "正在上传与重建…";
  $("recording-badge").hidden = true;
  $("camera-button").disabled = false;
  if (state.currentCapture) await state.currentCapture;
  try {
    setMessage("capture-status", "图像和运动数据已采集，正在上传并尝试恢复三维轨迹……");
    const capture = await buildCapturePayload();
    const result = await api("/api/spatial/capture", { method: "POST", body: JSON.stringify(capture) });
    showResult(result.capture);
    setMessage("capture-status", "采集完成。图像和 IMU 已进入后台记录。");
    setMessage("global-status", result.capture.diagnostics?.statusText || "后台处理完成。");
  } catch (error) {
    setMessage("capture-status", error.message, true);
    setMessage("global-status", "本次结果未能完整上传或重建；服务端会记录已收到的诊断信息。", true);
  } finally {
    state.uploading = false;
    $("stop-button").disabled = false;
    $("stop-button").hidden = true;
    $("stop-button").textContent = "结束并分析";
    $("record-button").hidden = false;
    $("record-button").disabled = !state.stream;
    $("camera-button").disabled = false;
    $("progress-fill").style.width = "0%";
  }
}

async function buildCapturePayload() {
  const sourceSettings = state.stream?.getVideoTracks()[0]?.getSettings?.() || {};
  const settings = Object.fromEntries(["width", "height", "frameRate", "facingMode", "aspectRatio", "resizeMode"]
    .filter((key) => sourceSettings[key] !== undefined)
    .map((key) => [key, sourceSettings[key]]));
  let device = { userAgent: navigator.userAgent.slice(0, 400), platform: navigator.platform || "unknown", language: navigator.language || "unknown" };
  try {
    const highEntropy = await navigator.userAgentData?.getHighEntropyValues?.(["model", "platformVersion", "fullVersionList"]);
    if (highEntropy) device = { ...device, ...highEntropy };
  } catch { /* model metadata is optional */ }
  const samples = state.motionSamples.map(({ timeMs, receivedTimeMs, acceleration, accelerationIncludingGravity, rotationRate }) => ({ timeMs, receivedTimeMs, acceleration, accelerationIncludingGravity, rotationRate }));
  return {
    captureId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - state.startPerf),
    device,
    camera: {
      settings,
      actualWidth: $("camera").videoWidth,
      actualHeight: $("camera").videoHeight,
      frameTimeMethod: state.frameCallbackKind,
      frameTimeBasis: "performance.now at video-frame callback; mediaTime retained when available",
      hardwareExposureTimestampAvailable: false,
      screenOrientationAngle: screen.orientation?.angle ?? null,
    },
    clock: { timeOriginMs: performance.timeOrigin, clockName: "performance.now", sharedByDomMotionEvents: true },
    frames: state.frames,
    motionSamples: samples,
  };
}

function showResult(capture) {
  if (!capture) return;
  const diagnostics = capture.diagnostics || {};
  const model = capture.model || null;
  state.model = model;
  $("result-panel").hidden = false;
  $("result-caption").textContent = diagnostics.statusText || "本轮处理完成";
  const badge = $("model-badge");
  badge.textContent = model?.status === "model_built" ? "稀疏模型已生成" : model?.status === "partial_model" ? "部分模型" : model?.status || "未生成模型";
  badge.dataset.state = model?.status === "model_built" ? "ok" : "warn";

  const metrics = [
    ["相机帧", diagnostics.frameCount ?? 0],
    ["图像频率", diagnostics.cameraFps ? `${diagnostics.cameraFps} fps` : "—"],
    ["运动读数", diagnostics.motionSampleCount ?? 0],
    ["IMU 频率", diagnostics.imuHz ? `${diagnostics.imuHz} Hz` : "—"],
    ["有效重建帧", model?.diagnostics?.acceptedPairs ?? 0],
    ["稀疏点云", model?.points?.length ?? 0],
    ["陀螺仪读数", diagnostics.gyroSampleCount ?? 0],
    ["加速度读数", diagnostics.accelSampleCount ?? 0],
  ];
  const grid = $("result-metrics");
  grid.replaceChildren();
  for (const [label, value] of metrics) {
    const card = document.createElement("div");
    card.className = "metric";
    const title = document.createElement("span");
    title.textContent = label;
    const number = document.createElement("strong");
    number.textContent = String(value);
    card.append(title, number);
    grid.append(card);
  }

  $("result-note").textContent = model?.notes?.join(" ") || diagnostics.statusText || "结果已经保存。";
  $("diagnostic-output").textContent = JSON.stringify({ diagnostics, model: model ? { ...model, points: `[${model.points?.length ?? 0} points]` } : null, capture: capture.metadata }, null, 2);
  $("model-empty").hidden = Boolean(model?.points?.length);
  $("download-model").disabled = !(model?.points?.length);
  drawModel();
  $("result-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function drawModel() {
  const canvas = $("model-canvas");
  const context = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  context.clearRect(0, 0, width, height);
  const points = state.model?.points || [];
  const poses = state.model?.cameraPositions || [];
  if (!points.length && !poses.length) return;
  const all = [...points.map((point) => point.slice(0, 3)), ...poses.map((pose) => pose.position)];
  const mins = [0, 1, 2].map((axis) => Math.min(...all.map((point) => point[axis])));
  const maxs = [0, 1, 2].map((axis) => Math.max(...all.map((point) => point[axis])));
  const center = mins.map((value, axis) => (value + maxs[axis]) / 2);
  const span = Math.max(0.001, ...mins.map((value, axis) => maxs[axis] - value));
  const scale = Math.min(width, height) * 0.34 / span * state.view.zoom;
  const cy = Math.cos(state.view.yaw), sy = Math.sin(state.view.yaw);
  const cp = Math.cos(state.view.pitch), sp = Math.sin(state.view.pitch);
  const project = (point) => {
    const x = (point[0] - center[0]) * cy - (point[2] - center[2]) * sy;
    const z = (point[0] - center[0]) * sy + (point[2] - center[2]) * cy;
    const y = (point[1] - center[1]) * cp - z * sp;
    const depth = (point[1] - center[1]) * sp + z * cp;
    return { x: width / 2 + x * scale, y: height / 2 - y * scale, depth };
  };
  context.strokeStyle = "#495747";
  context.lineWidth = Math.max(1, dpr);
  if (poses.length > 1) {
    context.beginPath();
    poses.forEach((pose, index) => {
      const projected = project(pose.position);
      if (index === 0) context.moveTo(projected.x, projected.y); else context.lineTo(projected.x, projected.y);
    });
    context.stroke();
  }
  const sorted = points.map((point) => ({ point, projected: project(point) })).sort((a, b) => a.projected.depth - b.projected.depth);
  for (const { point, projected } of sorted) {
    const depthSize = Math.max(1.2 * dpr, Math.min(3.7 * dpr, 2.4 * dpr - projected.depth * 0.1 * dpr));
    const r = Number.isFinite(point[3]) ? point[3] : 201;
    const g = Number.isFinite(point[4]) ? point[4] : 243;
    const b = Number.isFinite(point[5]) ? point[5] : 106;
    context.fillStyle = `rgba(${r},${g},${b},0.78)`;
    context.beginPath();
    context.arc(projected.x, projected.y, depthSize, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = "#ff795b";
  for (const pose of poses) {
    const projected = project(pose.position);
    context.beginPath();
    context.arc(projected.x, projected.y, 3 * dpr, 0, Math.PI * 2);
    context.fill();
  }
}

function downloadPointCloud() {
  const points = state.model?.points;
  if (!points?.length) return;
  const header = [
    "ply", "format ascii 1.0", `element vertex ${points.length}`,
    "property float x", "property float y", "property float z",
    "property uchar red", "property uchar green", "property uchar blue", "end_header",
  ].join("\n");
  const rows = points.map((point) => `${point[0]} ${point[1]} ${point[2]} ${Math.round(point[3] ?? 201)} ${Math.round(point[4] ?? 243)} ${Math.round(point[5] ?? 106)}`);
  const url = URL.createObjectURL(new Blob([`${header}\n${rows.join("\n")}\n`], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "spatial-point-cloud.ply";
  link.click();
  URL.revokeObjectURL(url);
}

function resetForNextCapture() {
  state.model = null;
  state.frames = [];
  state.motionSamples = [];
  $("frame-count").textContent = "0 帧";
  $("result-panel").hidden = true;
  $("record-button").disabled = !state.stream;
  setMessage("global-status", "可以开始下一段采集。");
}

function drawMotionChart() {
  const canvas = $("motion-chart");
  const context = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#303b30";
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  if (state.chartValues.length < 2) return;
  context.strokeStyle = "#c9f36a";
  context.lineWidth = 1.5 * dpr;
  context.beginPath();
  state.chartValues.forEach((value, index) => {
    const x = index / (state.chartValues.length - 1) * width;
    const y = height - 4 * dpr - value * (height - 8 * dpr);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.stroke();
}

$("login-button").addEventListener("click", () => void login());
$("passcode").addEventListener("keydown", (event) => { if (event.key === "Enter") void login(); });
$("sensor-test-button").addEventListener("click", () => void runSensorTest());
$("camera-button").addEventListener("click", () => {
  if ($( "camera-button").dataset.active === "true") stopCamera();
  else void startCamera().catch((error) => setMessage("capture-status", error.message, true));
});
$("record-button").addEventListener("click", startRecording);
$("stop-button").addEventListener("click", () => void finishRecording());
$("download-model").addEventListener("click", downloadPointCloud);
$("new-capture").addEventListener("click", resetForNextCapture);
$("model-canvas").addEventListener("pointerdown", (event) => { state.drag = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); });
$("model-canvas").addEventListener("pointermove", (event) => {
  if (!state.drag) return;
  state.view.yaw += (event.clientX - state.drag.x) * 0.009;
  state.view.pitch = Math.max(-1.4, Math.min(1.4, state.view.pitch + (event.clientY - state.drag.y) * 0.009));
  state.drag = { x: event.clientX, y: event.clientY };
  drawModel();
});
$("model-canvas").addEventListener("pointerup", () => { state.drag = null; });
$("model-canvas").addEventListener("wheel", (event) => { event.preventDefault(); state.view.zoom = Math.max(0.5, Math.min(2.5, state.view.zoom * (event.deltaY < 0 ? 1.08 : 0.93))); drawModel(); }, { passive: false });
window.addEventListener("resize", () => { drawModel(); drawMotionChart(); });
window.addEventListener("pagehide", () => {
  if (state.progressTimer) window.clearInterval(state.progressTimer);
  stopVideoFrameLoop();
  if (state.stream) for (const track of state.stream.getTracks()) track.stop();
  window.removeEventListener("devicemotion", onDeviceMotion);
});

updateSignalCards();
drawMotionChart();
void restoreSession();
