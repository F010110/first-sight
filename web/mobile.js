import { apiJson, createFeedCard, withTokenQuery } from './shared.js';

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
let token = params.get('token') || sessionStorage.getItem('fs-demo-token') || '';
if (params.get('token')) {
  sessionStorage.setItem('fs-demo-token', token);
}

let audioUnlocked = false;
let wakeLock = null;
let eventSource = null;
let pendingFallbackText = '';
let speakRunId = 0;
const spokenIds = new Set();
let latestSpokenText = '';
let recognition = null;
let listening = false;

function showErr(msg) {
  const box = $('m-error');
  if (!msg) {
    box.hidden = true;
    box.textContent = '';
    return;
  }
  box.textContent = msg;
  box.hidden = false;
}

function setSpeakingBadge(cls, text) {
  const pill = $('mobile-speaking-pill');
  pill.className = 'pill ' + cls;
  pill.textContent = text;
}

async function mobileApi(path, body) {
  try {
    return await apiJson(path, body, token);
  } catch (err) {
    if (err.status === 401) {
      $('token-card').hidden = false;
    }
    throw err;
  }
}

function pickChineseVoice() {
  if (typeof speechSynthesis === 'undefined') return null;
  const voices = speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang.toLowerCase().startsWith('zh-cn')) ||
    voices.find((v) => v.lang.toLowerCase().startsWith('zh')) ||
    null
  );
}

