import {
  DIRECTIONS,
  DIR_LABEL,
  MODE_LABEL,
  STATUS_LABEL,
  apiJson,
  createEvidenceThumbs,
  createFeedCard,
  formatTime,
} from './shared.js';

const $ = (id) => document.getElementById(id);

const lastFrameIds = new Map();
const spokenIds = new Set();
let currentUrls = [];
let selectedUrl = '';
let lastQrUrl = '';
let hostInputsSeeded = false;
let webcamStream = null;
let webcamTimer = null;
let heroReplayPayload = null;
let latestState = null;

function showError(message) {
  const banner = $('error-banner');
  if (!message) {
    banner.hidden = true;
    banner.textContent = '';
    return;
  }
  banner.textContent = message;
  banner.hidden = false;
}

function pulseStage(stageId, detailText) {
  const el = $(stageId);
  el.classList.add('active');
  if (detailText) {
    $(stageId + '-detail').textContent = detailText;
  }
  setTimeout(() => {
    el.classList.remove('active');
    if (latestState) renderPipeline(latestState);
  }, 1800);
}

function speakOnDesktopIfEnabled(text, speakId) {
  if (!$('desktop-tts').checked || !text || typeof speechSynthesis === 'undefined') return;
  if (speakId && spokenIds.has(speakId)) return;
  if (speakId) spokenIds.add(speakId);
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

async function replayToPhone(text, answerId) {
  try {
    showError('');
    const res = await apiJson('/api/speak', { text, answerId });
    pulseStage('stage-phone', `已重播至 ${res.deliveredToMobileClients} 台手机`);
  } catch (err) {
    showError(err.message);
  }
}

function renderPipeline(state) {
  const cams = state.cameras || [];
  const onlineCams = cams.filter((c) => c.status === 'online');
  const hwEl = $('stage-hw');
  const manualCount = onlineCams.filter((c) => c.source === 'manual').length;
  hwEl.className = 'stage-step ' + (onlineCams.length > 0 ? 'ok' : 'warn');
  $('stage-hw-detail').textContent = onlineCams.length
    ? `${onlineCams.length}/3 在线${manualCount ? ` (${manualCount} 路测试图)` : ''}`
    : '等待相机连接';

  const compEl = $('stage-compute');
  if (state.askBusy) {
    compEl.className = 'stage-step active';
    $('stage-compute-detail').textContent = 'Qwen 多视角分析中…';
  } else if (state.watch?.status === 'active') {
    compEl.className = 'stage-step active';
    $('stage-compute-detail').textContent = `Watch 监测中 (${state.watch.checks} 次)`;
  } else if (!state.qwenConfigured) {
    compEl.className = 'stage-step warn';
    $('stage-compute-detail').textContent = '未配置密钥';
  } else {
    compEl.className = 'stage-step ok';
    $('stage-compute-detail').textContent = 'Qwen3.8-Flash 待命';
  }

  const totalOut = (state.history?.length || 0) + (state.watch?.status === 'triggered' ? 1 : 0);
  const webEl = $('stage-web');
  webEl.className = 'stage-step ' + (totalOut > 0 ? 'ok' : '');
  $('stage-web-detail').textContent = totalOut > 0 ? `已展示 ${totalOut} 条输出` : '等待首次输出';

  const mCount = state.mobileClients || 0;
  const phoneEl = $('stage-phone');
  phoneEl.className = 'stage-step ' + (mCount > 0 ? 'ok' : 'warn');
  $('stage-phone-detail').textContent = mCount > 0 ? `${mCount} 台手机语音待命` : '等待手机扫码';
}

function renderCameras(cameras) {
  if (!Array.isArray(cameras)) return;
  let onlineCount = 0;
  for (const cam of cameras) {
    const dir = cam.direction;
    if (!DIRECTIONS.includes(dir)) continue;
    if (cam.status === 'online') onlineCount++;

    const badge = $('badge-' + dir);
    badge.textContent = cam.source === 'manual' ? '测试图' : (STATUS_LABEL[cam.status] || cam.status);
    badge.className = 'cam-badge ' + cam.status;

    const info = $('info-' + dir);
    info.textContent = cam.error
      ? `IP: ${cam.host || '未定位'} · ${cam.error}`
      : `IP: ${cam.host || '未定位'}${cam.cameraId ? ` · ${cam.cameraId}` : ''}`;

    const ageEl = $('age-' + dir);
    if (cam.lastFrameAtMs) {
      const sec = Math.max(0, (Date.now() - cam.lastFrameAtMs) / 1000).toFixed(1);
      ageEl.textContent = `${sec}s 前`;
    } else {
      ageEl.textContent = '--';
    }

    if (cam.lastFrameId && lastFrameIds.get(dir) !== cam.lastFrameId) {
      lastFrameIds.set(dir, cam.lastFrameId);
      const img = $('img-' + dir);
      img.src = `/api/frame/${dir}?v=${encodeURIComponent(cam.lastFrameId)}`;
      img.hidden = false;
      $('empty-' + dir).hidden = true;
    }

    const hostInput = $('host-' + dir);
    if (!hostInputsSeeded && cam.host && cam.host !== 'manual-upload' && document.activeElement !== hostInput) {
      hostInput.value = cam.host;
    }
  }
  if (cameras.some((c) => c.host && c.host !== 'manual-upload')) {
    hostInputsSeeded = true;
  }
  $('cam-summary').textContent = `${onlineCount} / 3 在线`;
  $('offline-hint').hidden = onlineCount > 0;
}

function renderConnection(conn) {
  if (!conn || !Array.isArray(conn.urls)) return;
  const serialized = JSON.stringify(conn.urls);
  const select = $('url-select');
  if (JSON.stringify(currentUrls) !== serialized) {
    currentUrls = conn.urls;
    select.replaceChildren();
    for (const item of currentUrls) {
      const opt = document.createElement('option');
      opt.value = item.url;
      opt.textContent = item.label;
      select.append(opt);
    }
    if (!selectedUrl || !currentUrls.some((u) => u.url === selectedUrl)) {
      selectedUrl = conn.primaryUrl;
    }
    select.value = selectedUrl;
  }

  const activeUrl = selectedUrl || conn.primaryUrl;
  $('pair-url').textContent = activeUrl;
  if (activeUrl !== lastQrUrl) {
    lastQrUrl = activeUrl;
    if (activeUrl === conn.primaryUrl && conn.primaryQrSvg) {
      $('qr-img').src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(conn.primaryQrSvg);
    } else {
      $('qr-img').src = '/api/qr?url=' + encodeURIComponent(activeUrl);
    }
  }

  $('tunnel-note').textContent = conn.tunnelUrl
    ? `HTTPS 隧道就绪：${conn.tunnelUrl}`
    : conn.tunnelError
      ? `隧道未启用（${conn.tunnelError}），使用局域网直连。`
      : '若校园网设备隔离或需手机麦克风，请用 npm run demo:tunnel。';
}

function renderLocate(locate) {
  if (!locate) return;
  $('locate-status').textContent = locate.message || '空闲';
  $('btn-locate').disabled = !!locate.running;
}

function renderWatch(watch) {
  const panel = $('watch-panel');
  const badge = $('watch-badge');
  const statusEl = $('watch-status');
  const cancelBtn = $('btn-watch-cancel');
  if (!watch) {
    panel.className = 'watch-panel';
    badge.className = 'pill';
    badge.textContent = '未开启';
    statusEl.textContent = '每 4 秒检查新画面（无新帧零调用），命中目标即刻推手机报警。';
    cancelBtn.disabled = true;
    return;
  }

  const map = {
    active: ['pill warn', '关注中'],
    triggered: ['pill ok', '已命中'],
    cancelled: ['pill', '已取消'],
    expired: ['pill', '已到期'],
    failed: ['pill err', '失败'],
  };
  const [cls, label] = map[watch.status] || ['pill', watch.status];
  badge.className = cls;
  badge.textContent = label;
  panel.className = watch.status === 'triggered' ? 'watch-panel triggered' : 'watch-panel';
  cancelBtn.disabled = watch.status !== 'active';

  if (watch.status === 'active') {
    const leftSec = Math.max(0, Math.ceil((watch.expiresAtMs - Date.now()) / 1000));
    statusEl.textContent = `目标“${watch.target}”监控中 · 已查 ${watch.checks} 次 · 剩余 ${leftSec}s`;
  } else if (watch.status === 'triggered' && watch.alert) {
    statusEl.textContent = `已触发提醒：${watch.alert.spokenText}`;
  } else if (watch.status === 'failed') {
    statusEl.textContent = `关注失败：${watch.error || '未知错误'}`;
  } else {
    statusEl.textContent = `目标“${watch.target}”已${label}（共查 ${watch.checks} 次）。`;
  }
}

function buildSortedEntries(records, watch) {
  const items = [];
  for (const r of records || []) {
    items.push({ kind: 'qa', createdAtMs: r.createdAtMs, record: r });
  }
  if (watch?.status === 'triggered' && watch.alert) {
    items.push({ kind: 'watch-alert', createdAtMs: watch.alert.createdAtMs, record: watch.alert });
  }
  items.sort((x, y) => y.createdAtMs - x.createdAtMs);
  return items;
}

function renderHeroAndFeed(records, watch) {
  const entries = buildSortedEntries(records, watch);
  const heroBox = $('hero-output');
  const heroThumbs = $('hero-thumbs');
  heroThumbs.replaceChildren();

  if (!entries.length) {
    heroBox.className = 'hero-output';
    $('hero-meta-text').textContent = '最新输出结果（同步推送至手机朗读）';
    $('hero-text').textContent = '等待触发… 点击下方按钮或通过手机端发起视觉识别。';
    $('btn-hero-replay').hidden = true;
    heroReplayPayload = null;
  } else {
    const latest = entries[0];
    const rec = latest.record;
    const isAlert = latest.kind === 'watch-alert';
    heroBox.className = isAlert ? 'hero-output alert-mode' : 'hero-output';
    if (isAlert) {
      $('hero-meta-text').textContent = `${formatTime(rec.createdAtMs)} · Watch 目标命中（${rec.direction}）· ${rec.latencyMs}ms`;
      $('hero-text').textContent = rec.spokenText;
    } else {
      const dirs = (rec.directions || []).map((d) => DIR_LABEL[d] || d).join(' / ');
      $('hero-meta-text').textContent = `${formatTime(rec.createdAtMs)} · ${MODE_LABEL[rec.mode] || rec.mode} · 视角: ${dirs} · ${rec.latencyMs}ms`;
      $('hero-text').textContent = rec.answer;
    }
    if (rec.evidenceUrls?.length) {
      heroThumbs.append(createEvidenceThumbs(rec.evidenceUrls));
    }
    heroReplayPayload = { text: rec.spokenText || rec.answer, id: rec.id };
    $('btn-hero-replay').hidden = false;
  }

  const feed = $('qa-feed');
  feed.replaceChildren();
  const older = entries.slice(1);
  if (!older.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = entries.length ? '以上为最新结果，继续提问将在此展示历史记录。' : '暂无历史记录。';
    feed.append(empty);
    return;
  }
  for (const entry of older) {
    feed.append(createFeedCard(entry, { onReplay: (text, id) => void replayToPhone(text, id) }));
  }
}

function renderState(state) {
  if (!state) return;
  latestState = state;
  const mobilePill = $('pill-mobile');
  const mCount = state.mobileClients || 0;
  mobilePill.textContent = `手机端：${mCount} 台`;
  mobilePill.className = 'pill ' + (mCount > 0 ? 'ok' : 'warn');

  const qwenPill = $('pill-qwen');
  qwenPill.textContent = state.qwenConfigured ? 'Qwen API：已就绪' : 'Qwen API：未配置密钥';
  qwenPill.className = 'pill ' + (state.qwenConfigured ? 'ok' : 'err');

  const busy = !!state.askBusy;
  $('ask-status').textContent = busy ? 'Qwen 正在分析画面…' : '空闲';
  for (const id of ['btn-describe', 'btn-ocr', 'btn-identify', 'btn-ask']) {
    $(id).disabled = busy;
  }

  renderPipeline(state);
  renderCameras(state.cameras);
  renderLocate(state.locate);
  renderWatch(state.watch);
  renderConnection(state.connection);
  renderHeroAndFeed(state.history, state.watch);
}

async function triggerAsk(mode, question = '') {
  showError('');
  $('ask-status').textContent = 'Qwen 正在分析画面…';
  try {
    await apiJson('/api/ask', { mode, question, source: 'desktop' });
    await refreshState();
  } catch (err) {
    showError(err.message);
  }
}

async function refreshState() {
  try {
    renderState(await apiJson('/api/state'));
  } catch (err) {
    showError(err.message);
  }
}

function setDrawerOpen(open) {
  $('setup-drawer').hidden = !open;
  $('btn-toggle-drawer').textContent = open ? '收起设备与扫码配置' : '展开设备与扫码配置';
}

function connectEvents() {
  const es = new EventSource('/api/events?client=desktop');
  es.addEventListener('state', (evt) => {
    try {
      renderState(JSON.parse(evt.data));
    } catch {
      /* ignore */
    }
  });
  es.addEventListener('locate', (evt) => {
    try {
      renderLocate(JSON.parse(evt.data));
    } catch {
      /* ignore */
    }
  });
  es.addEventListener('answer', (evt) => {
    try {
      const record = JSON.parse(evt.data);
      pulseStage('stage-web', '已更新最新输出');
      pulseStage('stage-phone', `已推送至 ${latestState?.mobileClients || 0} 台手机`);
      speakOnDesktopIfEnabled(record.spokenText || record.answer, record.speakId);
    } catch {
      /* ignore */
    }
  });
  es.addEventListener('watch-alert', (evt) => {
    try {
      const alert = JSON.parse(evt.data);
      pulseStage('stage-web', 'Watch 命中提醒');
      pulseStage('stage-phone', `已推送至 ${latestState?.mobileClients || 0} 台手机`);
      speakOnDesktopIfEnabled(alert.spokenText, alert.speakId);
    } catch {
      /* ignore */
    }
  });
}

async function toggleWebcam() {
  const btn = $('btn-webcam');
  if (webcamStream) {
    clearInterval(webcamTimer);
    webcamTimer = null;
    for (const track of webcamStream.getTracks()) track.stop();
    webcamStream = null;
    btn.textContent = '开启本机摄像头推流至正前方';
    btn.className = '';
    return;
  }
  showError('');
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    const video = $('webcam-video');
    video.srcObject = webcamStream;
    await video.play();
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');

    const pushFrame = async () => {
      if (!webcamStream || !video.videoWidth) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
      if (!blob) return;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      await apiJson('/api/cameras/inject', { direction: 'front', jpegBase64: btoa(bin) });
    };

    await pushFrame();
    webcamTimer = setInterval(() => void pushFrame().catch(() => {}), 1500);
    btn.textContent = '停止本机摄像头推流';
    btn.className = 'danger';
  } catch (err) {
    showError(`无法打开本机摄像头：${err.message}`);
  }
}

