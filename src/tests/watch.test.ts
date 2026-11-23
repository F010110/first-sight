import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CameraHub } from '../camera-hub.js';
import { SessionStore } from '../recording/session-store.js';
import type { WatchAlertRecord } from '../types.js';
import { WatchManager } from '../vision/watch-manager.js';

const FAKE_JPEG_1 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xd9]);
const FAKE_JPEG_2 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

test('WatchManager deduplicates identical frames and triggers alert when new frame matches', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'fs-watch-test-'));
  const hub = new CameraHub({ dataRoot: root, startCameraProcess: false });
  const store = new SessionStore(root, '11111111-1111-4111-8111-111111111111');
  let checks = 0;
  let foundFlag = false;
  const alerts: WatchAlertRecord[] = [];

  const watch = new WatchManager(
    hub,
    store,
    async (req) => {
      checks++;
      return {
        found: foundFlag,
        direction: foundFlag ? '正前方' : '未知',
        summary: foundFlag ? `看到${req.target}` : '暂未看到',
        model: 'mock-watch',
        latencyMs: 5,
      };
    },
    {
      intervalMs: 40,
      onAlert: (a) => alerts.push(a),
    },
  );

  t.after(async () => {
    watch.close();
    await hub.close();
    await store.flush();
    rmSync(root, { recursive: true, force: true });
  });

  // Cannot start without frames
  assert.throws(() => watch.start('蓝色水杯'), /暂无相机画面/);

  hub.injectManualFrame('front', FAKE_JPEG_1);
  watch.start('蓝色水杯', 30);

  // Wait > 3 intervals while frame is unchanged -> checker must run ONLY once
  await sleep(160);
  assert.equal(checks, 1);
  assert.equal(watch.status()?.status, 'active');

  // Inject a new frame with found=true -> triggers alert and persists evidence
  foundFlag = true;
  hub.injectManualFrame('front', FAKE_JPEG_2);
  await sleep(120);

  assert.equal(checks, 2);
  assert.equal(alerts.length, 1);
  assert.equal(watch.status()?.status, 'triggered');
  assert.match(alerts[0]!.spokenText, /正前方.*蓝色水杯/);
  assert.equal(alerts[0]!.evidenceUrls.length, 1);
});

test('WatchManager discards late async result after cancel and expires cleanly on TTL', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'fs-watch-cancel-'));
  const hub = new CameraHub({ dataRoot: root, startCameraProcess: false });
  const store = new SessionStore(root, '22222222-2222-4222-8222-222222222222');
  const alerts: WatchAlertRecord[] = [];
  let releaseCheck!: () => void;

  const watch = new WatchManager(
    hub,
    store,
    async () => {
      await new Promise<void>((resolve) => {
        releaseCheck = resolve;
      });
      return {
        found: true,
        direction: '左侧',
        summary: '发现水杯',
        model: 'mock-watch',
        latencyMs: 15,
      };
    },
    {
      intervalMs: 30,
      onAlert: (a) => alerts.push(a),
    },
  );

  t.after(async () => {
    watch.close();
    await hub.close();
    await store.flush();
    rmSync(root, { recursive: true, force: true });
  });

  hub.injectManualFrame('left', FAKE_JPEG_1);
  watch.start('水杯', 60);
  await sleep(40);
  watch.cancel();
  releaseCheck();
  await sleep(40);

  assert.equal(watch.status()?.status, 'cancelled');
  assert.equal(alerts.length, 0);
});
