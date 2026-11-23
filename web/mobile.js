import { apiJson, formatTime } from '/shared.js';

function pickChineseVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  return (
    voices.find((v) => /^zh[-_]CN/i.test(v.lang)) ||
    voices.find((v) => /^zh/i.test(v.lang)) ||
    null
  );
}

function splitSpeechChunks(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const parts = clean.split(/(?<=[。！？!?；;])/).map((s) => s.trim()).filter(Boolean);
  const chunks = [];
  for (const part of parts) {
    if (part.length <= 75) {
      chunks.push(part);
    } else {
      for (let i = 0; i < part.length; i += 75) {
        chunks.push(part.slice(i, i + 75));
      }
    }
  }
  return chunks.length ? chunks : [clean];
}

async function apiFetch(path, opts = {}) {
  const body = opts.body ? JSON.parse(opts.body) : undefined;
  return apiJson(path, body);
}

(() => {
  const $ = (id) => document.getElementById(id);

  const params = new URLSearchParams(window.location.search);
  let token = (params.get('token') || localStorage.getItem('fs_token') || 'hjl').trim();
  let audioUnlocked = false;
  let pendingSpeak = '';
  let lastSpeakId = '';
  let es = null;
  let toastTimer = null;
  let startWatchTimer = null;

  $('token-input').value = token;

  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.getVoices(); };
  }

  function showToast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
  }

  function setStatus(ok, label) {
    const el = $('mobile-status');
    el.className = `pill ${ok ? 'ok' : 'err'}`;
    el.innerHTML = `<span class="dot"></span>${label}`;
  }

  function authedUrl(path) {
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}token=${encodeURIComponent(token)}`;
  }

  function speakReliable(text) {
    if (!text || !('speechSynthesis' in window)) {
      $('btn-ios-fallback').hidden = false;
      return;
    }
    const synth = window.speechSynthesis;
    clearTimeout(startWatchTimer);
    try {
      synth.cancel();
      if (synth.paused) synth.resume();
    } catch {}

    const chunks = splitSpeechChunks(text);
    const voice = pickChineseVoice();
    let started = false;

    // Slight delay after cancel() avoids silent drop on iOS Safari / mobile Chrome
    setTimeout(() => {
      chunks.forEach((chunk, idx) => {
        const u = new SpeechSynthesisUtterance(chunk);
        u.lang = voice?.lang || 'zh-CN';
        if (voice) u.voice = voice;
        u.rate = 1.05;
        u.volume = 1.0;
        if (idx === 0) {
          u.onstart = () => {
            started = true;
            clearTimeout(startWatchTimer);
            $('btn-ios-fallback').hidden = true;
          };
          u.onerror = () => {
            $('btn-ios-fallback').hidden = false;
          };
        }
        try {
          synth.speak(u);
        } catch {
          $('btn-ios-fallback').hidden = false;
        }
      });

      startWatchTimer = setTimeout(() => {
        if (!started) {
          $('btn-ios-fallback').hidden = false;
        }
      }, 1100);
    }, 60);
  }

  function unlockAudio(announce = false) {
    if (audioUnlocked) return;
    audioUnlocked = true;
    $('btn-unlock-audio').textContent = '语音播报已开启（自动朗读中）';
    $('btn-unlock-audio').className = 'btn btn-soft';
    $('btn-ios-fallback').hidden = true;
    if (navigator.wakeLock?.request) {
      navigator.wakeLock.request('screen').catch(() => {});
    }
    if (pendingSpeak) {
      speakReliable(pendingSpeak);
    } else if (announce) {
      speakReliable('语音播报已开启');
    } else if ('speechSynthesis' in window) {
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        window.speechSynthesis.speak(u);
      } catch {}
    }
  }

  // Automatically unlock audio on the user's very first tap anywhere on the page
  document.addEventListener('pointerdown', () => unlockAudio(false), { once: true });

  function triggerSpeak(text, createdAtMs) {
    if (!text) return;
    $('subtitle-box').textContent = text;
    $('subtitle-time').textContent = formatTime(createdAtMs || Date.now());
    pendingSpeak = text;
    speakReliable(text);
  }

  function renderWatch(watch) {
    const banner = $('m-watch-banner');
    const startBtn = $('m-watch-start');
    const stopBtn = $('m-watch-stop');
    const input = $('m-watch-input');
    const active = watch && watch.status === 'active';

    startBtn.hidden = Boolean(active);
    stopBtn.hidden = !active;
    input.disabled = Boolean(active);

    if (!active) {
      banner.hidden = true;
      return;
    }
    if (document.activeElement !== input) input.value = watch.target;
    banner.hidden = false;
    banner.className = `watch-banner ${watch.alert ? 'alert' : 'active'}`;
    banner.textContent = `持续监测「${watch.target}」· 检查 ${watch.checks || 0} 次 · 命中 ${watch.hitCount || 0} 次`;
  }

  function connect() {
    if (es) { es.close(); es = null; }
    localStorage.setItem('fs_token', token);
    es = new EventSource(authedUrl('/api/events?client=mobile'));

    es.onopen = () => setStatus(true, '已连接');
    es.onerror = () => setStatus(false, '重连中');

    es.addEventListener('state', (e) => {
      try {
        const s = JSON.parse(e.data);
        setStatus(true, '已连接');
        $('connect-card').hidden = true;
        renderWatch(s.watch);
      } catch {}
    });

    es.addEventListener('speak', (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.speakId && payload.speakId === lastSpeakId) return;
        lastSpeakId = payload.speakId || '';
        triggerSpeak(payload.text, payload.createdAtMs);
      } catch {}
    });

    es.addEventListener('answer', (e) => {
      try {
        const rec = JSON.parse(e.data);
        if (rec.speakId && rec.speakId === lastSpeakId) return;
        lastSpeakId = rec.speakId || '';
        triggerSpeak(rec.spokenText || rec.answer, rec.createdAtMs);
      } catch {}
    });
  }

  $('token-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const val = $('token-input').value.trim();
    if (!val) return;
    token = val;
    unlockAudio(false);
    connect();
  });

  $('btn-unlock-audio').addEventListener('click', () => {
    if (!audioUnlocked) {
      unlockAudio(true);
    } else if (pendingSpeak) {
      speakReliable(pendingSpeak);
    } else {
      speakReliable('语音测试正常');
    }
  });

  $('btn-ios-fallback').addEventListener('click', () => {
    audioUnlocked = true;
    if (pendingSpeak) speakReliable(pendingSpeak);
    $('btn-ios-fallback').hidden = true;
  });

  document.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      unlockAudio(false);
      try {
        await apiFetch(authedUrl('/api/ask'), {
          method: 'POST',
          body: JSON.stringify({ mode: btn.dataset.mode, source: 'mobile' }),
        });
        showToast('已发送提问');
      } catch (err) {
        showToast(err.message || '请求失败');
      }
    });
  });

  $('m-watch-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    unlockAudio(false);
    const target = $('m-watch-input').value.trim();
    if (!target) return;
    try {
      const res = await apiFetch(authedUrl('/api/watch/start'), {
        method: 'POST',
        body: JSON.stringify({ target, ttlSeconds: 600 }),
      });
      renderWatch(res.watch);
      showToast('已开启持续关注');
    } catch (err) {
      showToast(err.message || '开启失败');
    }
  });

  $('m-watch-stop').addEventListener('click', async () => {
    try {
      const res = await apiFetch(authedUrl('/api/watch/cancel'), { method: 'POST', body: '{}' });
      renderWatch(res.watch);
      showToast('已停止持续关注');
    } catch (err) {
      showToast(err.message || '停止失败');
    }
  });

  connect();
})();