$('btn-presentation').addEventListener('click', () => {
  const next = !document.body.classList.contains('presentation-mode');
  document.body.classList.toggle('presentation-mode', next);
  $('btn-presentation').textContent = next ? '退出演示模式' : '演示模式';
  $('btn-toggle-drawer').hidden = next;
});

$('btn-toggle-drawer').addEventListener('click', () => {
  setDrawerOpen($('setup-drawer').hidden);
});

$('btn-open-drawer-hint').addEventListener('click', () => {
  document.body.classList.remove('presentation-mode');
  $('btn-presentation').textContent = '演示模式';
  $('btn-toggle-drawer').hidden = false;
  setDrawerOpen(true);
});

$('btn-hero-replay').addEventListener('click', () => {
  if (heroReplayPayload) void replayToPhone(heroReplayPayload.text, heroReplayPayload.id);
});

$('url-select').addEventListener('change', (e) => {
  selectedUrl = e.target.value;
  $('pair-url').textContent = selectedUrl;
  $('qr-img').src = '/api/qr?url=' + encodeURIComponent(selectedUrl);
  lastQrUrl = selectedUrl;
});

$('btn-locate').addEventListener('click', async () => {
  showError('');
  const raw = $('subnet-input').value.trim();
  const subnets = raw ? raw.split(/[,，\s]+/).filter(Boolean) : [];
  try {
    await apiJson('/api/cameras/locate', { subnets, force: true });
  } catch (err) {
    showError(err.message);
  }
});

