import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CameraDirection, VisionFrame } from './qwen-vision.js';

export const CAMERA_DIRECTIONS: readonly CameraDirection[] = ['front', 'left', 'right'];

export interface CameraFrameEntry {
  id: string;
  direction: CameraDirection;
  cameraId: string;
  host: string;
  atMs: number;
  sha256: string;
  bytes: Buffer;
  rssi: string | null;
  channel: string | null;
  source: 'esp32' | 'manual';
}

export interface CameraHealthEntry {
  direction: CameraDirection;
  cameraId: string | null;
  host: string | null;
  status: 'online' | 'stale' | 'error' | 'unconfigured' | 'waiting';
  error: string | null;
  lastFrameId: string | null;
  lastFrameAtMs: number | null;
  rssi: string | null;
  channel: string | null;
  source: 'esp32' | 'manual' | null;
}

export interface LocateStatus {
  running: boolean;
  message: string;
  found: Record<string, string>;
  missing: string[];
  scannedIps: number;
  updatedAtMs: number | null;
}

export interface CameraHubOptions {
  dataRoot?: string;
  pythonPath?: string;
  scriptPath?: string;
  configDir?: string;
  hostsFile?: string;
  startCameraProcess?: boolean;
  autoScanOnStart?: boolean;
  freshnessMs?: number;
  onEvent?: (event: { type: 'locate' | 'camera'; payload: unknown }) => void;
}

function defaultPythonPath(): string {
  const venvPython = resolve('cam/.venv/Scripts/python.exe');
  if (existsSync(venvPython)) return venvPython;
  return 'python';
}

export function isValidPrivateHostInput(host: string): boolean {
  const trimmed = host.trim();
  if (!trimmed || /\s/.test(trimmed) || trimmed.includes('://')) return false;
  const hostOnly = trimmed.split(':')[0] ?? '';
  if (/^first-sight-[0-9a-f]+\.local$/i.test(hostOnly)) return true;
  const parts = hostOnly.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return false;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  return false;
}

export class CameraHub {
  readonly sessionId = randomUUID();
  readonly dataRoot: string;
  readonly evidenceDir: string;
  readonly hostsFile: string;
  private readonly pythonPath: string;
  private readonly scriptPath: string;
  private readonly configDir: string;
  private readonly startCameraProcess: boolean;
  private readonly autoScanOnStart: boolean;
  private readonly freshnessMs: number;
  private readonly onEvent: ((event: { type: 'locate' | 'camera'; payload: unknown }) => void) | undefined;

  private proc: ChildProcess | null = null;
  private stdoutTail = '';
  private frames = new Map<CameraDirection, CameraFrameEntry>();
  private health = new Map<CameraDirection, CameraHealthEntry>();
  private locateState: LocateStatus = {
    running: false,
    message: '未启动',
    found: {},
    missing: [],
    scannedIps: 0,
    updatedAtMs: null,
  };
  private closed = false;

  constructor(options: CameraHubOptions = {}) {
    this.dataRoot = resolve(options.dataRoot ?? join('run', 'course-demo'));
    this.evidenceDir = join(this.dataRoot, 'sessions', this.sessionId, 'evidence');
    this.hostsFile = resolve(options.hostsFile ?? join(this.dataRoot, 'camera-hosts.json'));
    this.pythonPath = options.pythonPath ?? defaultPythonPath();
    this.scriptPath = resolve(options.scriptPath ?? 'cam/host/three_camera_demo.py');
    this.configDir = resolve(options.configDir ?? 'cam/local');
    this.startCameraProcess = options.startCameraProcess ?? true;
    this.autoScanOnStart = options.autoScanOnStart ?? true;
    this.freshnessMs = options.freshnessMs ?? 15_000;
    this.onEvent = options.onEvent;

    for (const dir of CAMERA_DIRECTIONS) {
      this.health.set(dir, {
        direction: dir,
        cameraId: null,
        host: null,
        status: this.startCameraProcess ? 'waiting' : 'waiting',
        error: null,
        lastFrameId: null,
        lastFrameAtMs: null,
        rssi: null,
        channel: null,
        source: null,
      });
    }
  }

  async start(): Promise<void> {
    await mkdir(this.evidenceDir, { recursive: true });
    if (!this.startCameraProcess) return;

    const args = [
      '-X',
      'utf8',
      this.scriptPath,
      '--config-dir',
      this.configDir,
      '--hosts-file',
      this.hostsFile,
      ...(this.autoScanOnStart ? [] : ['--no-auto-scan']),
    ];

    this.proc = spawn(this.pythonPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
    });

