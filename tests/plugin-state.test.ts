import { describe, expect, test } from 'bun:test';
import { MAX_EVENTS, PluginState, type PanelState } from '../src/state';
import { adoptSavedConfig, handleGeneratedToken, handleUiMessage } from '../src/ui-messages';

const clock = () => {
  let n = 0;
  return () => new Date(Date.UTC(2026, 9, 9, 18, 0, n++));
};

describe('PluginState', () => {
  test('estado inicial', () => {
    expect(new PluginState(() => {}, clock()).snapshot()).toEqual({
      bridge: 'disconnected',
      http: null,
      client: { remote: null, lastAuthAt: null, lastRequestAt: null, authFailedAt: null, authFailReason: null },
      now: { title: null, part: null },
      config: { port: 8091, token: '' },
      events: [],
    });
  });
  test('eventos: mais recente primeiro, no máximo MAX_EVENTS', () => {
    const st = new PluginState(() => {}, clock());
    for (let i = 0; i < MAX_EVENTS + 5; i++) st.log('info', `e${i}`);
    const ev = st.snapshot().events;
    expect(ev).toHaveLength(MAX_EVENTS);
    expect(ev[0].message).toBe(`e${MAX_EVENTS + 4}`);
  });
  test('ponte desconectada limpa o status HTTP e registra', () => {
    const st = new PluginState(() => {}, clock());
    st.setBridge('connected');
    st.setHttp({ listening: true, port: 8091, addresses: ['192.168.0.12'] });
    st.setBridge('disconnected');
    const s = st.snapshot();
    expect(s.http).toBeNull();
    expect(s.events.map((e) => e.message)).toEqual(['ponte desconectada', 'ponte conectada']);
  });
  test('eventos do CMElite', () => {
    const st = new PluginState(() => {}, clock());
    st.clientEvent('auth-ok', '2026-10-09T18:00:00.000Z', '10.0.0.5');
    st.clientEvent('request', '2026-10-09T18:00:05.000Z', '10.0.0.5', 'SearchLyrics');
    st.clientEvent('auth-fail', '2026-10-09T18:01:00.000Z', '10.0.0.9', 'Auth', 'invalid token');
    expect(st.snapshot().client).toEqual({
      remote: '10.0.0.9',
      lastAuthAt: '2026-10-09T18:00:00.000Z',
      lastRequestAt: '2026-10-09T18:00:05.000Z',
      authFailedAt: '2026-10-09T18:01:00.000Z',
      authFailReason: 'invalid token',
    });
    expect(st.snapshot().events[0]).toMatchObject({ level: 'error', message: 'CMElite recusado: token inválido (10.0.0.9)' });
  });
  test('sessão perdida pede para reconectar, sem culpar o token', () => {
    const st = new PluginState(() => {}, clock());
    st.clientEvent('auth-fail', '2026-10-09T18:01:00.000Z', '10.0.0.9', 'ShowLyrics', 'invalid session');
    expect(st.snapshot().client).toMatchObject({ authFailedAt: '2026-10-09T18:01:00.000Z', authFailReason: 'invalid session' });
    expect(st.snapshot().events[0]).toMatchObject({ level: 'warn', message: 'sessão do CMElite perdida (a ponte reiniciou?) — reconecte o CMElite (10.0.0.9)' });
  });
  test('chamada repetida só registra, sem marcar recusa', () => {
    const st = new PluginState(() => {}, clock());
    st.clientEvent('auth-fail', '2026-10-09T18:01:00.000Z', '10.0.0.9', 'ShowLyrics', 'invalid rid');
    expect(st.snapshot().client.authFailedAt).toBeNull();
    expect(st.snapshot().events[0]).toMatchObject({ level: 'warn', message: 'chamada repetida recusada (10.0.0.9)' });
  });
  test('falha ao avisar o painel não derruba o estado', () => {
    const st = new PluginState(() => {
      throw new Error('sem painel');
    }, clock());
    expect(() => st.log('info', 'teste')).not.toThrow();
    expect(st.snapshot().events[0].message).toBe('teste');
  });
  test('snapshot é cópia: mexer nele não altera o estado', () => {
    const st = new PluginState(() => {}, clock());
    st.snapshot().events.push({ at: 'x', level: 'info', message: 'intruso' });
    expect(st.snapshot().events).toEqual([]);
  });
  test('cada mudança notifica com o estado completo', () => {
    const seen: PanelState[] = [];
    const st = new PluginState((s) => seen.push(s), clock());
    st.setNow('Bom Perfume', 'Refrão');
    expect(seen[seen.length - 1].now).toEqual({ title: 'Bom Perfume', part: 'Refrão' });
  });
});

