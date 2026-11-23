import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Tunnel, bin as cloudflaredBin, install as installCloudflared } from 'cloudflared';
import QRCode from 'qrcode';
import { CAMERA_DIRECTIONS, CameraHub, type CameraHubOptions } from './camera-hub.js';
import {
  createQwenVisionProvider,
  type CameraDirection,
  type DemoMode,
  type VisionProvider,
} from './qwen-vision.js';

export interface QaRecord {
  id: string;
  speakId: string;
  mode: DemoMode;
  question: string;
  answer: string;
  spokenText: string;
  model: string;
  latencyMs: number;
  directions: CameraDirection[];
  missingDirections: CameraDirection[];
  evidenceUrls: Array<{ direction: CameraDirection; url: string }>;
  createdAtMs: number;
  source: 'desktop' | 'mobile';
}

export interface DemoServerOptions {
  port?: number;
  host?: string;
  token?: string;
  vision?: VisionProvider;
  hubOptions?: CameraHubOptions;
  webRoot?: string;
  enableTunnel?: boolean;
  qwenConfigured?: boolean;
}

interface SseClient {
  id: string;
  role: 'desktop' | 'mobile';
  res: ServerResponse;
}

const MODE_DEFAULT_QUESTION: Record<DemoMode, string> = {
  describe: '请描述我周围现在的环境（多视角）。',
  ocr: '请帮我读一下画面里的文字或标识。',
  identify: '请识别眼前的主要物品是什么。',
  custom: '',
};

const EVIDENCE_NAME_RE = /^[0-9a-zA-Z_-]+\.jpg$/;

export function listLanIpv4Addresses(): Array<{ name: string; address: string }> {
  const nets = networkInterfaces();
  const list: Array<{ name: string; address: string; score: number }> = [];
  for (const [name, entries] of Object.entries(nets)) {
    if (!entries) continue;
    const lower = name.toLowerCase();
    if (lower.includes('vethernet') || lower.includes('vmware') || lower.includes('virtualbox') || lower.includes('wsl') || lower.includes('loopback')) {
      continue;
    }
    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue;
      let score = 10;
      if (lower.includes('wlan') || lower.includes('wi-fi') || lower.includes('无线')) score -= 5;
      if (entry.address.startsWith('192.168.')) score -= 3;
      else if (entry.address.startsWith('10.')) score -= 2;
      list.push({ name, address: entry.address, score });
    }
  }
  list.sort((a, b) => a.score - b.score || a.address.localeCompare(b.address));
  return list.map(({ name, address }) => ({ name, address }));
}

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

