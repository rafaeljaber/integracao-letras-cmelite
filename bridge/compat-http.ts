// Recebe as chamadas HTTP do CMElite (API de letras compatível) e as traduz para o plugin.
import { COMPAT_VERSION, PLUGIN_ACTIONS, type ClientEventKind } from '../src/protocol';
import type { AuthSessions } from './auth';

export type ForwardResult = { ok: true; data?: unknown } | { ok: false; error: string };

export interface HttpDeps {
  auth: AuthSessions;
  getToken(): string;
  forward(action: string, body: Record<string, unknown>): Promise<ForwardResult>;
  onEvent(e: { kind: ClientEventKind; remote: string; action?: string; reason?: string }): void;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export async function handleCompatRequest(req: Request, remote: string, deps: HttpDeps): Promise<Response> {
  const url = new URL(req.url);
  const match = /^\/api\/([A-Za-z0-9_]+)$/.exec(url.pathname);
  if (!match) return json(404, { status: 'error', error: 'not found' });
  const action = match[1];
  const raw = req.method === 'GET' ? '' : await req.text();
  const q = url.searchParams;

  const verdict = deps.auth.verify(action, { sid: q.get('sid'), rid: q.get('rid'), dtoken: q.get('dtoken'), token: q.get('token') }, raw, deps.getToken());
  if (verdict.kind === 'challenge') return json(200, { status: 'ok', data: { sid: verdict.sid, nonce: verdict.nonce } });
  if (verdict.kind === 'fail') {
    deps.onEvent({ kind: 'auth-fail', remote, action, reason: verdict.reason });
    return json(401, { status: 'error', error: verdict.reason });
  }
  if (action === 'Auth') {
    deps.onEvent({ kind: 'auth-ok', remote });
    return json(200, { status: 'ok' });
  }
  if (action === 'GetTokenInfo') {
    return json(200, { status: 'ok', data: { version: COMPAT_VERSION, permissions: [...PLUGIN_ACTIONS, 'GetTokenInfo'].join(',') } });
  }

  let body: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json(400, { status: 'error', error: 'invalid json' });
      body = parsed as Record<string, unknown>;
    } catch {
      return json(400, { status: 'error', error: 'invalid json' });
    }
  }

  deps.onEvent({ kind: 'request', remote, action });
  const result = await deps.forward(action, body);
  if (!result.ok) return json(200, { status: 'error', error: result.error });
  return json(200, 'data' in result ? { status: 'ok', data: result.data } : { status: 'ok' });
}
