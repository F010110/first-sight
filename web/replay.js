import { apiJson, createFeedCard } from './shared.js';

const $ = (id) => document.getElementById(id);

function showError(msg) {
  const el = $('replay-error');
  if (!msg) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.textContent = msg;
  el.hidden = false;
}

async function replayToPhone(text, answerId) {
  try {
    showError('');
    await apiJson('/api/speak', { text, answerId });
  } catch (err) {
    showError(err.message);
  }
}

function renderEvents(data) {
  const box = $('replay-events');
  box.replaceChildren();
  const events = data.events || [];
  $('replay-summary').textContent = `记录时间：${new Date(data.startedAtMs).toLocaleString()} · 共 ${events.length} 条交互`;

  if (!events.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '该会话暂无问答或提醒记录。';
    box.append(empty);
    return;
  }

  for (const evt of events) {
    box.append(createFeedCard(evt, { onReplay: (text, id) => void replayToPhone(text, id) }));
  }
}

async function loadSession(id) {
  if (!id) return;
  showError('');
  try {
    const data = await apiJson(`/api/replay/session?id=${encodeURIComponent(id)}`);
    renderEvents(data);
  } catch (err) {
    showError(err.message);
  }
}

async function loadList() {
  showError('');
  try {
    const { sessions } = await apiJson('/api/replay/sessions');
    const select = $('session-select');
    select.replaceChildren();
    if (!sessions.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '暂无已保存的非空演示会话';
      select.append(opt);
      $('replay-summary').textContent = '';
      $('replay-events').replaceChildren();
      return;
    }
    for (const s of sessions) {
      const opt = document.createElement('option');
      opt.value = s.sessionId;
      opt.textContent = `${new Date(s.startedAtMs).toLocaleString()} (${s.qaCount} 问答 / ${s.alertCount} 提醒)`;
      select.append(opt);
    }
    await loadSession(sessions[0].sessionId);
  } catch (err) {
    showError(err.message);
  }
}

$('session-select').addEventListener('change', (e) => void loadSession(e.target.value));
$('btn-refresh').addEventListener('click', () => void loadList());
void loadList();
