import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { join, resolve } from 'node:path';
import {
  constantTimeTokenMatch,
  extractRequestToken,
  isDirectLoopback,
  listLanIpv4Addresses,
} from './auth.js';
import { CameraHub, type CameraHubOptions } from './camera-hub.js';
import {
  listSessions,
  readSession,
  readSessionEvidence,
  SessionStore,
} from './recording/session-store.js';
import { SseHub } from './sse-hub.js';
import { QrCache, TunnelManager } from './tunnel.js';
import {
  CAMERA_DIRECTIONS,
  type CameraDirection,
  type DemoMode,
  type QaRecord,
  type VisionProvider,
  type WatchCheckProvider,
} from './types.js';
import { createQwenVisionProvider, createQwenWatchChecker } from './vision/qwen-vision.js';
import { WatchManager } from './vision/watch-manager.js';

export interface DemoServerOptions {
  port?: number;
  host?: string;
  token?: string;
  vision?: VisionProvider;
  watchChecker?: WatchCheckProvider;
  watchIntervalMs?: number;
  hubOptions?: CameraHubOptions;
  webRoot?: string;
  enableTunnel?: boolean;
  qwenConfigured?: boolean;
}

const MODE_DEFAULT_QUESTION: Record<DemoMode, string> = {
  describe: '请描述我周围现在的环境（多视角）。',
  ocr: '请帮我读一下画面里的文字或标识。',
  identify: '请识别眼前的主要物品是什么。',
  custom: '',
};

async function readJsonBody(req: IncomingMessage, maxBytes = 2_500_000): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error('请求体过大');
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('请求体必须是 JSON 对象');
  }
  return parsed as Record<string, unknown>;
}

