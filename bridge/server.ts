// Sobe o WebSocket local (plugin) e, quando o plugin manda a configuração, o HTTP do CMElite.
import { networkInterfaces } from 'node:os';
import { CALL_TIMEOUT_MS, validateConfig, type CompatConfig, type HttpStatus } from '../src/protocol';
import { AuthSessions } from './auth';
import { loadSavedConfig, saveConfigFile } from './config-store';
import { handleCompatRequest, type HttpDeps } from './compat-http';
import { PluginLink } from './plugin-link';
import { generateToken } from './token';

export interface BridgeOptions {
  wsPort: number;
  httpHost?: string;
  timeoutMs?: number;
  /** Arquivo onde a última configuração válida é guardada (sem ele, nada é guardado). */
  configPath?: string;
  log?: (line: string) => void;
}

export interface RunningBridge {
  readonly wsPort: number;
  readonly httpPort: number | null;
  stop(): void;
}

interface HttpServer {
  port?: number;
  stop(closeActiveConnections?: boolean): unknown;
}

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

export function startBridge(opts: BridgeOptions): RunningBridge {
  const log = opts.log ?? ((line: string) => console.log(`[ponte] ${line}`));
  const link = new PluginLink({ timeoutMs: opts.timeoutMs ?? CALL_TIMEOUT_MS });
  let token = '';
  let http: HttpServer | null = null;
  let httpPort: number | null = null;
  let status: HttpStatus | null = null;

  const sendStatus = () => {
    if (status) link.send({ type: 'status', ...status });
  };

  const deps: HttpDeps = {
    auth: new AuthSessions(),
    getToken: () => token,
    forward: (action, body) => link.call(action, body),
    onEvent: (e) => link.send({ type: 'event', at: new Date().toISOString(), ...e }),
  };

  const applyConfig = (cfg: CompatConfig) => {
    token = cfg.token;
    if (opts.configPath) {
      try {
        saveConfigFile(opts.configPath, cfg);
      } catch (e) {
        log(`não consegui guardar a configuração: ${(e as Error).message}`);
      }
    }
    if (http && httpPort === cfg.port) {
      sendStatus();
      return;
    }
    http?.stop(true);
    http = null;
    httpPort = null;
    try {
      const server = Bun.serve({
        hostname: opts.httpHost ?? '0.0.0.0',
        port: cfg.port,
        fetch: (req, srv) => handleCompatRequest(req, srv.requestIP(req)?.address ?? '?', deps),
      });
      http = server;
      httpPort = server.port ?? cfg.port;
      status = { listening: true, port: httpPort, addresses: lanAddresses() };
      log(`escutando o CMElite na porta ${httpPort}`);
    } catch (e) {
      status = { listening: false, port: cfg.port, addresses: lanAddresses(), error: `porta ${cfg.port} indisponível: ${(e as Error).message}` };
      log(status.error as string);
    }
    sendStatus();
  };

  const ws = Bun.serve({
    hostname: '127.0.0.1',
    port: opts.wsPort,
    fetch(req, srv) {
      if (srv.upgrade(req)) return undefined;
      return new Response('ponte CMElite', { status: 426 });
    },
    websocket: {
      open(socket) {
        link.attach(socket);
        log('plugin conectado');
        // Plugin reinstalado volta sem configuração: oferece a guardada (ele só adota se não tiver a dele).
        if (token && httpPort !== null) link.send({ type: 'saved-config', port: httpPort, token });
        sendStatus();
      },
      message(socket, raw) {
        const msg = link.handleMessage(socket, String(raw));
        if (msg?.type === 'generate-token') {
          link.send({ type: 'token', token: generateToken() });
          return;
        }
        if (!msg || msg.type !== 'config') return;
        const v = validateConfig(msg);
        if (v.ok) {
          applyConfig(v.config);
          return;
        }
        status = { listening: http !== null, port: httpPort ?? 0, addresses: lanAddresses(), error: v.error };
        sendStatus();
      },
      close(socket) {
        link.detach(socket);
        log('plugin desconectado');
      },
    },
  });

  const saved = opts.configPath ? loadSavedConfig(opts.configPath) : null;
  if (saved) {
    log('usando a configuração guardada');
    applyConfig(saved);
  }

  return {
    wsPort: ws.port ?? opts.wsPort,
    get httpPort() {
      return httpPort;
    },
    stop() {
      http?.stop(true);
      ws.stop(true);
    },
  };
}
