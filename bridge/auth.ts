// Autenticação da API de letras compatível: desafio (nonce) + hash por chamada, com rid crescente.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function dtokenFor(nonce: string, rid: number | string, token: string, data: string): string {
  return createHash('sha256').update(`${nonce}:${rid}:${token}:${data}`, 'utf8').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface AuthParams {
  sid: string | null;
  rid: string | null;
  dtoken: string | null;
  token: string | null;
}

export type AuthVerdict = { kind: 'challenge'; sid: string; nonce: string } | { kind: 'ok' } | { kind: 'fail'; reason: string };

interface Session {
  nonce: string;
  authenticated: boolean;
  lastRid: number;
  lastUsed: number;
}

const TWELVE_HOURS = 12 * 60 * 60 * 1000;

export class AuthSessions {
  private sessions = new Map<string, Session>();

  constructor(private opts: { now?: () => number; ttlMs?: number; random?: (bytes: number) => string } = {}) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private random(bytes: number): string {
    return this.opts.random ? this.opts.random(bytes) : randomBytes(bytes).toString('hex');
  }

  private prune(): void {
    const ttl = this.opts.ttlMs ?? TWELVE_HOURS;
    const t = this.now();
    for (const [sid, s] of this.sessions) if (t - s.lastUsed > ttl) this.sessions.delete(sid);
  }

  verify(action: string, p: AuthParams, body: string, accessToken: string): AuthVerdict {
    if (!accessToken) return { kind: 'fail', reason: 'token não configurado' };
    this.prune();

    if (p.token !== null) return safeEqual(p.token, accessToken) ? { kind: 'ok' } : { kind: 'fail', reason: 'invalid token' };

    if (p.sid === null && p.dtoken === null) {
      if (action !== 'Auth') return { kind: 'fail', reason: 'unauthorized' };
      const sid = this.random(6);
      const nonce = this.random(16);
      this.sessions.set(sid, { nonce, authenticated: false, lastRid: -1, lastUsed: this.now() });
      return { kind: 'challenge', sid, nonce };
    }

    const s = p.sid !== null ? this.sessions.get(p.sid) : undefined;
    if (!s) return { kind: 'fail', reason: 'invalid session' };
    const rid = Number(p.rid);
    if (!Number.isInteger(rid) || rid < 0 || !p.dtoken) return { kind: 'fail', reason: 'unauthorized' };

    if (action === 'Auth') {
      if (s.authenticated) return { kind: 'fail', reason: 'invalid rid' };
      if (rid !== 0 || !safeEqual(p.dtoken, dtokenFor(s.nonce, 0, accessToken, 'auth'))) return { kind: 'fail', reason: 'invalid token' };
      s.authenticated = true;
      s.lastRid = 0;
      s.lastUsed = this.now();
      return { kind: 'ok' };
    }

    if (!s.authenticated) return { kind: 'fail', reason: 'unauthorized' };
    if (rid <= s.lastRid) return { kind: 'fail', reason: 'invalid rid' };
    if (!safeEqual(p.dtoken, dtokenFor(s.nonce, rid, accessToken, body))) return { kind: 'fail', reason: 'invalid token' };
    s.lastRid = rid;
    s.lastUsed = this.now();
    return { kind: 'ok' };
  }
}
