export const DIRECTIONS = ['front', 'left', 'right'];

export const DIR_LABEL = {
  front: '正前方',
  left: '左侧',
  right: '右侧',
};

export const MODE_LABEL = {
  describe: '多视角描述',
  ocr: '读文字',
  identify: '识别物品',
  custom: '自由提问',
};

export const STATUS_LABEL = {
  online: '在线',
  stale: '已延迟',
  error: '连接异常',
  waiting: '等待信号',
  unconfigured: '未配对',
};

export function formatTime(ms) {
  return new Date(ms).toLocaleTimeString();
}

export function withTokenQuery(path, token = '') {
  if (!token) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}token=${encodeURIComponent(token)}`;
}

export async function apiJson(path, body, token = '') {
  const headers = body === undefined ? {} : { 'Content-Type': 'application/json' };
  if (token) headers['X-Demo-Token'] = token;
  const res = await fetch(withTokenQuery(path, token), {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `请求失败 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function createEvidenceThumbs(evidenceUrls) {
  const thumbs = document.createElement('div');
  thumbs.className = 'qa-thumbs';
  for (const ev of evidenceUrls || []) {
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
  return thumbs;
}

export function createFeedCard(entry, options = {}) {
  const { onReplay, compact = false } = options;
  const isAlert = entry.kind === 'watch-alert';
  const rec = entry.record;

  const card = document.createElement('article');
  card.className = isAlert ? 'qa-item alert-item' : 'qa-item';

  const meta = document.createElement('div');
  meta.className = 'qa-meta';
  if (isAlert) {
    meta.textContent = `${formatTime(rec.createdAtMs)} · Watch 目标提醒 · ${rec.latencyMs}ms (${rec.model})`;
  } else {
    const dirs = (rec.directions || []).map((d) => DIR_LABEL[d] || d).join(' / ');
    meta.textContent = `${formatTime(rec.createdAtMs)} · ${MODE_LABEL[rec.mode] || rec.mode} · 视角: ${dirs} · ${rec.latencyMs}ms (${rec.model})`;
  }

  const q = document.createElement('div');
  q.className = 'qa-q';
  q.textContent = isAlert
    ? `关注目标：${rec.target}（方位：${rec.direction}）`
    : `问：${rec.question}`;

  const a = document.createElement('div');
  a.className = 'qa-a';
  a.textContent = isAlert ? rec.spokenText : rec.answer;

  card.append(meta, q, a);
  if (!compact && rec.evidenceUrls?.length) {
    card.append(createEvidenceThumbs(rec.evidenceUrls));
  }

  if (onReplay) {
    const actions = document.createElement('div');
    actions.className = 'qa-actions';
    const replayBtn = document.createElement('button');
    replayBtn.type = 'button';
    replayBtn.textContent = '重播到手机';
    replayBtn.addEventListener('click', () => onReplay(rec.spokenText || rec.answer, rec.id));
    actions.append(replayBtn);
    card.append(actions);
  }

  return card;
}
