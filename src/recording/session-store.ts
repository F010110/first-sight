import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { QaRecord, ReplayEvent, SessionSummary, WatchAlertRecord } from '../types.js';

export const EVIDENCE_NAME_RE = /^[0-9a-zA-Z_-]+\.jpg$/;
export const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SessionStore {
  readonly sessionDir: string;
  readonly evidenceDir: string;
  readonly eventsPath: string;
  readonly metaPath: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(
    readonly dataRoot: string,
    readonly sessionId: string,
    readonly startedAtMs = Date.now(),
  ) {
    this.sessionDir = join(resolve(dataRoot), 'sessions', sessionId);
    this.evidenceDir = join(this.sessionDir, 'evidence');
    this.eventsPath = join(this.sessionDir, 'events.jsonl');
    this.metaPath = join(this.sessionDir, 'meta.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.evidenceDir, { recursive: true });
    await writeFile(
      this.metaPath,
      JSON.stringify({ sessionId: this.sessionId, startedAtMs: this.startedAtMs }, null, 2),
      'utf8',
    );
    this.initialized = true;
  }

  evidencePath(filename: string): string {
    if (!EVIDENCE_NAME_RE.test(filename)) {
      throw new Error('非法的证据文件名');
    }
    return join(this.evidenceDir, filename);
  }

  async saveEvidence(filename: string, bytes: Buffer): Promise<void> {
    await this.init();
    await writeFile(this.evidencePath(filename), bytes);
  }

  private appendEvent(event: ReplayEvent): Promise<void> {
    const job = this.writeQueue.then(async () => {
      await this.init();
      await appendFile(this.eventsPath, JSON.stringify(event) + '\n', 'utf8');
    });
    this.writeQueue = job.catch(() => {});
    return job;
  }

  appendQa(record: QaRecord): Promise<void> {
    return this.appendEvent({ kind: 'qa', record });
  }

  appendWatchAlert(record: WatchAlertRecord): Promise<void> {
    return this.appendEvent({ kind: 'watch-alert', record });
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }
}

export async function listSessions(dataRoot: string): Promise<SessionSummary[]> {
  const sessionsRoot = join(resolve(dataRoot), 'sessions');
  let entries;
  try {
    entries = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const summaries: SessionSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SESSION_UUID_RE.test(entry.name)) continue;
    const dir = join(sessionsRoot, entry.name);
    let startedAtMs = 0;
    try {
      const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as { startedAtMs?: number };
      if (typeof meta.startedAtMs === 'number') startedAtMs = meta.startedAtMs;
    } catch {
      continue;
    }

    let qaCount = 0;
    let alertCount = 0;
    try {
      const raw = await readFile(join(dir, 'events.jsonl'), 'utf8');
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as { kind?: string };
          if (parsed.kind === 'qa') qaCount++;
          else if (parsed.kind === 'watch-alert') alertCount++;
        } catch {
          /* skip malformed trailing line */
        }
      }
    } catch {
      /* no events yet */
    }

    const eventCount = qaCount + alertCount;
    if (eventCount === 0) continue;
    summaries.push({ sessionId: entry.name, startedAtMs, eventCount, qaCount, alertCount });
  }

  summaries.sort((a, b) => b.startedAtMs - a.startedAtMs);
  return summaries;
}

export async function readSession(
  dataRoot: string,
  sessionId: string,
  tokenSuffix = '',
): Promise<{ sessionId: string; startedAtMs: number; events: ReplayEvent[] }> {
  if (!SESSION_UUID_RE.test(sessionId)) {
    throw new Error('非法的回放会话 ID');
  }
  const dir = join(resolve(dataRoot), 'sessions', sessionId);
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as { startedAtMs?: number };
  const startedAtMs = typeof meta.startedAtMs === 'number' ? meta.startedAtMs : 0;

  let eventsRaw = '';
  try {
    eventsRaw = await readFile(join(dir, 'events.jsonl'), 'utf8');
  } catch {
    eventsRaw = '';
  }

  const events: ReplayEvent[] = [];
  for (const line of eventsRaw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const evt = JSON.parse(trimmed) as ReplayEvent;
    evt.record.evidenceUrls = (evt.record.evidenceUrls || []).map((ev) => {
      const name = ev.filename || ev.url.split('/').pop()?.split('?')[0] || '';
      return {
        direction: ev.direction,
        filename: name,
        url: `/api/replay/evidence/${encodeURIComponent(sessionId)}/${encodeURIComponent(name)}${tokenSuffix}`,
      };
    });
    events.push(evt);
  }

  return { sessionId, startedAtMs, events };
}

export async function readSessionEvidence(dataRoot: string, sessionId: string, filename: string): Promise<Buffer> {
  if (!SESSION_UUID_RE.test(sessionId) || !EVIDENCE_NAME_RE.test(filename)) {
    throw new Error('非法的回放证据路径');
  }
  const path = join(resolve(dataRoot), 'sessions', sessionId, 'evidence', filename);
  return readFile(path);
}