function splitSentences(text) {
  const parts = text
    .split(/(?<=[。！？!?；;\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [text.trim()].filter(Boolean);
}

function stopSpeech() {
  speakRunId++;
  $('btn-tap-speak').hidden = true;
  pendingFallbackText = '';
  setSpeakingBadge('', '已停止');
  if (typeof speechSynthesis !== 'undefined') {
    try {
      speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
}

function primeSpeech(announce = false) {
  if (typeof speechSynthesis === 'undefined') {
    $('voice-status').textContent = '当前浏览器不支持 Web Speech 语音合成。';
    return;
  }
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(announce ? '手机语音已开启，等待播报。' : ' ');
    u.lang = 'zh-CN';
    const voice = pickChineseVoice();
    if (voice) u.voice = voice;
    u.volume = announce ? 1 : 0;
    u.rate = Number($('rate-select').value || '1');
    speechSynthesis.speak(u);
    speechSynthesis.resume();
    audioUnlocked = true;
    $('btn-unlock').textContent = '语音已开启（点此可重新激活）';
    $('btn-unlock').className = 'ok-btn big-unlock-btn';
    $('voice-status').textContent = '语音播报就绪。收到新结果时会自动朗读。';
    setSpeakingBadge('ok', '语音就绪');
  } catch {
    /* ignore */
  }
}

function speakText(text, speakId = null, force = false) {
  const clean = (text || '').trim();
  if (!clean) return;
  latestSpokenText = clean;
  $('latest-text').textContent = clean;
  $('btn-replay-latest').disabled = false;

  if (!force && speakId && spokenIds.has(speakId)) return;
  if (speakId) spokenIds.add(speakId);

  if (!force && !$('auto-speak').checked) {
    $('voice-status').textContent = '已收到新回答（自动播报已关闭，可点“重播”收听）。';
    setSpeakingBadge('', '已静音');
    return;
  }
  if (typeof speechSynthesis === 'undefined') {
    $('voice-status').textContent = '浏览器不支持语音合成，请直接阅读上方文字。';
    return;
  }
  if (!audioUnlocked && !force) {
    pendingFallbackText = clean;
    $('btn-tap-speak').hidden = false;
    $('voice-status').textContent = '尚未激活语音，请点击上方黄色按钮朗读。';
    setSpeakingBadge('warn', '等待点击朗读');
    return;
  }

  const runId = ++speakRunId;
  $('btn-tap-speak').hidden = true;
  pendingFallbackText = '';

  const chunks = splitSentences(clean);
  const voice = pickChineseVoice();
  const rate = Number($('rate-select').value || '1');

  try {
    speechSynthesis.cancel();
  } catch {
    /* ignore */
  }

  let startedAny = false;
  const guardTimer = setTimeout(() => {
    if (runId === speakRunId && !startedAny) {
      pendingFallbackText = clean;
      $('btn-tap-speak').hidden = false;
      $('voice-status').textContent = '浏览器暂停了后台发声，点击上方黄色按钮立即播报。';
      setSpeakingBadge('warn', '等待点击朗读');
    }
  }, 1000);

  let idx = 0;
  function speakNext() {
    if (runId !== speakRunId || idx >= chunks.length) {
      clearTimeout(guardTimer);
      if (runId === speakRunId && startedAny) {
        $('voice-status').textContent = '播报完成，等待下一次提问。';
        setSpeakingBadge('ok', '语音就绪');
      }
      return;
    }
    const u = new SpeechSynthesisUtterance(chunks[idx++]);
    u.lang = 'zh-CN';
    if (voice) u.voice = voice;
    u.rate = rate;
    u.onstart = () => {
      if (runId !== speakRunId) return;
      startedAny = true;
      clearTimeout(guardTimer);
      $('btn-tap-speak').hidden = true;
      $('voice-status').textContent = '正在语音播报…';
      setSpeakingBadge('ok', '正在播报…');
    };
    u.onend = () => speakNext();
    u.onerror = () => {
      clearTimeout(guardTimer);
      if (runId === speakRunId && !startedAny) {
        pendingFallbackText = clean;
        $('btn-tap-speak').hidden = false;
        setSpeakingBadge('warn', '等待点击朗读');
      }
    };
    speechSynthesis.speak(u);
    speechSynthesis.resume();
  }

  speakNext();
}

function renderState(state) {
  if (!state) return;
  const online = (state.cameras || []).filter((c) => c.status === 'online').length;
  const camPill = $('cam-pill');
  camPill.textContent = `相机在线：${online}/3`;
  camPill.className = 'pill ' + (online > 0 ? 'ok' : 'warn');

  const busy = !!state.askBusy;
  for (const id of ['m-describe', 'm-ocr', 'm-identify', 'm-send']) {
    $(id).disabled = busy;
  }

  const w = state.watch;
  $('m-watch-cancel').disabled = !(w && w.status === 'active');
  if (!w) {
    $('m-watch-status').textContent = '';
  } else if (w.status === 'active') {
    $('m-watch-status').textContent = `关注中：${w.target}（已查 ${w.checks} 次）`;
  } else if (w.status === 'triggered' && w.alert) {
    $('m-watch-status').textContent = `命中提醒：${w.alert.spokenText}`;
  } else {
    $('m-watch-status').textContent = `关注“${w.target}”已结束 (${w.status})`;
  }

  const box = $('m-history');
  const items = state.history || [];
  box.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '暂无历史记录';
    box.append(empty);
    return;
  }

  for (const item of [...items].reverse()) {
    box.append(
      createFeedCard(
        { kind: 'qa', record: item },
        {
          compact: true,
          onReplay: (text) => {
            primeSpeech(false);
            speakText(text, null, true);
          },
        },
      ),
    );
  }

  if (!latestSpokenText && items.length) {
    const latest = items[items.length - 1];
    latestSpokenText = latest.spokenText || latest.answer;
    $('latest-text').textContent = latestSpokenText;
    $('btn-replay-latest').disabled = false;
  }
}

function connectEvents() {
  if (eventSource) {
    eventSource.close();
  }
  const pill = $('conn-pill');
  pill.textContent = '连接中…';
  pill.className = 'pill warn';

  const es = new EventSource(withTokenQuery('/api/events?client=mobile', token));
  eventSource = es;

  es.onopen = () => {
    pill.textContent = '已连主机';
    pill.className = 'pill ok';
    $('token-card').hidden = true;
    showErr('');
  };

  es.onerror = () => {
    pill.textContent = '重连中…';
    pill.className = 'pill err';
  };

  es.addEventListener('state', (evt) => {
    try {
      renderState(JSON.parse(evt.data));
    } catch {
      /* ignore */
    }
  });

  es.addEventListener('answer', (evt) => {
    try {
      const record = JSON.parse(evt.data);
      speakText(record.spokenText || record.answer, record.speakId, false);
    } catch {
      /* ignore */
    }
  });

  es.addEventListener('watch-alert', (evt) => {
    try {
      const alert = JSON.parse(evt.data);
      speakText(alert.spokenText, alert.speakId, false);
    } catch {
      /* ignore */
    }
  });

  es.addEventListener('speak', (evt) => {
    try {
      const data = JSON.parse(evt.data);
      speakText(data.text, data.speakId, false);
    } catch {
      /* ignore */
    }
  });
}

async function triggerMobileAsk(mode, question = '') {
  showErr('');
  primeSpeech(false);
  try {
    await mobileApi('/api/ask', { mode, question, source: 'mobile' });
  } catch (err) {
    showErr(err.message);
  }
}

function setupMic() {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $('m-mic');
  const hint = $('mic-hint');
  if (!Rec) {
    mic.disabled = true;
    hint.textContent = '当前地址不支持网页麦克风（局域网 HTTP 限制）；可直接点键盘上的🎤语音输入，或用 npm run demo:tunnel 获取 HTTPS 扫码。';
    return;
  }
  recognition = new Rec();
  recognition.lang = 'zh-CN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    listening = true;
    mic.textContent = '⏹';
    hint.textContent = '正在听您说话…';
  };
  recognition.onend = () => {
    listening = false;
    mic.textContent = '🎤';
  };
  recognition.onerror = (e) => {
    listening = false;
    mic.textContent = '🎤';
    hint.textContent = `语音识别失败：${e.error}`;
  };
  recognition.onresult = (e) => {
    const text = e.results?.[0]?.[0]?.transcript?.trim();
    if (!text) return;
    $('m-input').value = text;
    hint.textContent = `识别到：${text}`;
    void triggerMobileAsk('custom', text);
  };
  mic.addEventListener('click', () => {
    primeSpeech(false);
    if (listening) {
      recognition.stop();
    } else {
      recognition.start();
    }
  });
}

$('btn-unlock').addEventListener('click', async () => {
  primeSpeech(true);
  if ('wakeLock' in navigator && !wakeLock) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      /* ignore */
    }
  }
});

