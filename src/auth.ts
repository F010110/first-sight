import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { networkInterfaces } from 'node:os';

export function constantTimeTokenMatch(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isDirectLoopback(req: IncomingMessage, port: number): boolean {
  if (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']) {
    return false;
  }
  const remote = req.socket.remoteAddress ?? '';
  const loopbackAddr = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (!loopbackAddr) return false;
  const host = req.headers.host ?? '';
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function extractRequestToken(req: IncomingMessage, url: URL): string {
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

export function listLanIpv4Addresses(): Array<{ name: string; address: string }> {
  const nets = networkInterfaces();
  const list: Array<{ name: string; address: string; score: number }> = [];
  for (const [name, entries] of Object.entries(nets)) {
    if (!entries) continue;
    const lower = name.toLowerCase();
    if (
      lower.includes('vethernet') ||
      lower.includes('vmware') ||
      lower.includes('virtualbox') ||
      lower.includes('wsl') ||
      lower.includes('loopback')
    ) {
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