export async function createDemoServer(options: DemoServerOptions = {}) {
  const webRoot = resolve(options.webRoot ?? 'web');
  const token = options.token || process.env.FIRST_SIGHT_DEMO_TOKEN || 'hjl';
  const tokenParam = `?token=${encodeURIComponent(token)}`;
  const sessionId = randomUUID();
  const dataRoot = resolve(options.hubOptions?.dataRoot ?? join('run', 'course-demo'));

  const vision = options.vision ?? createQwenVisionProvider();
  const watchChecker = options.watchChecker ?? createQwenWatchChecker();
  const sessionStore = new SessionStore(dataRoot, sessionId);
  const sseHub = new SseHub();
  const qrCache = new QrCache();
  const tunnelManager = new TunnelManager();

  const history: QaRecord[] = [];
  let askBusy = false;
  let actualPort = options.port ?? Number(process.env.FIRST_SIGHT_DEMO_PORT ?? 8890);

  const hub = new CameraHub({
    ...options.hubOptions,
    dataRoot,
    onEvent: (evt) => {
      if (evt.type === 'locate') {
        sseHub.broadcast('locate', evt.payload);
      } else if (evt.type === 'camera') {
        sseHub.broadcast('state', buildStatePayloadSync());
      }
    },
  });

  const watchManager = new WatchManager(hub, sessionStore, watchChecker, {
    ...(options.watchIntervalMs !== undefined ? { intervalMs: options.watchIntervalMs } : {}),
    tokenSuffix: tokenParam,
    onUpdate: () => {
      sseHub.broadcast('state', buildStatePayloadSync());
    },
    onAlert: (alert) => {
      sseHub.broadcast('watch-alert', alert);
      sseHub.broadcast('speak', {
        speakId: alert.speakId,
        answerId: alert.id,
        text: alert.spokenText,
        createdAtMs: alert.createdAtMs,
      });
    },
  });

  function isQwenReady(): boolean {
    if (options.qwenConfigured !== undefined) return options.qwenConfigured;
    return Boolean(process.env.QWEN_API_KEY?.trim() && process.env.QWEN_BASE_URL?.trim());
  }

  function buildCandidateUrls(): Array<{ label: string; url: string; kind: 'tunnel' | 'lan' }> {
    const urls: Array<{ label: string; url: string; kind: 'tunnel' | 'lan' }> = [];
    const { tunnelUrl } = tunnelManager.getState();
    if (tunnelUrl) {
      urls.push({
        label: '公网 HTTPS 隧道 (推荐 iPhone/跨网段语音)',
        url: `${tunnelUrl}/mobile.html${tokenParam}`,
        kind: 'tunnel',
      });
    }
    for (const nic of listLanIpv4Addresses()) {
      urls.push({
        label: `局域网 (${nic.name}: ${nic.address})`,
        url: `http://${nic.address}:${actualPort}/mobile.html${tokenParam}`,
        kind: 'lan',
      });
    }
    if (!urls.length) {
      urls.push({
        label: '本机回环',
        url: `http://127.0.0.1:${actualPort}/mobile.html${tokenParam}`,
        kind: 'lan',
      });
    }
    return urls;
  }

  function buildStatePayloadSync() {
    const urls = buildCandidateUrls();
    const { tunnelUrl, tunnelError } = tunnelManager.getState();
    return {
      sessionId,
      cameras: hub.cameraStates(),
      locate: hub.getLocateStatus(),
      watch: watchManager.status(),
      history: history.slice(-20),
      mobileClients: sseHub.mobileCount(),
      askBusy,
      qwenConfigured: isQwenReady(),
      connection: {
        token,
        port: actualPort,
        primaryUrl: urls[0]!.url,
        urls,
        tunnelUrl,
        tunnelError,
      },
    };
  }

  async function buildStatePayload() {
    const base = buildStatePayloadSync();
    const primaryQrSvg = await qrCache.getSvg(base.connection.primaryUrl);
    return {
      ...base,
      connection: {
        ...base.connection,
        primaryQrSvg,
      },
    };
  }

  const staticFiles: Record<string, [string, string, boolean]> = {
    '/': ['index.html', 'text/html; charset=utf-8', true],
    '/index.html': ['index.html', 'text/html; charset=utf-8', true],
    '/desktop.js': ['desktop.js', 'text/javascript; charset=utf-8', true],
    '/replay.html': ['replay.html', 'text/html; charset=utf-8', true],
    '/replay.js': ['replay.js', 'text/javascript; charset=utf-8', true],
    '/mobile.html': ['mobile.html', 'text/html; charset=utf-8', false],
    '/mobile.js': ['mobile.js', 'text/javascript; charset=utf-8', false],
    '/shared.js': ['shared.js', 'text/javascript; charset=utf-8', false],
    '/style.css': ['style.css', 'text/css; charset=utf-8', false],
  };

  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );

    const replyJson = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    try {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        actualPort = addr.port;
      }
      const host = req.headers.host ?? `127.0.0.1:${actualPort}`;
      const url = new URL(req.url ?? '/', `http://${host}`);
      const loopback = isDirectLoopback(req, actualPort);
      const suppliedToken = extractRequestToken(req, url);
      const tokenValid = suppliedToken.length > 0 && constantTimeTokenMatch(suppliedToken, token);
      const authorized = loopback || tokenValid;

      const staticEntry = req.method === 'GET' ? staticFiles[url.pathname] : undefined;
      if (staticEntry) {
        const [filename, contentType, requireAuth] = staticEntry;
        if (requireAuth && !authorized) {
          replyJson(401, { error: '需要本地访问或有效的配对 token' });
          return;
        }
        const bytes = await readFile(join(webRoot, filename));
        res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': bytes.length });
        res.end(bytes);
        return;
      }

      if (!authorized) {
        replyJson(401, { error: '未授权访问，请使用手机扫码链接或携带 token' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/state') {
        replyJson(200, await buildStatePayload());
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/qr') {
        const targetUrl = url.searchParams.get('url') || buildCandidateUrls()[0]!.url;
        const svg = await qrCache.getSvg(targetUrl);
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
        res.end(svg);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/events') {
        const role = url.searchParams.get('client') === 'mobile' ? 'mobile' : 'desktop';
        await sseHub.addClient(req, res, role, buildStatePayload, (joinedId) => {
          sseHub.broadcast('state', buildStatePayloadSync(), joinedId);
        });
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/frame/')) {
        const dir = url.pathname.slice('/api/frame/'.length) as CameraDirection;
        if (!CAMERA_DIRECTIONS.includes(dir)) {
          replyJson(404, { error: '未知相机方向' });
          return;
        }
        const entry = hub.getFrame(dir);
        if (!entry) {
          replyJson(404, { error: `相机 ${dir} 尚无画面` });
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': entry.bytes.length,
          'X-Frame-Id': entry.id,
        });
        res.end(entry.bytes);
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/evidence/')) {
        const name = url.pathname.slice('/api/evidence/'.length);
        let filePath: string;
        try {
          filePath = sessionStore.evidencePath(name);
        } catch {
          replyJson(400, { error: '非法的证据文件名' });
          return;
        }
        try {
          const bytes = await readFile(filePath);
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': bytes.length });
          res.end(bytes);
        } catch {
          replyJson(404, { error: '证据图像不存在' });
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/ask') {
        if (askBusy) {
          replyJson(409, { error: '助手正在分析上一条请求，请稍后再试' });
          return;
        }
        const body = await readJsonBody(req);
        const mode = (typeof body.mode === 'string' ? body.mode : 'custom') as DemoMode;
        if (!['describe', 'ocr', 'identify', 'custom'].includes(mode)) {
          replyJson(400, { error: '无效的提问模式' });
          return;
        }
        const question =
          typeof body.question === 'string' && body.question.trim()
            ? body.question.trim()
            : MODE_DEFAULT_QUESTION[mode];
        if (!question) {
          replyJson(400, { error: '请输入具体问题内容' });
          return;
        }
        if (question.length > 1000) {
          replyJson(400, { error: '问题过长（最多 1000 字）' });
          return;
        }
        const source = body.source === 'mobile' ? 'mobile' : 'desktop';
        askBusy = true;
        sseHub.broadcast('state', buildStatePayloadSync());
        try {
          const snap = await hub.snapshotForVision(sessionStore);
          const result = await vision({
            mode,
            question,
            frames: snap.frames,
            missingDirections: snap.missingDirections,
          });
          const record: QaRecord = {
            id: randomUUID(),
            speakId: randomUUID(),
            mode,
            question,
            answer: result.answer,
            spokenText: result.spokenText,
            model: result.model,
            latencyMs: result.latencyMs,
            directions: snap.frames.map((f) => f.direction),
            missingDirections: snap.missingDirections,
            evidenceUrls: snap.evidenceFiles.map((e) => ({
              direction: e.direction,
              filename: e.filename,
              url: `/api/evidence/${encodeURIComponent(e.filename)}${tokenParam}`,
            })),
            createdAtMs: Date.now(),
            source,
          };
          history.push(record);
          if (history.length > 40) history.splice(0, history.length - 40);
          await sessionStore.appendQa(record);
          sseHub.broadcast('answer', record);
          sseHub.broadcast('speak', {
            speakId: record.speakId,
            answerId: record.id,
            text: record.spokenText || record.answer,
            createdAtMs: record.createdAtMs,
          });
          sseHub.broadcast('state', buildStatePayloadSync());
          replyJson(200, record);
        } finally {
          askBusy = false;
          sseHub.broadcast('state', buildStatePayloadSync());
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/speak') {
        const body = await readJsonBody(req);
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text || text.length > 1000) {
          replyJson(400, { error: '播报文本不能为空且不超过 1000 字' });
          return;
        }
        const payload = {
          speakId: randomUUID(),
          answerId: typeof body.answerId === 'string' ? body.answerId : null,
          text,
          createdAtMs: Date.now(),
        };
        sseHub.broadcast('speak', payload);
        replyJson(200, { deliveredToMobileClients: sseHub.mobileCount(), ...payload });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/watch/start') {
        const body = await readJsonBody(req);
        const target = typeof body.target === 'string' ? body.target : '';
        const ttl = typeof body.ttlSeconds === 'number' ? body.ttlSeconds : undefined;
        const task = watchManager.start(target, ttl);
        replyJson(200, task);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/watch/cancel') {
        const task = watchManager.cancel();
        replyJson(200, { ok: true, watch: task });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/cameras/hosts') {
        const body = await readJsonBody(req);
        const updates: Partial<Record<CameraDirection, string>> = {};
        for (const dir of CAMERA_DIRECTIONS) {
          const val = body[dir];
          if (typeof val === 'string' && val.trim()) {
            updates[dir] = val.trim();
          }
        }
        hub.setHosts(updates);
        replyJson(200, { ok: true, cameras: hub.cameraStates() });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/cameras/locate') {
        const body = await readJsonBody(req);
        const subnets = Array.isArray(body.subnets)
          ? body.subnets.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          : [];
        const force = body.force !== false;
        hub.triggerLocate(subnets, force);
        replyJson(202, { started: true, locate: hub.getLocateStatus() });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/cameras/inject') {
        const body = await readJsonBody(req, 2_500_000);
        const dir = body.direction as CameraDirection;
        const b64 = typeof body.jpegBase64 === 'string' ? body.jpegBase64 : '';
        const cleaned = b64.replace(/^data:image\/jpeg;base64,/i, '').trim();
        if (!cleaned) {
          replyJson(400, { error: '缺少 jpegBase64 图片数据' });
          return;
        }
        const entry = hub.injectManualFrame(dir, Buffer.from(cleaned, 'base64'));
        replyJson(200, { ok: true, frameId: entry.id, direction: entry.direction, sha256: entry.sha256 });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/replay/sessions') {
        replyJson(200, { sessions: await listSessions(dataRoot) });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/replay/session') {
        const id = url.searchParams.get('id') ?? '';
        replyJson(200, await readSession(dataRoot, id, loopback ? '' : tokenParam));
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/replay/evidence/')) {
        const rest = url.pathname.slice('/api/replay/evidence/'.length);
        const parts = rest.split('/');
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          replyJson(400, { error: '非法的回放证据路径' });
          return;
        }
        const sid = decodeURIComponent(parts[0]);
        const name = decodeURIComponent(parts[1]);
        try {
          const bytes = await readSessionEvidence(dataRoot, sid, name);
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': bytes.length });
          res.end(bytes);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          replyJson(msg.includes('非法') ? 400 : 404, { error: msg });
        }
        return;
      }

      replyJson(404, { error: '接口不存在' });
    } catch (error) {
      if (!res.headersSent) {
        replyJson(400, { error: error instanceof Error ? error.message : String(error) });
      } else {
        res.destroy();
      }
    }
  });

  await sessionStore.init();
  await hub.start();

  const listenHost = options.host ?? '0.0.0.0';
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(actualPort, listenHost, () => {
      server.off('error', rejectListen);
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        actualPort = addr.port;
      }
      resolveListen();
    });
  });

  if (options.enableTunnel) {
    void tunnelManager.start(actualPort, async () => {
      sseHub.broadcast('state', await buildStatePayload());
    });
  }

  async function close(): Promise<void> {
    watchManager.close();
    tunnelManager.stop();
    sseHub.close();
    await hub.close();
    await sessionStore.flush();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }

  return {
    server,
    hub,
    sessionStore,
    watchManager,
    token,
    sessionId,
    get port() {
      return actualPort;
    },
    getConnectionUrls: buildCandidateUrls,
    close,
  };
}
