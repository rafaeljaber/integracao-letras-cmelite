import { describe, expect, test } from 'bun:test';
import { decodeBridgeMessage, decodePluginMessage, encode, validateConfig, WS_PORT } from '../src/protocol';

describe('validateConfig', () => {
  test('aceita porta e token válidos e apara o token', () => {
    expect(validateConfig({ port: '8091', token: '  abc123  ' })).toEqual({ ok: true, config: { port: 8091, token: 'abc123' } });
  });
  test('recusa token vazio ou só espaços', () => {
    expect(validateConfig({ port: 8091, token: '   ' })).toEqual({ ok: false, error: 'token vazio: use o mesmo token do perfil no CMElite' });
    expect(validateConfig({ port: 8091 })).toMatchObject({ ok: false });
  });
  test('recusa porta fora da faixa, não inteira ou reservada', () => {
    for (const port of [0, 65536, 80.5, 'abc', undefined]) expect(validateConfig({ port, token: 't' })).toMatchObject({ ok: false });
    expect(validateConfig({ port: WS_PORT, token: 't' })).toEqual({ ok: false, error: `a porta ${WS_PORT} é reservada para o plugin` });
  });
});

describe('mensagens', () => {
  test('ida e volta de uma chamada', () => {
    const raw = encode({ type: 'call', id: 1, action: 'SearchLyrics', body: { text: 'x' } });
    expect(decodeBridgeMessage(raw)).toEqual({ type: 'call', id: 1, action: 'SearchLyrics', body: { text: 'x' } });
  });
  test('resposta com e sem data', () => {
    expect(decodePluginMessage(encode({ type: 'reply', id: 2, ok: true }))).toEqual({ type: 'reply', id: 2, ok: true });
    expect(decodePluginMessage(encode({ type: 'reply', id: 3, ok: true, data: null }))).toEqual({ type: 'reply', id: 3, ok: true, data: null });
    expect(decodePluginMessage(encode({ type: 'reply', id: 4, ok: false, error: 'falhou' }))).toEqual({ type: 'reply', id: 4, ok: false, error: 'falhou' });
  });
  test('status e evento da ponte', () => {
    expect(decodeBridgeMessage(encode({ type: 'status', listening: true, port: 8091, addresses: ['10.0.0.2'] }))).toEqual({ type: 'status', listening: true, port: 8091, addresses: ['10.0.0.2'] });
    expect(decodeBridgeMessage(encode({ type: 'event', kind: 'auth-ok', at: '2026-10-09T18:00:00.000Z', remote: '10.0.0.5' }))).toMatchObject({ kind: 'auth-ok' });
  });
  test('pedido e entrega de token gerado', () => {
    expect(decodePluginMessage(encode({ type: 'generate-token' }))).toEqual({ type: 'generate-token' });
    expect(decodeBridgeMessage(encode({ type: 'token', token: 'Ab3xYz9Kq2Mn' }))).toEqual({ type: 'token', token: 'Ab3xYz9Kq2Mn' });
    expect(decodeBridgeMessage('{"type":"token"}')).toBeNull();
  });
  test('configuração guardada na ponte', () => {
    expect(decodeBridgeMessage(encode({ type: 'saved-config', port: 8091, token: 'ABCD-EFGH-JKLM' }))).toEqual({ type: 'saved-config', port: 8091, token: 'ABCD-EFGH-JKLM' });
  });
  test('ignora lixo', () => {
    for (const raw of ['', 'nada', '[]', '{"type":5}', '{"type":"call","id":"1"}', '{"type":"reply","id":1,"ok":false}']) {
      expect(decodeBridgeMessage(raw)).toBeNull();
      expect(decodePluginMessage(raw)).toBeNull();
    }
  });
});
