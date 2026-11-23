import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDemoServer } from './demo-server.js';
import type { VisionRequest } from './qwen-vision.js';

const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

function createTempRoot() {
  return mkdtempSync(join(tmpdir(), 'first-sight-demo-test-'));
}

test('course demo server enforces loopback/token auth, injects frames, asks multi-view Qwen mock, and pushes SSE to mobile', async (t) => {
  const root = createTempRoot();
  const capturedReqs: VisionRequest[] = [];
  const server = await createDemoServer({
    port: 0,
    host: '127.0.0.1',
    token: 'test-token-1234',
    qwenConfigured: true,
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
  });

  t.after(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.port}`;

  // 1. Loopback without token succeeds
  const homeRes = await fetch(`${base}/`);
  assert.equal(homeRes.status, 200);

  // 2. Simulated tunnel/remote request without token is rejected
  const unauthRes = await fetch(`${base}/api/state`, {
    headers: { 'cf-connecting-ip': '203.0.113.5' },
  });
  assert.equal(unauthRes.status, 401);

  // 3. Remote request with valid token succeeds
  const authRes = await fetch(`${base}/api/state?token=test-token-1234`, {
    headers: { 'cf-connecting-ip': '203.0.113.5' },
  });
  assert.equal(authRes.status, 200);
  const initState = (await authRes.json()) as any;
  assert.equal(initState.qwenConfigured, true);
  assert.match(initState.connection.primaryQrSvg, /<svg/);

  // 4. Host override validation rejects public IP and accepts private IP
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

  // 5. Reject ask when no frames exist yet
  const noFrameRes = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'describe' }),
  });
  assert.equal(noFrameRes.status, 400);

  // 6. Reject non-JPEG injection, accept valid JPEG for front & left (right intentionally missing)
  const badImgRes = await fetch(`${base}/api/cameras/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction: 'front', jpegBase64: Buffer.from('not-a-jpeg').toString('base64') }),
  });
  assert.equal(badImgRes.status, 400);

  for (const dir of ['front', 'left']) {
    const injectRes = await fetch(`${base}/api/cameras/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: dir, jpegBase64: FAKE_JPEG.toString('base64') }),
    });
    assert.equal(injectRes.status, 200);
  }

  const frontFrameRes = await fetch(`${base}/api/frame/front`);
  assert.equal(frontFrameRes.status, 200);
  assert.deepEqual(Buffer.from(await frontFrameRes.arrayBuffer()), FAKE_JPEG);

  // 7. Connect mobile SSE client and verify answer + speak push events
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

  const initialSseState = await waitForSseEvent('state');
  assert.equal(initialSseState.mobileClients, 1);

  // 8. Ask describe, ocr, identify, custom modes
  const askRes = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'describe' }),
  });
  assert.equal(askRes.status, 200);
  const qaRecord = (await askRes.json()) as any;
  assert.deepEqual(qaRecord.directions, ['front', 'left']);
  assert.deepEqual(qaRecord.missingDirections, ['right']);
  assert.equal(qaRecord.evidenceUrls.length, 2);

  // Verify VisionProvider received both views and explicit missing right direction
  assert.equal(capturedReqs.length, 1);
  assert.deepEqual(
    capturedReqs[0]!.frames.map((f) => f.direction),
    ['front', 'left'],
  );
  assert.deepEqual(capturedReqs[0]!.missingDirections, ['right']);

  // Verify SSE pushed the answer to the connected mobile client
  const pushedAnswer = await waitForSseEvent('answer');
  assert.equal(pushedAnswer.id, qaRecord.id);
  assert.equal(pushedAnswer.spokenText, qaRecord.spokenText);

  // Verify saved evidence image is served & path traversal is blocked
  const evRes = await fetch(`${base}${qaRecord.evidenceUrls[0].url}`);
  assert.equal(evRes.status, 200);
  assert.deepEqual(Buffer.from(await evRes.arrayBuffer()), FAKE_JPEG);

  const traversalRes = await fetch(`${base}/api/evidence/..%2Fpackage.json`);
  assert.equal(traversalRes.status, 400);

  // Test ocr, identify, custom modes & empty custom validation
  const emptyCustomRes = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'custom', question: '   ' }),
  });
  assert.equal(emptyCustomRes.status, 400);

  for (const [mode, question] of [['ocr', undefined], ['identify', undefined], ['custom', '桌上有水杯吗？']] as const) {
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(question ? { mode, question } : { mode }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.mode, mode);
    const pushed = await waitForSseEvent('answer');
    assert.equal(pushed.mode, mode);
  }

  // 9. Free speak test endpoint pushes speak event to mobile
  const speakRes = await fetch(`${base}/api/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '测试手机语音播报' }),
  });
  assert.equal(speakRes.status, 200);
  const speakJson = (await speakRes.json()) as any;
  assert.equal(speakJson.deliveredToMobileClients, 1);

  const pushedSpeak = await waitForSseEvent('speak');
  assert.equal(pushedSpeak.text, '测试手机语音播报');

  sseAbort.abort();
});
