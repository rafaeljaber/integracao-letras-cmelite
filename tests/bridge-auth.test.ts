import { describe, expect, test } from 'bun:test';
import { AuthSessions, dtokenFor, type AuthParams } from '../bridge/auth';

const none: AuthParams = { sid: null, rid: null, dtoken: null, token: null };

describe('dtokenFor', () => {
  test('gabaritos da spec', () => {
    expect(dtokenFor('1a2b3c', 4, 'abcdef', '{}')).toBe('f3391f69cbe03940bd0d4a63ee191092aab2f3573f56b410a9cf94da05d4cdb5');
    expect(dtokenFor('1a2b3c', 5, 'abcdef', '{"text": "Example", "show": true, "display_ahead": true}')).toBe(
      '02a7789759694c535cd032489bf101110837c972d76cec51c7ad7e797696749d',
    );
    expect(dtokenFor('b58ba4f605bed27c40a20be53ee3cf3d', 0, '1234', 'auth')).toBe('7a34b2de74f096ea79ca1e2fca28a99995805c6b002cc20949b7ea236dd5922f');
  });
  test('corpo com acentos é assinado em UTF-8', () => {
    expect(dtokenFor('1a2b3c', 7, 'abcdef', '{"text":"[Refrão] Pré-refrão — linha"}')).toBe(
      '7725e976f90e7e53a3c28296af86ec6d96819afa79ed0db4e698491203da47b6',
    );
  });
});

function handshake(auth: AuthSessions, token: string) {
  const c = auth.verify('Auth', none, '', token);
  if (c.kind !== 'challenge') throw new Error('esperava desafio');
  const ok = auth.verify('Auth', { sid: c.sid, rid: '0', dtoken: dtokenFor(c.nonce, 0, token, 'auth'), token: null }, '', token);
  return { sid: c.sid, nonce: c.nonce, ok };
}
const call = (auth: AuthSessions, s: { sid: string; nonce: string }, rid: number, body: string) =>
  auth.verify('SearchLyrics', { sid: s.sid, rid: String(rid), dtoken: dtokenFor(s.nonce, rid, 'segredo', body), token: null }, body, 'segredo');

describe('AuthSessions', () => {
  test('fluxo completo como o CMElite', () => {
    const auth = new AuthSessions();
    const s = handshake(auth, 'segredo');
    expect(s.ok).toEqual({ kind: 'ok' });
    expect(call(auth, s, 1, '')).toEqual({ kind: 'ok' });
    expect(call(auth, s, 2, '{"text":"Refrão"}')).toEqual({ kind: 'ok' });
  });
  test('token errado no Auth é recusado', () => {
    const auth = new AuthSessions();
    const c = auth.verify('Auth', none, '', 'segredo');
    if (c.kind !== 'challenge') throw new Error('esperava desafio');
    expect(auth.verify('Auth', { sid: c.sid, rid: '0', dtoken: dtokenFor(c.nonce, 0, 'errado', 'auth'), token: null }, '', 'segredo')).toEqual({
      kind: 'fail',
      reason: 'invalid token',
    });
  });
  test('rid repetido ou menor é recusado', () => {
    const auth = new AuthSessions();
    const s = handshake(auth, 'segredo');
    expect(call(auth, s, 5, '')).toEqual({ kind: 'ok' });
    expect(call(auth, s, 5, '')).toEqual({ kind: 'fail', reason: 'invalid rid' });
    expect(call(auth, s, 3, '')).toEqual({ kind: 'fail', reason: 'invalid rid' });
  });
  test('repetir a 2ª etapa do login não reabre a sessão nem zera o rid', () => {
    const auth = new AuthSessions();
    const c = auth.verify('Auth', none, '', 'segredo');
    if (c.kind !== 'challenge') throw new Error('esperava desafio');
    const step2 = { sid: c.sid, rid: '0', dtoken: dtokenFor(c.nonce, 0, 'segredo', 'auth'), token: null };
    expect(auth.verify('Auth', step2, '', 'segredo')).toEqual({ kind: 'ok' });
    expect(call(auth, c, 1, '')).toEqual({ kind: 'ok' });
    expect(auth.verify('Auth', step2, '', 'segredo')).toEqual({ kind: 'fail', reason: 'invalid rid' });
    expect(call(auth, c, 1, '')).toEqual({ kind: 'fail', reason: 'invalid rid' });
  });
  test('corpo adulterado é recusado', () => {
    const auth = new AuthSessions();
    const s = handshake(auth, 'segredo');
    const assinado = dtokenFor(s.nonce, 1, 'segredo', '{"text":"a"}');
    expect(auth.verify('ShowQuickPresentation', { sid: s.sid, rid: '1', dtoken: assinado, token: null }, '{"text":"b"}', 'segredo')).toEqual({
      kind: 'fail',
      reason: 'invalid token',
    });
  });
  test('novo login com sessão antiga viva funciona, e as duas seguem independentes', () => {
    const auth = new AuthSessions();
    const a = handshake(auth, 'segredo');
    const b = handshake(auth, 'segredo');
    expect(a.sid).not.toBe(b.sid);
    expect(call(auth, b, 1, '')).toEqual({ kind: 'ok' });
    expect(call(auth, a, 1, '')).toEqual({ kind: 'ok' });
  });
  test('sessão sem login completo não pode chamar ações', () => {
    const auth = new AuthSessions();
    const c = auth.verify('Auth', none, '', 'segredo');
    if (c.kind !== 'challenge') throw new Error('esperava desafio');
    expect(call(auth, c, 1, '')).toEqual({ kind: 'fail', reason: 'unauthorized' });
  });
  test('sessão expira após o tempo sem uso', () => {
    let t = 0;
    const auth = new AuthSessions({ now: () => t, ttlMs: 1000 });
    const s = handshake(auth, 'segredo');
    t = 1001;
    expect(call(auth, s, 1, '')).toEqual({ kind: 'fail', reason: 'invalid session' });
  });
  test('modo simples com ?token=', () => {
    const auth = new AuthSessions();
    expect(auth.verify('SearchLyrics', { ...none, token: 'segredo' }, '', 'segredo')).toEqual({ kind: 'ok' });
    expect(auth.verify('SearchLyrics', { ...none, token: 'outro' }, '', 'segredo')).toEqual({ kind: 'fail', reason: 'invalid token' });
  });
  test('ação sem credencial é recusada; sem token configurado nada passa', () => {
    const auth = new AuthSessions();
    expect(auth.verify('SearchLyrics', none, '', 'segredo')).toEqual({ kind: 'fail', reason: 'unauthorized' });
    expect(auth.verify('Auth', none, '', '')).toEqual({ kind: 'fail', reason: 'token não configurado' });
  });
});
