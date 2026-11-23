import { apiJson, formatTime } from '/shared.js';

function speakText(text) {
  if (!text || !('speechSynthesis' in window)) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

async function apiFetch(path, opts = {}) {
  const body = opts.body ? JSON.parse(opts.body) : undefined;
  return apiJson(path, body);
}

(() => {
  const DIRECTIONS = ['front', 'left', 'right'];
  const DIR_LABEL = { front: '正前方', left: '左侧', right: '右侧' };

  let currentState = null;
  let lastRecord = null;
  let latestHistoryId = '';
  let frameVersion = { front: '', left: '', right: '' };
  let toastTimer = null;

  const $ = (id) => document.getElementById(id);

  function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function formatAge(atMs) {
    if (!atMs) return '';
    const sec = Math.max(0, (Date.now() - atMs) / 1000);
    return sec < 10 ? `${sec.toFixed(1)}s` : `${Math.round(sec)}s`;
  }

  function renderCameras(cameras) {
    let onlineCount = 0;
    for (const cam of cameras || []) {
      const dir = cam.direction;
      if (!DIRECTIONS.includes(dir)) continue;
      if (cam.status === 'online') onlineCount++;

      const badge = $(`badge-${dir}`);
      if (badge) {
        badge.className = `cam-badge ${cam.status || ''}`;
        const ageText = cam.lastFrameAtMs ? ` · ${formatAge(cam.lastFrameAtMs)}` : '';
        const stateText = cam.status === 'online'
          ? ageText
          : cam.status === 'stale'
            ? ` · 延迟${ageText}`
            : ' · 离线';
        badge.innerHTML = `<span class="dot"></span>${DIR_LABEL[dir]}${stateText}`;
      }

      const img = $(`img-${dir}`);
      const empty = $(`empty-${dir}`);
      if (cam.lastFrameId && cam.lastFrameId !== frameVersion[dir]) {
        frameVersion[dir] = cam.lastFrameId;
        img.src = `/api/frame/${dir}?v=${encodeURIComponent(cam.lastFrameId)}`;
        img.hidden = false;
        empty.hidden = true;
      }

      const hostInput = $(`host-${dir}`);
      if (hostInput && document.activeElement !== hostInput && cam.host) {
        hostInput.value = cam.host;
      }
    }

    const pill = $('pill-cameras');
    pill.className = `pill ${onlineCount === 3 ? 'ok' : onlineCount > 0 ? 'warn' : 'err'}`;
    pill.innerHTML = `<span class="dot"></span>相机 ${onlineCount}/3`;
  }

  function renderAnswer(record) {
    if (!record) return;
    lastRecord = record;
    const box = $('answer-box');
    box.classList.remove('placeholder');
    box.textContent = record.answer || record.spokenText || '';
    const latency = record.latencyMs ? ` · ${(record.latencyMs / 1000).toFixed(1)}s` : '';
    $('answer-meta').textContent = `${formatTime(record.createdAtMs)}${latency}`;
    $('btn-local-speak').disabled = false;
    $('btn-push-speak').disabled = false;
  }

  function renderWatch(watch) {
    const banner = $('watch-banner');
    const startBtn = $('btn-watch-start');
    const stopBtn = $('btn-watch-stop');
    const input = $('watch-input');

    if (!watch || watch.status === 'cancelled' || watch.status === 'expired') {
      banner.hidden = true;
      startBtn.hidden = false;
      stopBtn.hidden = true;
      input.disabled = false;
      return;
    }

    const active = watch.status === 'active';
    startBtn.hidden = active;
    stopBtn.hidden = !active;
    input.disabled = active;
    if (active && document.activeElement !== input) {
      input.value = watch.target;
    }

    banner.hidden = false;
    const hitCount = Number(watch.hitCount || (watch.alert ? 1 : 0));
    banner.className = `watch-banner ${watch.alert ? 'alert' : active ? 'active' : ''}`;

    const statusLine = active
      ? `持续监测中「${watch.target}」· 已检查 ${watch.checks || 0} 次 · 命中 ${hitCount} 次`
      : watch.status === 'failed'
        ? `持续关注异常：${watch.error || '请重试'}`
        : `已结束（检查 ${watch.checks || 0} 次 · 命中 ${hitCount} 次）`;

    let html = `<div>${statusLine}</div>`;
    if (watch.alert) {
      html += `<div class="watch-alert-text">最新提醒（${formatTime(watch.alert.createdAtMs)}）：${watch.alert.spokenText}</div>`;
    }
    banner.innerHTML = html;
  }

  function renderHistory(history) {
    const list = $('history-list');
    const items = (history || []).slice(-5).reverse();
    $('history-count').textContent = `${(history || []).length} 条`;
    if (!items.length) {
      list.innerHTML = '<div class="card-meta">暂无问答记录</div>';
      return;
    }
    list.innerHTML = '';
    for (const item of items) {
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `<div class="history-q">${formatTime(item.createdAtMs)} · ${item.question}</div><div class="history-a">${item.answer}</div>`;
      div.addEventListener('click', () => renderAnswer(item));
      list.appendChild(div);
    }
  }

  function renderState(state) {
    currentState = state;
    renderCameras(state.cameras);

    const mobileCount = state.mobileClients || 0;
    const pillMobile = $('pill-mobile');
    pillMobile.className = `pill ${mobileCount > 0 ? 'ok' : ''}`;
    pillMobile.innerHTML = `<span class="dot"></span>手机语音 ${mobileCount}`;

    const pillQwen = $('pill-qwen');
    pillQwen.className = `pill ${state.qwenConfigured ? 'ok' : 'err'}`;
    pillQwen.innerHTML = `<span class="dot"></span>${state.qwenConfigured ? 'Qwen 就绪' : '未配 Qwen'}`;

    if (state.connection) {
      $('token-text').textContent = state.connection.token || 'hjl';
      $('mobile-url-text').textContent = state.connection.primaryUrl || '';
      if (state.connection.primaryQrSvg) {
        $('qr-container').innerHTML = state.connection.primaryQrSvg;
      }
    }

    if (state.locate?.message) {
      $('locate-msg').textContent = state.locate.message;
    }

    renderWatch(state.watch);
    renderHistory(state.history);
    if (state.history?.length) {
      const latest = state.history[state.history.length - 1];
      if (latest && latest.id !== latestHistoryId) {
        latestHistoryId = latest.id;
        renderAnswer(latest);
      }
    }
  }

  async function ask(mode, question = '') {
    const sendBtn = $('btn-ask-send');
    sendBtn.disabled = true;
    $('answer-meta').textContent = '正在分析三路画面…';
    try {
      const res = await apiFetch('/api/ask', {
        method: 'POST',
        body: JSON.stringify({ mode, question, source: 'desktop' }),
      });
      const rec = res.record || (res.answer || res.spokenText ? res : null);
      if (rec) {
        if (rec.id) latestHistoryId = rec.id;
        renderAnswer(rec);
      }
      if (mode === 'custom') $('ask-input').value = '';
    } catch (err) {
      showToast(err.message || '提问失败');
      $('answer-meta').textContent = '请求失败';
    } finally {
      sendBtn.disabled = false;
    }
  }

  // Bind UI events
  document.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => ask(btn.dataset.mode));
  });

  $('ask-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('ask-input').value.trim();
    if (!q) return;
    ask('custom', q);
  });

  $('watch-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const target = $('watch-input').value.trim();
    if (!target) return;
    try {
      const res = await apiFetch('/api/watch/start', {
        method: 'POST',
        body: JSON.stringify({ target, ttlSeconds: 600 }),
      });
      renderWatch(res.watch);
      showToast(`已开启持续关注：${target}`);
    } catch (err) {
      showToast(err.message || '开启失败');
    }
  });

  $('btn-watch-stop').addEventListener('click', async () => {
    try {
      const res = await apiFetch('/api/watch/cancel', { method: 'POST', body: '{}' });
      renderWatch(res.watch);
      showToast('已停止持续关注');
    } catch (err) {
      showToast(err.message || '停止失败');
    }
  });

  $('btn-local-speak').addEventListener('click', () => {
    if (!lastRecord) return;
    speakText(lastRecord.spokenText || lastRecord.answer || '');
  });

  $('btn-push-speak').addEventListener('click', async () => {
    if (!lastRecord) return;
    try {
      await apiFetch('/api/speak', {
        method: 'POST',
        body: JSON.stringify({ text: lastRecord.spokenText || lastRecord.answer || '' }),
      });
      showToast('已推送到手机播报');
    } catch (err) {
      showToast(err.message || '推送失败');
    }
  });

  $('btn-open-mobile').addEventListener('click', () => { $('modal-mobile').hidden = false; });
  $('btn-open-devices').addEventListener('click', () => { $('modal-devices').hidden = false; });
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => { $(btn.dataset.closeModal).hidden = true; });
  });
  document.querySelectorAll('.modal-backdrop').forEach((bg) => {
    bg.addEventListener('click', (e) => { if (e.target === bg) bg.hidden = true; });
  });

  $('btn-present').addEventListener('click', () => {
    const on = document.body.classList.toggle('present-mode');
    $('btn-present').textContent = on ? '退出演示' : '演示模式';
  });

  $('btn-copy-url').addEventListener('click', async () => {
    const url = currentState?.connection?.primaryUrl || '';
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast('已复制手机链接');
    } catch {
      showToast('复制失败，请手动选中复制');
    }
  });

  $('btn-locate').addEventListener('click', async () => {
    try {
      await apiFetch('/api/cameras/locate', { method: 'POST', body: '{}' });
      showToast('已开始自动定位相机');
    } catch (err) {
      showToast(err.message || '定位失败');
    }
  });

  $('hosts-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {};
    for (const dir of DIRECTIONS) {
      const val = $(`host-${dir}`).value.trim();
      if (val) payload[dir] = val;
    }
    try {
      await apiFetch('/api/cameras/hosts', { method: 'POST', body: JSON.stringify(payload) });
      showToast('相机 IP 已更新');
      $('modal-devices').hidden = true;
    } catch (err) {
      showToast(err.message || '更新失败');
    }
  });

  // SSE + initial state
  function connectEvents() {
    const es = new EventSource('/api/events?client=desktop');
    es.addEventListener('state', (e) => {
      try { renderState(JSON.parse(e.data)); } catch {}
    });
    es.addEventListener('qa', (e) => {
      try { renderAnswer(JSON.parse(e.data)); } catch {}
    });
    es.addEventListener('watch-alert', (e) => {
      try {
        const alert = JSON.parse(e.data);
        showToast(`持续关注命中：${alert.spokenText}`);
      } catch {}
    });
    es.addEventListener('locate', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.message) $('locate-msg').textContent = data.message;
      } catch {}
    });
  }

  apiFetch('/api/state').then(renderState).catch(() => {});
  connectEvents();

  // Keep camera frames and latency badges updating smoothly in real time
  setInterval(() => {
    apiFetch('/api/state').then(renderState).catch(() => {});
  }, 1000);
  setInterval(() => {
    if (currentState?.cameras) renderCameras(currentState.cameras);
  }, 500);
})();
