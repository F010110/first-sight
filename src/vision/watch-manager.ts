import { randomUUID } from 'node:crypto';
import type { CameraHub } from '../camera-hub.js';
import type { SessionStore } from '../recording/session-store.js';
import type { WatchAlertRecord, WatchCheckProvider, WatchTask } from '../types.js';

export interface WatchManagerOptions {
  intervalMs?: number;
  defaultTtlSeconds?: number;
  alertCooldownMs?: number;
  tokenSuffix?: string;
  onUpdate?: () => void;
  onAlert?: (alert: WatchAlertRecord) => void;
}

export class WatchManager {
  private readonly intervalMs: number;
  private readonly defaultTtlSeconds: number;
  private readonly alertCooldownMs: number;
  private readonly tokenSuffix: string;
  private readonly onUpdate: (() => void) | undefined;
  private readonly onAlert: ((alert: WatchAlertRecord) => void) | undefined;

  private task: WatchTask | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;
  private checking = false;
  private lastFingerprint = '';
  private consecutiveErrors = 0;
  private closed = false;

  constructor(
    private readonly cameraHub: CameraHub,
    private readonly sessionStore: SessionStore,
    private readonly checker: WatchCheckProvider,
    options: WatchManagerOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 4000;
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? 600;
    this.alertCooldownMs = options.alertCooldownMs ?? 12_000;
    this.tokenSuffix = options.tokenSuffix ?? '';
    this.onUpdate = options.onUpdate;
    this.onAlert = options.onAlert;
  }

  status(): WatchTask | null {
    return this.task ? structuredClone(this.task) : null;
  }

  start(rawTarget: string, ttlSeconds = this.defaultTtlSeconds): WatchTask {
    if (this.closed) throw new Error('服务已关闭');
    const target = rawTarget.trim();
    if (!target || target.length > 200) {
      throw new Error('关注目标长度必须在 1..200 字之间');
    }
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 5 || ttlSeconds > 3600) {
      throw new Error('关注时长须在 5..3600 秒之间');
    }
    if (!this.cameraHub.hasAvailableFrame()) {
      throw new Error('当前暂无相机画面，请先定位相机或注入测试图再开启关注');
    }

    this.clearTimer();
    this.epoch++;
    this.lastFingerprint = '';
    this.consecutiveErrors = 0;

    const now = Date.now();
    this.task = {
      id: randomUUID(),
      target,
      status: 'active',
      createdAtMs: now,
      expiresAtMs: now + Math.round(ttlSeconds * 1000),
      checks: 0,
      hitCount: 0,
      lastCheckedAtMs: null,
      lastAlertAtMs: null,
      alert: null,
      error: null,
    };

    const runEpoch = this.epoch;
    this.onUpdate?.();
    this.scheduleNext(10, runEpoch);
    return structuredClone(this.task);
  }

  cancel(): WatchTask | null {
    this.clearTimer();
    this.epoch++;
    if (this.task && this.task.status === 'active') {
      this.task.status = 'cancelled';
      this.onUpdate?.();
    }
    return this.status();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number, runEpoch: number): void {
    this.clearTimer();
    if (this.closed || runEpoch !== this.epoch || this.task?.status !== 'active') return;
    this.timer = setTimeout(() => {
      void this.tick(runEpoch);
    }, delayMs);
    this.timer.unref();
  }

  private async tick(runEpoch: number): Promise<void> {
    if (this.closed || runEpoch !== this.epoch || !this.task || this.task.status !== 'active') {
      return;
    }

    const now = Date.now();
    if (now >= this.task.expiresAtMs) {
      this.task.status = 'expired';
      this.clearTimer();
      this.onUpdate?.();
      return;
    }

    if (this.checking) {
      this.scheduleNext(this.intervalMs, runEpoch);
      return;
    }

    const fp = this.cameraHub.frameFingerprint();
    if (!fp || fp === this.lastFingerprint) {
      this.scheduleNext(this.intervalMs, runEpoch);
      return;
    }

    const { frames, rawBuffers, missingDirections } = this.cameraHub.peekForVision(now);
    if (!frames.length) {
      this.scheduleNext(this.intervalMs, runEpoch);
      return;
    }

    this.checking = true;
    try {
      const result = await this.checker({
        target: this.task.target,
        frames,
        missingDirections,
      });

      if (this.closed || runEpoch !== this.epoch || !this.task || this.task.status !== 'active') {
        return;
      }

      const checkedAt = Date.now();
      this.lastFingerprint = fp;
      this.consecutiveErrors = 0;
      this.task.error = null;
      this.task.checks++;
      this.task.lastCheckedAtMs = checkedAt;

      if (checkedAt >= this.task.expiresAtMs && !result.found) {
        this.task.status = 'expired';
        this.clearTimer();
        this.onUpdate?.();
        return;
      }

      if (result.found) {
        const cooldownElapsed =
          this.task.lastAlertAtMs === null || checkedAt - this.task.lastAlertAtMs >= this.alertCooldownMs;
        if (cooldownElapsed) {
          const evidenceFiles = await this.cameraHub.persistEvidence(this.sessionStore, rawBuffers, checkedAt);
          if (this.closed || runEpoch !== this.epoch || !this.task || this.task.status !== 'active') {
            return;
          }
          const spokenText = `注意，在你的${result.direction}发现了${this.task.target}。${result.summary}`;
          const alert: WatchAlertRecord = {
            id: randomUUID(),
            speakId: randomUUID(),
            target: this.task.target,
            direction: result.direction,
            summary: result.summary,
            spokenText,
            model: result.model,
            latencyMs: result.latencyMs,
            evidenceUrls: evidenceFiles.map((e) => ({
              direction: e.direction,
              filename: e.filename,
              url: `/api/evidence/${encodeURIComponent(e.filename)}${this.tokenSuffix}`,
            })),
            createdAtMs: checkedAt,
          };
          await this.sessionStore.appendWatchAlert(alert);
          this.task.hitCount++;
          this.task.lastAlertAtMs = checkedAt;
          this.task.alert = alert;
          this.onAlert?.(alert);
        }
        if (checkedAt >= this.task.expiresAtMs) {
          this.task.status = 'expired';
          this.clearTimer();
          this.onUpdate?.();
          return;
        }
        this.onUpdate?.();
        this.scheduleNext(this.intervalMs, runEpoch);
        return;
      }

      this.onUpdate?.();
      this.scheduleNext(this.intervalMs, runEpoch);
    } catch (error) {
      if (this.closed || runEpoch !== this.epoch || !this.task || this.task.status !== 'active') {
        return;
      }
      this.consecutiveErrors++;
      this.task.error = error instanceof Error ? error.message : String(error);
      if (this.consecutiveErrors >= 3) {
        this.task.status = 'failed';
        this.clearTimer();
      } else {
        this.scheduleNext(this.intervalMs, runEpoch);
      }
      this.onUpdate?.();
    } finally {
      this.checking = false;
    }
  }

  close(): void {
    this.closed = true;
    this.epoch++;
    this.clearTimer();
  }
}
