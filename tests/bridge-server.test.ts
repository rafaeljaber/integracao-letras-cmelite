import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSavedConfig } from '../bridge/config-store';
import { startBridge, type RunningBridge } from '../bridge/server';
import { FakeCmelite, FakePlugin, freePort } from './helpers';

let bridge: RunningBridge | null = null;
let plugin: FakePlugin | null = null;

afterEach(() => {
  plugin?.close();
  plugin = null;
  bridge?.stop();
  bridge = null;
});

async function setup(opts: { timeoutMs?: number } = {}) {
  bridge = startBridge({ wsPort: 0, httpHost: '127.0.0.1', timeoutMs: opts.timeoutMs, log: () => {} });
  plugin = await FakePlugin.connect(bridge.wsPort);
  const port = await freePort();
  plugin.send({ type: 'hello', version: 'teste' });
  plugin.send({ type: 'config', port, token: 'segredo' });
  const status = await plugin.next('status');
  return { port, status, cmelite: new FakeCmelite(`http://127.0.0.1:${port}`, 'segredo') };
}

describe('ponte', () => {
  test('sequência real do CMElite chega ao plugin, na ordem', async () => {
    const { status, cmelite } = await setup();
    expect(status).toMatchObject({ type: 'status', listening: true });
    plugin!.onCall = (action) => {
      if (action === 'SearchLyrics') return [{ id: 'g1', title: 'Bom Perfume', artist: 'Gabi Sampaio', author: 'Gabi Sampaio' }];
      if (action === 'GetLyrics') return { slides: [{ number: 1, text: 'Refrão', slide_description: 'Refrão', background_id: '' }] };
      return undefined;
    };
    expect(await (await cmelite.login()).json()).toEqual({ status: 'ok' });
    expect((await cmelite.call('GetTokenInfo')).json.status).toBe('ok');
    expect((await cmelite.call('SearchLyrics', { text: 'Bom Perfume', fields: 'id,title,artist,author' })).json.data[0].id).toBe('g1');
    expect((await cmelite.call('GetLyrics', { id: 'g1', fields: 'slides' })).json.data.slides).toHaveLength(1);
    expect((await cmelite.call('ShowLyrics', { id: 'g1' })).json).toEqual({ status: 'ok' });
    expect((await cmelite.call('ShowQuickPresentation', { text: 'Refrão' })).json).toEqual({ status: 'ok' });
    expect((await cmelite.call('ShowQuickPresentation', { text: ' ' })).json).toEqual({ status: 'ok' });
    expect((await cmelite.call('CloseCurrentPresentation')).json).toEqual({ status: 'ok' });
    expect(plugin!.calls.map((c) => c.action)).toEqual([
      'SearchLyrics', 'GetLyrics', 'ShowLyrics', 'ShowQuickPresentation', 'ShowQuickPresentation', 'CloseCurrentPresentation',
    ]);
    expect(await plugin!.next('event')).toMatchObject({ kind: 'auth-ok' });
  });

  test('plugin desconectado: CMElite recebe erro na hora', async () => {
    const { cmelite } = await setup();
    await cmelite.login();
    plugin!.close();
    plugin = null;
    await Bun.sleep(100);
    expect((await cmelite.call('ShowLyrics', { id: 'g1' })).json).toEqual({ status: 'error', error: 'Spresenter desconectado' });
  });

  test('plugin lento: erro de tempo esgotado', async () => {
    const { cmelite } = await setup({ timeoutMs: 200 });
    plugin!.onCall = () => Bun.sleep(1000);
    await cmelite.login();
    expect((await cmelite.call('ShowLyrics', { id: 'g1' })).json).toEqual({ status: 'error', error: 'tempo esgotado' });
  });

  test('token errado gera evento auth-fail para o plugin', async () => {
    const { port } = await setup();
    const intruso = new FakeCmelite(`http://127.0.0.1:${port}`, 'errado');
    expect((await intruso.login()).status).toBe(401);
    expect(await plugin!.next('event')).toMatchObject({ kind: 'auth-fail', action: 'Auth' });
  });

  test('porta já ocupada: status com erro, ponte continua viva e aceita outra porta', async () => {
    const ocupada = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('outro') });
    const porta = ocupada.port as number;
    bridge = startBridge({ wsPort: 0, httpHost: '127.0.0.1', log: () => {} });
    plugin = await FakePlugin.connect(bridge.wsPort);
    plugin.send({ type: 'config', port: porta, token: 'segredo' });
    const status = await plugin.next('status');
    ocupada.stop(true);
    expect(status).toMatchObject({ listening: false, port: porta });
    expect(status.error).toContain(`porta ${porta} indisponível`);
    const livre = await freePort();
    plugin.send({ type: 'config', port: livre, token: 'segredo' });
    expect(await plugin.next('status')).toMatchObject({ listening: true, port: livre });
  });

  test('config com token vazio não abre a porta', async () => {
    bridge = startBridge({ wsPort: 0, httpHost: '127.0.0.1', log: () => {} });
    plugin = await FakePlugin.connect(bridge.wsPort);
    plugin.send({ type: 'config', port: await freePort(), token: '  ' });
    expect(await plugin.next('status')).toMatchObject({ listening: false, error: 'token vazio: use o mesmo token do perfil no CMElite' });
    expect(bridge.httpPort).toBeNull();
  });

  test('trocar só o token mantém a porta e passa a exigir o novo token', async () => {
    const { port, cmelite } = await setup();
    plugin!.send({ type: 'config', port, token: 'novo' });
    expect(await plugin!.next('status')).toMatchObject({ listening: true, port });
    expect((await cmelite.login()).status).toBe(401);
    expect((await new FakeCmelite(`http://127.0.0.1:${port}`, 'novo').login()).status).toBe(200);
  });

  test('gera token quando o plugin pede', async () => {
    bridge = startBridge({ wsPort: 0, httpHost: '127.0.0.1', log: () => {} });
    plugin = await FakePlugin.connect(bridge.wsPort);
    plugin.send({ type: 'generate-token' });
    const msg = await plugin.next('token');
    expect(msg.token).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  test('guarda a configuração e, reiniciada, já escuta e devolve a configuração ao plugin', async () => {
    const configPath = join(mkdtempSync(join(tmpdir(), 'ponte-')), 'config.json');
    const port = await freePort();
    bridge = startBridge({ wsPort: 0, httpHost: '127.0.0.1', configPath, log: () => {} });
    plugin = await FakePlugin.connect(bridge.wsPort);
    plugin.send({ type: 'config', port, token: 'ABCD-EFGH-JKLM' });
    await plugin.next('status');
    expect(loadSavedConfig(configPath)).toEqual({ port, token: 'ABCD-EFGH-JKLM' });
    plugin.close();
    plugin = null;
    bridge.stop();

    bridge = startBridge({ wsPort: 0, httpHost: '127.0.0.1', configPath, log: () => {} });
    expect(bridge.httpPort).toBe(port);
    plugin = await FakePlugin.connect(bridge.wsPort);
    expect(await plugin.next('saved-config')).toMatchObject({ port, token: 'ABCD-EFGH-JKLM' });
  });

  test('nova conexão do plugin substitui a anterior', async () => {
    const { cmelite } = await setup();
    const segundo = await FakePlugin.connect(bridge!.wsPort);
    segundo.onCall = () => 'do segundo';
    await cmelite.login();
    expect((await cmelite.call('SearchLyrics', { text: '' })).json).toEqual({ status: 'ok', data: 'do segundo' });
    segundo.close();
  });
});
