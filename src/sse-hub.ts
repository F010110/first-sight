import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface SseClient {
  id: string;
  role: 'desktop' | 'mobile';
  res: ServerResponse;
  heartbeat: ReturnType<typeof setInterval>;
}

export class SseHub {
  private readonly clients = new Set<SseClient>();

  mobileCount(): number {
    let count = 0;
    for (const c of this.clients) {
      if (c.role === 'mobile') count++;
    }
    return count;
  }

  broadcast(eventName: string, payload: unknown, excludeClientId?: string): void {
    const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.clients) {
      if (excludeClientId && client.id === excludeClientId) continue;
      try {
        client.res.write(data);
      } catch {
        clearInterval(client.heartbeat);
        this.clients.delete(client);
      }
    }
  }

  async addClient(
    req: IncomingMessage,
    res: ServerResponse,
    role: 'desktop' | 'mobile',
    buildInitialState: () => Promise<unknown>,
    onMembershipChange?: (joinedClientId?: string) => void,
  ): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
    });

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
        this.clients.delete(client);
      }
    }, 15_000);
    heartbeat.unref();

    const client: SseClient = { id: randomUUID(), role, res, heartbeat };
    this.clients.add(client);

    req.on('close', () => {
      clearInterval(client.heartbeat);
      if (this.clients.delete(client)) {
        onMembershipChange?.();
      }
    });

    const initialState = await buildInitialState();
    if (!this.clients.has(client)) return;
    res.write(`event: state\ndata: ${JSON.stringify(initialState)}\n\n`);
    onMembershipChange?.(client.id);
  }

  close(): void {
    for (const client of this.clients) {
      clearInterval(client.heartbeat);
      try {
        client.res.end();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }
}