describe('handleUiMessage', () => {
  function ctx() {
    const posted: unknown[] = [];
    const saved: unknown[] = [];
    const state = new PluginState(() => {}, clock());
    const tokenRequests: number[] = [];
    let bridgeUp = true;
    return {
      posted,
      saved,
      tokenRequests,
      setBridgeUp: (v: boolean) => (bridgeUp = v),
      c: {
        state,
        post: (m: unknown) => posted.push(m),
        saveConfig: async (cfg: { port: number; token: string }) => {
          saved.push(cfg);
        },
        requestToken: () => {
          if (!bridgeUp) return false;
          tokenRequests.push(1);
          return true;
        },
      },
    };
  }
  test('painel aberto depois recebe o estado atual completo', async () => {
    const { posted, c } = ctx();
    c.state.setBridge('connected');
    c.state.setNow('Bom Perfume', 'Verso');
    await handleUiMessage({ type: 'ui-ready' }, c);
    expect(posted).toEqual([{ type: 'state', state: c.state.snapshot() }]);
  });
  test('salvar configuração válida', async () => {
    const { posted, saved, c } = ctx();
    await handleUiMessage({ type: 'save-config', port: '8091', token: ' abc ' }, c);
    expect(saved).toEqual([{ port: 8091, token: 'abc' }]);
    expect(posted).toEqual([{ type: 'config-result' }]);
  });
  test('configuração inválida não salva e devolve o erro', async () => {
    const { posted, saved, c } = ctx();
    await handleUiMessage({ type: 'save-config', port: 8091, token: '' }, c);
    expect(saved).toEqual([]);
    expect(posted).toEqual([{ type: 'config-result', error: 'token vazio: use o mesmo token do perfil no CMElite' }]);
  });
  test('gerar token pede à ponte', async () => {
    const { posted, tokenRequests, c } = ctx();
    await handleUiMessage({ type: 'generate-token' }, c);
    expect(tokenRequests).toEqual([1]);
    expect(posted).toEqual([]);
  });
  test('gerar token com a ponte desconectada avisa no painel', async () => {
    const { posted, setBridgeUp, c } = ctx();
    setBridgeUp(false);
    await handleUiMessage({ type: 'generate-token' }, c);
    expect(posted).toEqual([{ type: 'config-result', error: 'ponte desconectada: abra a ponte CMElite para gerar um token' }]);
  });
  test('token gerado já é salvo com a porta atual e mostrado no painel', async () => {
    const { posted, saved, c } = ctx();
    c.state.setConfig({ port: 9000, token: 'antigo' });
    await handleGeneratedToken('Ab3xYz9Kq2Mn', c);
    expect(saved).toEqual([{ port: 9000, token: 'Ab3xYz9Kq2Mn' }]);
    expect(posted).toEqual([{ type: 'generated-token', token: 'Ab3xYz9Kq2Mn' }]);
  });
  test('plugin sem configuração (reinstalado) adota a da ponte', async () => {
    const { saved, c } = ctx();
    await adoptSavedConfig({ port: 8091, token: 'ABCD-EFGH-JKLM' }, c);
    expect(saved).toEqual([{ port: 8091, token: 'ABCD-EFGH-JKLM' }]);
  });
  test('plugin com configuração própria ignora a da ponte', async () => {
    const { saved, c } = ctx();
    c.state.setConfig({ port: 9000, token: 'MEU1-TOKN-AQUI' });
    await adoptSavedConfig({ port: 8091, token: 'ABCD-EFGH-JKLM' }, c);
    expect(saved).toEqual([]);
  });
  test('mensagens desconhecidas são ignoradas', async () => {
    const { posted, c } = ctx();
    await handleUiMessage(null, c);
    await handleUiMessage({ type: 'outra' }, c);
    expect(posted).toEqual([]);
  });
});