$('hosts-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  try {
    await apiJson('/api/cameras/hosts', {
      front: $('host-front').value.trim(),
      left: $('host-left').value.trim(),
      right: $('host-right').value.trim(),
    });
    await refreshState();
  } catch (err) {
    showError(err.message);
  }
});

$('btn-test-voice').addEventListener('click', async () => {
  showError('');
  try {
    const res = await apiJson('/api/speak', { text: 'First Sight 手机语音连接正常，可以开始演示。' });
    pulseStage('stage-phone', `测试播报已发往 ${res.deliveredToMobileClients} 台手机`);
    if (res.deliveredToMobileClients === 0) {
      showError('已发送测试播报，但当前没有手机端在线连接，请先用手机扫码打开页面。');
    }
  } catch (err) {
    showError(err.message);
  }
});

$('btn-describe').addEventListener('click', () => void triggerAsk('describe'));
$('btn-ocr').addEventListener('click', () => void triggerAsk('ocr'));
$('btn-identify').addEventListener('click', () => void triggerAsk('identify'));

$('ask-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('ask-input').value.trim();
  if (!q) return;
  $('ask-input').value = '';
  void triggerAsk('custom', q);
});

$('watch-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const target = $('watch-input').value.trim();
  const ttlSeconds = Number($('watch-ttl').value || '90');
  if (!target) {
    showError('请输入需要持续关注的目标名称');
    return;
  }
  try {
    await apiJson('/api/watch/start', { target, ttlSeconds });
    await refreshState();
  } catch (err) {
    showError(err.message);
  }
});

$('btn-watch-cancel').addEventListener('click', async () => {
  showError('');
  try {
    await apiJson('/api/watch/cancel', {});
    await refreshState();
  } catch (err) {
    showError(err.message);
  }
});

$('btn-webcam').addEventListener('click', () => void toggleWebcam());

$('manual-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  showError('');
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    await apiJson('/api/cameras/inject', { direction: $('manual-dir').value, jpegBase64: btoa(bin) });
    await refreshState();
  } catch (err) {
    showError(err.message);
  } finally {
    e.target.value = '';
  }
});

connectEvents();
void refreshState();
setInterval(() => void refreshState(), 2500);