$('btn-tap-speak').addEventListener('click', () => {
  const text = pendingFallbackText || latestSpokenText;
  primeSpeech(false);
  if (text) speakText(text, null, true);
});

$('btn-stop-speech').addEventListener('click', stopSpeech);
$('btn-replay-latest').addEventListener('click', () => {
  primeSpeech(false);
  if (latestSpokenText) speakText(latestSpokenText, null, true);
});

$('m-describe').addEventListener('click', () => void triggerMobileAsk('describe'));
$('m-ocr').addEventListener('click', () => void triggerMobileAsk('ocr'));
$('m-identify').addEventListener('click', () => void triggerMobileAsk('identify'));

$('m-ask-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('m-input').value.trim();
  if (!q) return;
  $('m-input').value = '';
  void triggerMobileAsk('custom', q);
});

$('m-watch-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showErr('');
  primeSpeech(false);
  const target = $('m-watch-input').value.trim();
  if (!target) return;
  try {
    await mobileApi('/api/watch/start', { target, ttlSeconds: 90 });
  } catch (err) {
    showErr(err.message);
  }
});

$('m-watch-cancel').addEventListener('click', async () => {
  showErr('');
  try {
    await mobileApi('/api/watch/cancel', {});
  } catch (err) {
    showErr(err.message);
  }
});

$('token-save').addEventListener('click', () => {
  token = $('token-input').value.trim();
  if (token) {
    sessionStorage.setItem('fs-demo-token', token);
    connectEvents();
    void mobileApi('/api/state').then(renderState).catch((err) => showErr(err.message));
  }
});

if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.addEventListener?.('voiceschanged', pickChineseVoice);
}

setupMic();
connectEvents();
void mobileApi('/api/state').then(renderState).catch((err) => showErr(err.message));
