/// <reference types="@spresenter/plugin-sdk/code" />
// Plugin CMElite: recebe da ponte as chamadas da API de letras compatível e projeta as partes no Spresenter.
import { Alerts } from './alerts';
import { BridgeClient } from './bridge-client';
import { CompatActions } from './compat/actions';
import { createProjector } from './projector';
import { DEFAULT_HTTP_PORT, WS_PORT, type BridgeToPlugin, type CompatConfig } from './protocol';
import { createSongStore } from './songs';
import { PluginState } from './state';
import { adoptSavedConfig, handleGeneratedToken, handleUiMessage, type UiContext } from './ui-messages';

const RETRY_MS = 3000;
let config: CompatConfig = { port: DEFAULT_HTTP_PORT, token: '' };

const state = new PluginState((s) => spresenter.ui.postMessage({ type: 'state', state: s }));
const alerts = new Alerts((n) => {
  spresenter.notifications.publish(n).catch(() => undefined);
});
const songs = createSongStore(spresenter.assets);
spresenter.on('assets', () => songs.invalidate());
const actions = new CompatActions({
  songs,
  projector: createProjector(spresenter),
  log: (level, message) => {
    state.log(level, message);
    // Também no log do Spresenter, para suporte (o painel guarda só os últimos eventos).
    console.log(`[cmelite] ${level}: ${message}`);
  },
  onNowPlaying: (title, part) => state.setNow(title, part),
  rememberSong: (guid) => {
    spresenter.storage.set('currentSong', guid).catch(() => undefined);
  },
});

const client = new BridgeClient({
  net: spresenter.net,
  url: `ws://127.0.0.1:${WS_PORT}`,
  retryMs: RETRY_MS,
  timers: {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
  onStatus: (s) => {
    state.setBridge(s);
    if (s === 'connected') alerts.bridgeUp();
    else alerts.bridgeDown();
  },
  onReady: () => {
    client.send({ type: 'hello', version: spresenter.manifest.version });
    if (config.token) client.send({ type: 'config', port: config.port, token: config.token });
  },
  onMessage: (msg) => {
    void onBridgeMessage(msg);
  },
});

async function onBridgeMessage(msg: BridgeToPlugin): Promise<void> {
  if (msg.type === 'status') {
    state.setHttp({ listening: msg.listening, port: msg.port, addresses: msg.addresses, error: msg.error });
    return;
  }
  if (msg.type === 'saved-config') {
    await adoptSavedConfig({ port: msg.port, token: msg.token }, uiContext);
    return;
  }
  if (msg.type === 'token') {
    await handleGeneratedToken(msg.token, uiContext);
    return;
  }
  if (msg.type === 'event') {
    state.clientEvent(msg.kind, msg.at, msg.remote, msg.action, msg.reason);
    if (msg.kind === 'auth-fail') alerts.authFailed(msg.remote, msg.reason ?? '');
    return;
  }
  try {
    const data = await actions.handle(msg.action, msg.body);
    client.send(data === undefined ? { type: 'reply', id: msg.id, ok: true } : { type: 'reply', id: msg.id, ok: true, data });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    state.log('error', `${msg.action}: ${error}`);
    client.send({ type: 'reply', id: msg.id, ok: false, error });
  }
}

const uiContext: UiContext = {
  state,
  post: (m) => spresenter.ui.postMessage(m),
  saveConfig: async (cfg) => {
    config = cfg;
    await spresenter.storage.set('config', cfg);
    state.setConfig(cfg);
    client.send({ type: 'config', port: cfg.port, token: cfg.token });
  },
  requestToken: () => {
    if (!client.connected) return false;
    client.send({ type: 'generate-token' });
    return true;
  },
};

spresenter.ui.onmessage = (raw) => {
  void handleUiMessage(raw, uiContext);
};

spresenter.storage.get<CompatConfig>('config').then(
  (saved) => {
    if (saved) config = saved;
    state.setConfig(config);
    client.start();
  },
  () => client.start(),
);

// Reinício no meio da música: volta à música que o CMElite tinha aberto.
spresenter.storage.get<string | null>('currentSong').then(
  (guid) => {
    if (guid) void actions.restore(guid);
  },
  () => undefined,
);
