import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDemoServer } from '../server.js';
import type { VisionRequest } from '../types.js';

const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

test('course server enforces auth, runs multi-view Q&A, triggers Watch alert over SSE, and serves read-only replay', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'fs-server-test-'));
  const capturedReqs: VisionRequest[] = [];

  const server = await createDemoServer({
    port: 0,
    host: '127.0.0.1',
    token: 'test-token-1234',
    qwenConfigured: true,
    watchIntervalMs: 30,
    hubOptions: {
      dataRoot: root,
      startCameraProcess: false,
    },
    vision: async (req) => {
      capturedReqs.push(req);
      return {
        answer: `正前方看到桌子，左侧看到椅子。模式=${req.mode}`,
        spokenText: `正前方看到桌子，左侧看到椅子。模式等于${req.mode}`,
        model: 'mock-qwen',
        latencyMs: 12,
      };
    },
    watchChecker: async (req) => ({
      found: true,
      direction: '正前方',
      summary: `已看到${req.target}`,
      model: 'mock-watch',
      latencyMs: 9,
    }),
  });

  t.after(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.port}`;

  // 1. Loopback desktop + shared static assets + replay pages succeed; remote request without token gets 401
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/shared.js`)).status, 200);
  assert.equal((await fetch(`${base}/style.css`)).status, 200);
  assert.equal((await fetch(`${base}/mobile.html`)).status, 200);
  assert.equal((await fetch(`${base}/replay.html`)).status, 200);
  assert.equal((await fetch(`${base}/api/state`, { headers: { 'cf-connecting-ip': '203.0.113.5' } })).status, 401);

  const authStateRes = await fetch(`${base}/api/state?token=test-token-1234`, {
    headers: { 'cf-connecting-ip': '203.0.113.5' },
  });
  assert.equal(authStateRes.status, 200);
  const initState = (await authStateRes.json()) as any;
  assert.equal(initState.qwenConfigured, true);
  assert.match(initState.connection.primaryQrSvg, /<svg/);

  // 2. Host override validation rejects public IP and accepts private IP
  const badHostRes = await fetch(`${base}/api/cameras/hosts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ front: '8.8.8.8' }),
  });
  assert.equal(badHostRes.status, 400);

  const okHostRes = await fetch(`${base}/api/cameras/hosts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ front: '192.168.43.101', left: '10.122.1.50' }),
  });
  assert.equal(okHostRes.status, 200);

  // 3. Inject JPEG for front & left (right missing)
  for (const dir of ['front', 'left']) {
    const res = await fetch(`${base}/api/cameras/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: dir, jpegBase64: FAKE_JPEG.toString('base64') }),
    });
    assert.equal(res.status, 200);
  }
  const frontImg = await fetch(`${base}/api/frame/front`);
  assert.equal(frontImg.status, 200);
  assert.deepEqual(Buffer.from(await frontImg.arrayBuffer()), FAKE_JPEG);

  // 4. Connect mobile SSE client
  const sseAbort = new AbortController();
  const sseRes = await fetch(`${base}/api/events?client=mobile&token=test-token-1234`, {
    headers: { 'x-forwarded-for': '192.168.1.99' },
    signal: sseAbort.signal,
  });
  assert.equal(sseRes.status, 200);
  const reader = sseRes.body!.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';

  async function waitForSseEvent(eventName: string): Promise<any> {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const marker = `event: ${eventName}\n`;
      const idx = sseBuffer.indexOf(marker);
      if (idx >= 0) {
        const end = sseBuffer.indexOf('\n\n', idx);
        if (end >= 0) {
          const block = sseBuffer.slice(idx, end);
          sseBuffer = sseBuffer.slice(end + 2);
          const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
          if (dataLine) return JSON.parse(dataLine.slice(6));
        }
      }
      const chunk = await reader.read();
      if (chunk.done) break;
      sseBuffer += decoder.decode(chunk.value, { stream: true });
    }
    throw new Error(`Timed out waiting for SSE event ${eventName}`);
  }

  const initSse = await waitForSseEvent('state');
  assert.equal(initSse.mobileClients, 1);

  // 5. Ask all 4 modes
  for (const [mode, question] of [
    ['describe', undefined],
    ['ocr', undefined],
    ['identify', undefined],
    ['custom', '桌上有水杯吗？'],
  ] as const) {
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(question ? { mode, question } : { mode }),
    });
    assert.equal(res.status, 200);
    const qa = (await res.json()) as any;
    assert.equal(qa.mode, mode);
    assert.deepEqual(qa.directions, ['front', 'left']);
    assert.deepEqual(qa.missingDirections, ['right']);
    const pushed = await waitForSseEvent('answer');
    assert.equal(pushed.id, qa.id);
  }
  assert.equal(capturedReqs.length, 4);

  // 6. Start Watch -> triggers alert and speak event over SSE
  const watchStart = await fetch(`${base}/api/watch/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: '蓝色水杯', ttlSeconds: 30 }),
  });
  assert.equal(watchStart.status, 200);
  const watchAlert = await waitForSseEvent('watch-alert');
  assert.equal(watchAlert.target, '蓝色水杯');
  const watchSpeak = await waitForSseEvent('speak');
  assert.equal(watchSpeak.speakId, watchAlert.speakId);

  // Cancel is safe even after already triggered
  assert.equal((await fetch(`${base}/api/watch/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 200);

  // 7. Read-only Replay API returns the 4 QA + 1 Watch alert + valid evidence image
  await sleep(50);
  const sessionsRes = await fetch(`${base}/api/replay/sessions`);
  assert.equal(sessionsRes.status, 200);
  const { sessions } = (await sessionsRes.json()) as any;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, server.sessionId);
  assert.equal(sessions[0].qaCount, 4);
  assert.equal(sessions[0].alertCount, 1);

  const replayRes = await fetch(`${base}/api/replay/session?id=${encodeURIComponent(server.sessionId)}`);
  assert.equal(replayRes.status, 200);
  const replayData = (await replayRes.json()) as any;
  assert.equal(replayData.events.length, 5);
  const evImg = await fetch(`${base}${replayData.events[0].record.evidenceUrls[0].url}`);
  assert.equal(evImg.status, 200);
  assert.deepEqual(Buffer.from(await evImg.arrayBuffer()), FAKE_JPEG);

  // Block path traversal on evidence & replay endpoints
  assert.equal((await fetch(`${base}/api/evidence/..%2Fpackage.json`)).status, 400);
  assert.equal((await fetch(`${base}/api/replay/evidence/not-a-uuid/foo.jpg`)).status, 400);

  sseAbort.abort();
});
