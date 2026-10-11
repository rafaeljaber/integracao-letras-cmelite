import { beforeEach, describe, expect, test } from 'bun:test';
import { AuthSessions, dtokenFor } from '../bridge/auth';
import { handleCompatRequest, type ForwardResult, type HttpDeps } from '../bridge/compat-http';

let events: Array<{ kind: string; action?: string }>;
let forwarded: Array<{ action: string; body: Record<string, unknown> }>;
let reply: ForwardResult;
let deps: HttpDeps;

beforeEach(() => {
  events = [];
  forwarded = [];
  reply = { ok: true };
  deps = {
    auth: new AuthSessions(),
    getToken: () => 'segredo',
    forward: async (action, body) => {
      forwarded.push({ action, body });
      return reply;
    },
    onEvent: (e) => events.push({ kind: e.kind, action: e.action }),
  };
});

const post = (path: string, body = '') =>
  handleCompatRequest(new Request(`http://ponte${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }), '10.0.0.5', deps);

async function login() {
  const c = (await (await post('/api/Auth')).json()) as { data: { sid: string; nonce: string } };
  const { sid, nonce } = c.data;
  const r = await post(`/api/Auth?sid=${sid}&rid=0&dtoken=${dtokenFor(nonce, 0, 'segredo', 'auth')}`);
  let rid = 0;
  const call = (action: string, body = '') => {
    rid += 1;
    return post(`/api/${action}?sid=${sid}&rid=${rid}&dtoken=${dtokenFor(nonce, rid, 'segredo', body)}`, body);
  };
  return { r, call };
}

describe('handleCompatRequest', () => {
  test('login em duas etapas e evento auth-ok', async () => {
    const { r } = await login();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: 'ok' });
    expect(events).toEqual([{ kind: 'auth-ok', action: undefined }]);
  });
  test('GetTokenInfo é respondido pela ponte', async () => {
    const { call } = await login();
    expect(await (await call('GetTokenInfo')).json()).toEqual({
      status: 'ok',
      data: { version: '2.25.0', permissions: 'SearchLyrics,GetLyrics,ShowLyrics,ShowQuickPresentation,CloseCurrentPresentation,GetTokenInfo' },
    });
    expect(forwarded).toEqual([]);
  });
  test('ações vão ao plugin com o corpo já interpretado', async () => {
    const { call } = await login();
    reply = { ok: true, data: [{ id: 'g1' }] };
    const r = await call('SearchLyrics', '{"text":"Bom Perfume","fields":"id,title,artist,author"}');
    expect(await r.json()).toEqual({ status: 'ok', data: [{ id: 'g1' }] });
    expect(forwarded).toEqual([{ action: 'SearchLyrics', body: { text: 'Bom Perfume', fields: 'id,title,artist,author' } }]);
    expect(events.at(-1)).toEqual({ kind: 'request', action: 'SearchLyrics' });
  });
  test('data null é preservado; sem data responde só ok', async () => {
    const { call } = await login();
    reply = { ok: true, data: null };
    expect(await (await call('GetLyrics', '{"id":"x"}')).json()).toEqual({ status: 'ok', data: null });
    reply = { ok: true };
    expect(await (await call('CloseCurrentPresentation')).json()).toEqual({ status: 'ok' });
  });
  test('erro do plugin vira status error', async () => {
    const { call } = await login();
    reply = { ok: false, error: 'Spresenter desconectado' };
    expect(await (await call('ShowLyrics', '{"id":"g1"}')).json()).toEqual({ status: 'error', error: 'Spresenter desconectado' });
  });
  test('token errado: 401, evento auth-fail e nada vai ao plugin', async () => {
    const c = (await (await post('/api/Auth')).json()) as { data: { sid: string; nonce: string } };
    const r = await post(`/api/Auth?sid=${c.data.sid}&rid=0&dtoken=${dtokenFor(c.data.nonce, 0, 'errado', 'auth')}`);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ status: 'error', error: 'invalid token' });
    expect(events).toEqual([{ kind: 'auth-fail', action: 'Auth' }]);
    expect(forwarded).toEqual([]);
  });
  test('JSON inválido é recusado sem ir ao plugin', async () => {
    const { call } = await login();
    expect((await call('ShowLyrics', '{nao é json')).status).toBe(400);
    expect(forwarded).toEqual([]);
  });
  test('auth-fail leva o motivo para o painel', async () => {
    const seen: Array<{ kind: string; reason?: string }> = [];
    deps.onEvent = (e) => seen.push({ kind: e.kind, reason: (e as { reason?: string }).reason });
    const r = await post('/api/ShowLyrics?sid=nao-existe&rid=1&dtoken=x', '{}');
    expect(r.status).toBe(401);
    expect(seen).toEqual([{ kind: 'auth-fail', reason: 'invalid session' }]);
  });
  test('caminho fora de /api/<Ação> é 404', async () => {
    expect((await post('/outra/coisa')).status).toBe(404);
  });
});
