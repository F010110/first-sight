const $ = (id) => document.getElementById(id);

const DIRECTIONS = ['front', 'left', 'right'];
const DIR_LABEL = { front: '正前方', left: '左侧', right: '右侧' };
const MODE_LABEL = { describe: '多视角描述', ocr: '读文字', identify: '识别物品', custom: '自由提问' };

const lastFrameIds = new Map();
const spokenIds = new Set();
let currentUrls = [];
let selectedUrl = '';
let lastQrUrl = '';
let hostInputsSeeded = false;

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

async function apiJson(path, body) {
  const opts = body === undefined
    ? {}
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return data;
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

function renderCameras(cameras) {
  if (!Array.isArray(cameras)) return;
  let onlineCount = 0;
  for (const cam of cameras) {
    const dir = cam.direction;
    if (!DIRECTIONS.includes(dir)) continue;
    if (cam.status === 'online') onlineCount++;

    const badge = $('badge-' + dir);
    const statusMap = {
      online: '在线',
      stale: '已延迟',
      error: '连接异常',
      waiting: '等待信号',
      unconfigured: '未配对',
    };
    badge.textContent = cam.source === 'manual' ? '测试图' : (statusMap[cam.status] || cam.status);
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
  $('cam-summary').textContent = `当前在线视角：${onlineCount} / 3`;
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
    ? `HTTPS 隧道已就绪：${conn.tunnelUrl}（支持 iPhone/Android 网页麦克风）`
    : conn.tunnelError
      ? `隧道未启用（${conn.tunnelError}），当前使用局域网直连。`
      : '提示：如需外网 HTTPS / 网页麦克风，可用 npm run demo:tunnel 启动。';
}

function renderLocate(locate) {
  if (!locate) return;
  $('locate-status').textContent = locate.message || '空闲';
  $('btn-locate').disabled = !!locate.running;
}

function renderHistory(records) {
  const feed = $('qa-feed');
  if (!Array.isArray(records) || !records.length) {
    feed.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '暂无问答记录，点击上方按钮或用手机触发即可开始演示。';
    feed.append(empty);
    return;
  }

  feed.replaceChildren();
  for (const item of [...records].reverse()) {
    const card = document.createElement('article');
    card.className = 'qa-item';

    const meta = document.createElement('div');
    meta.className = 'qa-meta';
    const dirs = (item.directions || []).map((d) => DIR_LABEL[d] || d).join(' / ');
    meta.textContent = `${new Date(item.createdAtMs).toLocaleTimeString()} · ${MODE_LABEL[item.mode] || item.mode} · 视角: ${dirs} · ${item.latencyMs}ms (${item.model})`;

    const q = document.createElement('div');
    q.className = 'qa-q';
    q.textContent = `问：${item.question}`;

    const a = document.createElement('div');
    a.className = 'qa-a';
    a.textContent = item.answer;

    const thumbs = document.createElement('div');
    thumbs.className = 'qa-thumbs';
    for (const ev of item.evidenceUrls || []) {
      const link = document.createElement('a');
      link.className = 'qa-thumb';
      link.href = ev.url;
      link.target = '_blank';
      link.rel = 'noopener';
      const img = document.createElement('img');
      img.src = ev.url;
      img.alt = DIR_LABEL[ev.direction] || ev.direction;
      const cap = document.createElement('span');
      cap.textContent = DIR_LABEL[ev.direction] || ev.direction;
      link.append(img, cap);
      thumbs.append(link);
    }

    const actions = document.createElement('div');
    const replayBtn = document.createElement('button');
    replayBtn.type = 'button';
    replayBtn.textContent = '重播到手机';
    replayBtn.addEventListener('click', async () => {
      try {
        showError('');
        await apiJson('/api/speak', { text: item.spokenText || item.answer, answerId: item.id });
      } catch (err) {
        showError(err.message);
      }
    });
    actions.append(replayBtn);

    card.append(meta, q, a, thumbs, actions);
    feed.append(card);
  }
}

function renderState(state) {
  if (!state) return;
  const mobilePill = $('pill-mobile');
  const mCount = state.mobileClients || 0;
  mobilePill.textContent = `手机语音端：${mCount} 台已连接`;
  mobilePill.className = 'pill ' + (mCount > 0 ? 'ok' : 'warn');

  const qwenPill = $('pill-qwen');
  qwenPill.textContent = state.qwenConfigured ? 'Qwen API：已配置' : 'Qwen API：未配置密钥';
  qwenPill.className = 'pill ' + (state.qwenConfigured ? 'ok' : 'err');

  const busy = !!state.askBusy;
  $('ask-status').textContent = busy ? 'Qwen 正在分析画面…' : '空闲';
  for (const id of ['btn-describe', 'btn-ocr', 'btn-identify', 'btn-ask']) {
    $(id).disabled = busy;
  }

  renderCameras(state.cameras);
  renderLocate(state.locate);
  renderConnection(state.connection);
  renderHistory(state.history);
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
    const state = await apiJson('/api/state');
    renderState(state);
  } catch (err) {
    showError(err.message);
  }
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
      speakOnDesktopIfEnabled(record.spokenText || record.answer, record.speakId);
    } catch {
      /* ignore */
    }
  });
}

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
    const jpegBase64 = btoa(bin);
    await apiJson('/api/cameras/inject', {
      direction: $('manual-dir').value,
      jpegBase64,
    });
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