    this.proc.stdout?.on('data', (chunk: Buffer) => {
      this.stdoutTail += chunk.toString('utf8');
      let nl = this.stdoutTail.indexOf('\n');
      while (nl >= 0) {
        const line = this.stdoutTail.slice(0, nl).trim();
        this.stdoutTail = this.stdoutTail.slice(nl + 1);
        if (line) this.handlePythonLine(line);
        nl = this.stdoutTail.indexOf('\n');
      }
    });

    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const msg = chunk.toString('utf8').trim();
      if (msg) {
        this.locateState = {
          ...this.locateState,
          message: `采集进程日志: ${msg.slice(-160)}`,
          updatedAtMs: Date.now(),
        };
      }
    });

    this.proc.on('close', (code) => {
      if (this.closed) return;
      for (const dir of CAMERA_DIRECTIONS) {
        const cur = this.health.get(dir)!;
        if (cur.status !== 'unconfigured') {
          this.health.set(dir, {
            ...cur,
            status: 'error',
            error: `相机进程已退出 (code=${String(code)})`,
          });
        }
      }
      this.onEvent?.({ type: 'camera', payload: this.cameraStates() });
    });
  }

  private handlePythonLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const kind = msg.kind;
    if (kind === 'frame') {
      const dir = msg.direction as CameraDirection;
      if (!CAMERA_DIRECTIONS.includes(dir)) return;
      if (typeof msg.jpeg !== 'string' || typeof msg.sha256 !== 'string') return;
      const bytes = Buffer.from(msg.jpeg, 'base64');
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== msg.sha256) return;
      const atMs = typeof msg.atMs === 'number' ? msg.atMs : Date.now();
      const cameraId = typeof msg.cameraId === 'string' ? msg.cameraId : `esp32-${dir}`;
      const host = typeof msg.host === 'string' ? msg.host : '';
      const id = typeof msg.id === 'string' ? msg.id : `${dir}:${atMs}`;
      const rssi = typeof msg.rssi === 'string' ? msg.rssi : null;
      const channel = typeof msg.channel === 'string' ? msg.channel : null;
      this.frames.set(dir, {
        id,
        direction: dir,
        cameraId,
        host,
        atMs,
        sha256: digest,
        bytes,
        rssi,
        channel,
        source: 'esp32',
      });
      this.health.set(dir, {
        direction: dir,
        cameraId,
        host: host || null,
        status: 'online',
        error: null,
        lastFrameId: id,
        lastFrameAtMs: atMs,
        rssi,
        channel,
        source: 'esp32',
      });
      return;
    }

    if (kind === 'health') {
      const dir = msg.direction as CameraDirection;
      if (!CAMERA_DIRECTIONS.includes(dir)) return;
      const cur = this.health.get(dir)!;
      const status = msg.status === 'unconfigured' ? 'unconfigured' : msg.status === 'error' ? 'error' : 'waiting';
      this.health.set(dir, {
        ...cur,
        cameraId: typeof msg.cameraId === 'string' ? msg.cameraId : cur.cameraId,
        host: typeof msg.host === 'string' ? msg.host : cur.host,
        status,
        error: typeof msg.error === 'string' ? msg.error : null,
      });
      return;
    }

    if (kind === 'host_updated') {
      const dir = msg.direction as CameraDirection;
      if (CAMERA_DIRECTIONS.includes(dir) && typeof msg.host === 'string') {
        const cur = this.health.get(dir)!;
        this.health.set(dir, { ...cur, host: msg.host, error: null });
        this.onEvent?.({ type: 'camera', payload: this.cameraStates() });
      }
      return;
    }

    if (kind === 'locate_progress') {
      this.locateState = {
        ...this.locateState,
        running: true,
        message: typeof msg.message === 'string' ? msg.message : '正在定位相机...',
        updatedAtMs: Date.now(),
      };
      this.onEvent?.({ type: 'locate', payload: this.locateState });
      return;
    }

    if (kind === 'locate_done') {
      const found = (msg.found && typeof msg.found === 'object' ? msg.found : {}) as Record<string, string>;
      const missing = Array.isArray(msg.missing) ? msg.missing.map(String) : [];
      const scannedIps = typeof msg.scannedIps === 'number' ? msg.scannedIps : 0;
      const errText = typeof msg.error === 'string' ? `定位异常: ${msg.error}` : null;
      const foundList = Object.entries(found).map(([k, v]) => `${k}=${v}`);
      const summary = errText
        ? errText
        : foundList.length
          ? `定位完成 (${foundList.join(', ')})${missing.length ? `，未找到: ${missing.join(', ')}` : ''}`
          : `未在当前局域网定位到新相机${missing.length ? ` (${missing.join(', ')})` : ''}`;
      for (const [role, host] of Object.entries(found)) {
        if (CAMERA_DIRECTIONS.includes(role as CameraDirection)) {
          const cur = this.health.get(role as CameraDirection)!;
          this.health.set(role as CameraDirection, { ...cur, host, error: null });
        }
      }
      this.locateState = {
        running: false,
        message: summary,
        found,
        missing,
        scannedIps,
        updatedAtMs: Date.now(),
      };
      this.onEvent?.({ type: 'locate', payload: this.locateState });
      this.onEvent?.({ type: 'camera', payload: this.cameraStates() });
    }
  }

  injectManualFrame(direction: CameraDirection, jpegBytes: Buffer): CameraFrameEntry {
    if (!CAMERA_DIRECTIONS.includes(direction)) {
      throw new Error(`无效相机方向: ${direction}`);
    }
    if (jpegBytes.length < 4 || jpegBytes.length > 1_500_000) {
      throw new Error('测试图片大小必须在 4B..1.5MB 之间');
    }
    if (jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) {
      throw new Error('仅支持 JPEG 格式测试图片');
    }
    const sha256 = createHash('sha256').update(jpegBytes).digest('hex');
    const atMs = Date.now();
    const id = `manual-${direction}-${atMs}`;
    const entry: CameraFrameEntry = {
      id,
      direction,
      cameraId: `manual-${direction}`,
      host: 'manual-upload',
      atMs,
      sha256,
      bytes: jpegBytes,
      rssi: null,
      channel: null,
      source: 'manual',
    };
    this.frames.set(direction, entry);
    this.health.set(direction, {
      direction,
      cameraId: entry.cameraId,
      host: 'manual-upload',
      status: 'online',
      error: null,
      lastFrameId: id,
      lastFrameAtMs: atMs,
      rssi: null,
      channel: null,
      source: 'manual',
    });
    this.onEvent?.({ type: 'camera', payload: this.cameraStates() });
    return entry;
  }

  setHosts(updates: Partial<Record<CameraDirection, string>>): void {
    for (const dir of CAMERA_DIRECTIONS) {
      const host = updates[dir];
      if (host === undefined || !host.trim()) continue;
      if (!isValidPrivateHostInput(host)) {
        throw new Error(`相机 ${dir} IP 必须是局域网私有地址或 first-sight-*.local，当前值无效: ${host}`);
      }
      const trimmed = host.trim();
      const cur = this.health.get(dir)!;
      this.health.set(dir, { ...cur, host: trimmed, error: null });
      if (this.proc?.stdin && !this.proc.stdin.destroyed) {
        this.proc.stdin.write(JSON.stringify({ cmd: 'set_host', direction: dir, host: trimmed }) + '\n');
      }
    }
    this.onEvent?.({ type: 'camera', payload: this.cameraStates() });
  }

  triggerLocate(subnets: string[] = [], force = true): void {
    if (!this.proc?.stdin || this.proc.stdin.destroyed) {
      this.locateState = {
        ...this.locateState,
        running: false,
        message: '未启动物理相机接收进程（--no-cameras 模式）',
        updatedAtMs: Date.now(),
      };
      this.onEvent?.({ type: 'locate', payload: this.locateState });
      return;
    }
    this.locateState = {
      ...this.locateState,
      running: true,
      message: '已下发自动定位指令，正在探测相机 IP...',
      updatedAtMs: Date.now(),
    };
    this.onEvent?.({ type: 'locate', payload: this.locateState });
    this.proc.stdin.write(JSON.stringify({ cmd: 'locate', subnets, force }) + '\n');
  }

  getFrame(direction: CameraDirection): CameraFrameEntry | null {
    return this.frames.get(direction) ?? null;
  }

  cameraStates(nowMs = Date.now()): CameraHealthEntry[] {
    return CAMERA_DIRECTIONS.map((dir) => {
      const cur = this.health.get(dir)!;
      const frame = this.frames.get(dir);
      if (frame) {
        const ageMs = nowMs - frame.atMs;
        if (cur.status === 'online' && ageMs > this.freshnessMs) {
          return { ...cur, status: 'stale' };
        }
      }
      return { ...cur };
    });
  }

  getLocateStatus(): LocateStatus {
    return { ...this.locateState };
  }

  async snapshotForVision(nowMs = Date.now()): Promise<{
    frames: VisionFrame[];
    missingDirections: CameraDirection[];
    evidenceFiles: Array<{ direction: CameraDirection; filename: string }>;
  }> {
    const frames: VisionFrame[] = [];
    const missingDirections: CameraDirection[] = [];
    const evidenceFiles: Array<{ direction: CameraDirection; filename: string }> = [];
    const batchTag = `${nowMs}-${randomUUID().slice(0, 6)}`;

    for (const dir of CAMERA_DIRECTIONS) {
      const entry = this.frames.get(dir);
      if (!entry) {
        missingDirections.push(dir);
        continue;
      }
      const ageMs = Math.max(0, nowMs - entry.atMs);
      const filename = `${batchTag}-${dir}.jpg`;
      await writeFile(join(this.evidenceDir, filename), entry.bytes);
      evidenceFiles.push({ direction: dir, filename });
      frames.push({
        direction: dir,
        id: entry.id,
        atMs: entry.atMs,
        ageMs,
        sha256: entry.sha256,
        jpegBase64: entry.bytes.toString('base64'),
        source: entry.source,
      });
    }

    if (!frames.length) {
      throw new Error('当前没有任何可用相机画面（前/左/右均离线），请先定位相机 IP 或上传测试图片');
    }

    return { frames, missingDirections, evidenceFiles };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const proc = this.proc;
    if (!proc) return;
    try {
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.write(JSON.stringify({ cmd: 'stop' }) + '\n');
        proc.stdin.end();
      }
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolveExit) => {
      if (proc.exitCode !== null) {
        resolveExit();
        return;
      }
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
        resolveExit();
      }, 1500);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolveExit();
      });
    });
  }
}
