import { existsSync } from 'node:fs';
import { Tunnel, bin as cloudflaredBin, install as installCloudflared } from 'cloudflared';
import QRCode from 'qrcode';

export class QrCache {
  private readonly cache = new Map<string, string>();

  async getSvg(url: string): Promise<string> {
    const hit = this.cache.get(url);
    if (hit) return hit;
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1 });
    this.cache.set(url, svg);
    return svg;
  }
}

export class TunnelManager {
  private proc: Tunnel | null = null;
  private url: string | null = null;
  private error: string | null = null;

  getState(): { tunnelUrl: string | null; tunnelError: string | null } {
    return { tunnelUrl: this.url, tunnelError: this.error };
  }

  async start(port: number, onUpdate: () => void | Promise<void>): Promise<void> {
    try {
      if (!existsSync(cloudflaredBin)) {
        await installCloudflared(cloudflaredBin, process.env.CLOUDFLARED_VERSION || 'latest');
      }
      const tunnel = Tunnel.quick(`http://127.0.0.1:${port}`);
      this.proc = tunnel;
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
      this.url = issuedUrl;
      this.error = null;
      await onUpdate();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      await onUpdate();
    }
  }

  stop(): void {
    if (!this.proc) return;
    try {
      this.proc.stop();
    } catch {
      /* ignore */
    }
    this.proc = null;
  }
}
