import { describe, expect, test } from 'bun:test';
import type { PanelState } from '../src/state';
import { ago, clock, toViewModel } from '../src/ui/view-model';

const base = (): PanelState => ({
  bridge: 'connected',
  http: { listening: true, port: 8091, addresses: ['192.168.0.12'] },
  client: { remote: null, lastAuthAt: null, lastRequestAt: null, authFailedAt: null, authFailReason: null },
  now: { title: null, part: null },
  config: { port: 8091, token: 't' },
  events: [],
});
const T = Date.parse('2026-10-09T18:00:00.000Z');

describe('view model', () => {
  test('ponte ok mostra a porta e a frase de ajuda com o IP', () => {
    const vm = toViewModel(base(), T);
    expect(vm.bridge).toEqual({ state: 'ok', detail: 'escutando na porta 8091' });
    expect(vm.help).toBe('No CMElite, use IP 192.168.0.12 e porta 8091.');
  });
  test('ponte desconectada', () => {
    expect(toViewModel({ ...base(), bridge: 'disconnected', http: null }, T).bridge).toEqual({
      state: 'error',
      detail: 'desconectada — abra a ponte CMElite neste computador',
    });
  });
  test('ponte conectada sem porta mostra o erro', () => {
    const vm = toViewModel({ ...base(), http: { listening: false, port: 8091, addresses: [], error: 'porta 8091 indisponível: em uso' } }, T);
    expect(vm.bridge).toEqual({ state: 'warn', detail: 'porta 8091 indisponível: em uso' });
    expect(vm.help).toBe('Configure o token abaixo e salve para a ponte começar a escutar.');
  });
  test('ponte conectada aguardando configuração', () => {
    expect(toViewModel({ ...base(), http: null }, T).bridge).toEqual({ state: 'warn', detail: 'aguardando configuração' });
  });
  test('CMElite: nunca conectou, ativo, recusado', () => {
    expect(toViewModel(base(), T).client).toEqual({ state: 'idle', detail: 'ainda não conectou' });
    const ativo = { ...base(), client: { remote: '10.0.0.5', lastAuthAt: '2026-10-09T17:59:00.000Z', lastRequestAt: '2026-10-09T17:59:50.000Z', authFailedAt: null, authFailReason: null } };
    expect(toViewModel(ativo, T).client).toEqual({ state: 'ok', detail: 'última chamada há 10 s de 10.0.0.5' });
    const recusado = { ...base(), client: { remote: '10.0.0.9', lastAuthAt: '2026-10-09T17:00:00.000Z', lastRequestAt: null, authFailedAt: '2026-10-09T17:58:00.000Z', authFailReason: 'invalid token' } };
    expect(toViewModel(recusado, T).client).toEqual({ state: 'error', detail: 'token recusado há 2 min (10.0.0.9)' });
  });
  test('recusa antiga não fica vermelha depois de chamadas bem-sucedidas', () => {
    const s = { ...base(), client: { remote: '10.0.0.5', lastAuthAt: '2026-10-09T17:00:00.000Z', lastRequestAt: '2026-10-09T17:59:50.000Z', authFailedAt: '2026-10-09T17:30:00.000Z', authFailReason: 'invalid token' } };
    expect(toViewModel(s, T).client).toEqual({ state: 'ok', detail: 'última chamada há 10 s de 10.0.0.5' });
  });
  test('sessão perdida pede para reconectar o CMElite', () => {
    const s = { ...base(), client: { remote: '10.0.0.5', lastAuthAt: '2026-10-09T17:00:00.000Z', lastRequestAt: '2026-10-09T17:50:00.000Z', authFailedAt: '2026-10-09T17:58:00.000Z', authFailReason: 'invalid session' } };
    expect(toViewModel(s, T).client).toEqual({ state: 'warn', detail: 'sessão perdida há 2 min — reconecte o CMElite (10.0.0.5)' });
  });
  test('o que está no ar', () => {
    expect(toViewModel(base(), T).nowPlaying).toBe('Nada no ar');
    expect(toViewModel({ ...base(), now: { title: 'Bom Perfume', part: null } }, T).nowPlaying).toBe('No ar: Bom Perfume (sem letra)');
    expect(toViewModel({ ...base(), now: { title: 'Bom Perfume', part: 'Refrão' } }, T).nowPlaying).toBe('No ar: Bom Perfume — Refrão');
  });
  test('ago e clock', () => {
    expect(ago('2026-10-09T17:59:55.000Z', T)).toBe('há 5 s');
    expect(ago('2026-10-09T17:30:00.000Z', T)).toBe('há 30 min');
    expect(ago('2026-10-09T15:00:00.000Z', T)).toBe('há 3 h');
    expect(clock(new Date(2026, 9, 9, 8, 5, 3).toISOString())).toBe('08:05:03');
  });
  test('eventos com hora e cor por nível', () => {
    const at = new Date(2026, 9, 9, 18, 40, 5).toISOString();
    expect(toViewModel({ ...base(), events: [{ at, level: 'error', message: 'falhou' }] }, T).events).toEqual([
      { time: '18:40:05', message: 'falhou', color: '#f31260' },
    ]);
  });
});