function constantTimeTokenMatch(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isDirectLoopback(req: IncomingMessage, port: number): boolean {
  if (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']) {
    return false;
  }
  const remote = req.socket.remoteAddress ?? '';
  const loopbackAddr = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (!loopbackAddr) return false;
  const host = req.headers.host ?? '';
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function extractRequestToken(req: IncomingMessage, url: URL): string {
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;
  const headerToken = req.headers['x-demo-token'];
  if (typeof headerToken === 'string' && headerToken) return headerToken;
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

export async function createDemoServer(options: DemoServerOptions = {}) {
  const webRoot = resolve(options.webRoot ?? 'web/course-demo');
  const token = options.token || process.env.FIRST_SIGHT_DEMO_TOKEN || randomBytes(4).toString('hex');
  const vision: VisionProvider = options.vision ?? createQwenVisionProvider();
  const sseClients = new Set<SseClient>();
  const history: QaRecord[] = [];
  let askBusy = false;
  let tunnelUrl: string | null = null;
  let tunnelError: string | null = null;
  let tunnelProc: Tunnel | null = null;
  let actualPort = options.port ?? Number(process.env.FIRST_SIGHT_DEMO_PORT ?? 8890);

  const qrCache = new Map<string, string>();
  async function getQrSvg(url: string): Promise<string> {
    const hit = qrCache.get(url);
    if (hit) return hit;
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1 });
    qrCache.set(url, svg);
    return svg;
  }

  function broadcast(eventName: string, payload: unknown): void {
    const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      try {
        client.res.write(data);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  const hub = new CameraHub({
    ...options.hubOptions,
    onEvent: (evt) => {
      if (evt.type === 'locate') {
        broadcast('locate', evt.payload);
      } else if (evt.type === 'camera') {
        broadcast('state', buildStatePayloadSync());
      }
    },
  });

  function isQwenReady(): boolean {
    if (options.qwenConfigured !== undefined) return options.qwenConfigured;
    return Boolean(process.env.QWEN_API_KEY?.trim() && process.env.QWEN_BASE_URL?.trim());
  }

  function mobileCount(): number {
    let count = 0;
    for (const c of sseClients) {
      if (c.role === 'mobile') count++;
    }
    return count;
  }

  function buildCandidateUrls(): Array<{ label: string; url: string; kind: 'tunnel' | 'lan' }> {
    const urls: Array<{ label: string; url: string; kind: 'tunnel' | 'lan' }> = [];
    if (tunnelUrl) {
      urls.push({
        label: '公网 HTTPS 隧道 (推荐 iPhone/跨网段语音)',
        url: `${tunnelUrl}/mobile.html?token=${encodeURIComponent(token)}`,
        kind: 'tunnel',
      });
    }
    for (const nic of listLanIpv4Addresses()) {
      urls.push({
        label: `局域网 (${nic.name}: ${nic.address})`,
        url: `http://${nic.address}:${actualPort}/mobile.html?token=${encodeURIComponent(token)}`,
        kind: 'lan',
      });
    }
    if (!urls.length) {
      urls.push({
        label: '本机回环',
        url: `http://127.0.0.1:${actualPort}/mobile.html?token=${encodeURIComponent(token)}`,
        kind: 'lan',
      });
    }
    return urls;
  }

  function buildStatePayloadSync() {
    const urls = buildCandidateUrls();
    return {
      sessionId: hub.sessionId,
      cameras: hub.cameraStates(),
      locate: hub.getLocateStatus(),
      history: history.slice(-20),
      mobileClients: mobileCount(),
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
    const primaryQrSvg = await getQrSvg(base.connection.primaryUrl);
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
    '/mobile.html': ['mobile.html', 'text/html; charset=utf-8', false],
    '/mobile.js': ['mobile.js', 'text/javascript; charset=utf-8', false],
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
        const svg = await getQrSvg(targetUrl);
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
        res.end(svg);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/events') {
        const role = url.searchParams.get('client') === 'mobile' ? 'mobile' : 'desktop';
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-store',
          Connection: 'keep-alive',
        });
        const client: SseClient = { id: randomUUID(), role, res };
        sseClients.add(client);
        const initial = await buildStatePayload();
        res.write(`event: state\ndata: ${JSON.stringify(initial)}\n\n`);
        broadcast('state', buildStatePayloadSync());

        const heartbeat = setInterval(() => {
          try {
            res.write(': ping\n\n');
          } catch {
            clearInterval(heartbeat);
            sseClients.delete(client);
          }
        }, 15_000);
        heartbeat.unref();

        req.on('close', () => {
          clearInterval(heartbeat);
          sseClients.delete(client);
          broadcast('state', buildStatePayloadSync());
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
        if (!EVIDENCE_NAME_RE.test(name)) {
          replyJson(400, { error: '非法的证据文件名' });
          return;
        }
        try {
          const bytes = await readFile(join(hub.evidenceDir, name));
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
        const question = typeof body.question === 'string' && body.question.trim()
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
        broadcast('state', buildStatePayloadSync());
        try {
          const snap = await hub.snapshotForVision();
          const result = await vision({
            mode,
            question,
            frames: snap.frames,
            missingDirections: snap.missingDirections,
          });
          const tokenParam = `?token=${encodeURIComponent(token)}`;
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
              url: `/api/evidence/${encodeURIComponent(e.filename)}${tokenParam}`,
            })),
            createdAtMs: Date.now(),
            source,
          };
          history.push(record);
          if (history.length > 40) history.splice(0, history.length - 40);
          broadcast('answer', record);
          broadcast('state', buildStatePayloadSync());
          replyJson(200, record);
        } finally {
          askBusy = false;
          broadcast('state', buildStatePayloadSync());
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
        broadcast('speak', payload);
        replyJson(200, { deliveredToMobileClients: mobileCount(), ...payload });
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

      replyJson(404, { error: '接口不存在' });
    } catch (error) {
      if (!res.headersSent) {
        replyJson(400, { error: error instanceof Error ? error.message : String(error) });
      } else {
        res.destroy();
      }
    }
  });

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
    void startTunnelAsync();
  }

  async function startTunnelAsync(): Promise<void> {
    try {
      if (!existsSync(cloudflaredBin)) {
        await installCloudflared(cloudflaredBin, process.env.CLOUDFLARED_VERSION || 'latest');
      }
      const tunnel = Tunnel.quick(`http://127.0.0.1:${actualPort}`);
      tunnelProc = tunnel;
      const issuedUrl = await new Promise<string>((resolveUrl, rejectUrl) => {
        const timer = setTimeout(() => rejectUrl(new Error('Cloudflare 隧道超时未分配 URL')), 45_000);
        tunnel.on('url', (candidate) => {
          try {
            const parsed = new URL(candidate);
            if (parsed.protocol === 'https:' && parsed.hostname.endsWith('.trycloudflare.com')) {
              clearTimeout(timer);
              resolveUrl(parsed.origin);
            }
          } catch {
            /* ignore */
          }
        });
        tunnel.once('exit', (code) => {
          clearTimeout(timer);
          rejectUrl(new Error(`Cloudflare 隧道提前退出 (${String(code)})`));
        });
      });
      tunnelUrl = issuedUrl;
      tunnelError = null;
      broadcast('state', await buildStatePayload());
    } catch (err) {
      tunnelError = err instanceof Error ? err.message : String(err);
      broadcast('state', buildStatePayloadSync());
    }
  }

  async function close(): Promise<void> {
    if (tunnelProc) {
      try {
        tunnelProc.stop();
      } catch {
        /* ignore */
      }
      tunnelProc = null;
    }
    for (const client of sseClients) {
      try {
        client.res.end();
      } catch {
        /* ignore */
      }
    }
    sseClients.clear();
    await hub.close();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }

  return {
    server,
    hub,
    token,
    get port() {
      return actualPort;
    },
    getConnectionUrls: buildCandidateUrls,
    close,
  };
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const portIdx = args.indexOf('--port');
  const portArg = portIdx >= 0 ? Number(args[portIdx + 1]) : undefined;
  if (portArg !== undefined && (!Number.isInteger(portArg) || portArg < 1 || portArg > 65535)) {
    throw new Error('Invalid --port value');
  }
  const hostIdx = args.indexOf('--host');
  const hostArg = hostIdx >= 0 ? args[hostIdx + 1] : undefined;
  const noCameras = args.includes('--no-cameras');
  const enableTunnel = args.includes('--tunnel');

  const demo = await createDemoServer({
    ...(portArg !== undefined ? { port: portArg } : {}),
    ...(hostArg ? { host: hostArg } : {}),
    enableTunnel,
    hubOptions: {
      startCameraProcess: !noCameras,
    },
  });

  const urls = demo.getConnectionUrls();
  process.stdout.write('\n=============================================\n');
  process.stdout.write(' First Sight 课程演示系统已启动\n');
  process.stdout.write(` 电脑主控台 (本机): http://127.0.0.1:${demo.port}/\n`);
  process.stdout.write(` 手机扫码入口 (局域网): ${urls[0]!.url}\n`);
  process.stdout.write(` 配对码 (Token): ${demo.token}\n`);
  if (enableTunnel) {
    process.stdout.write(' 正在后台启动 Cloudflare HTTPS 隧道，就绪后二维码将自动切换...\n');
  }
  if (!process.env.QWEN_API_KEY || !process.env.QWEN_BASE_URL) {
    process.stdout.write(' [提示] 尚未检测到 QWEN_API_KEY / QWEN_BASE_URL，提问功能暂不可用（预览/IP定位/语音测试仍可免费使用）。\n');
  }
  process.stdout.write(' 按 Ctrl+C 停止服务。\n');
  process.stdout.write('=============================================\n\n');

  const shutdown = () => {
    void demo.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runCli().catch((err) => {
    process.stderr.write(`Course demo failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
