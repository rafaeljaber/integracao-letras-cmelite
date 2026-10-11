// Mensagens entre a ponte (bridge/) e o plugin (src/), compartilhadas pelos dois lados.

export const WS_PORT = 8092;
export const DEFAULT_HTTP_PORT = 8091;
export const CALL_TIMEOUT_MS = 3000;
export const COMPAT_VERSION = '2.25.0';
export const PLUGIN_ACTIONS = ['SearchLyrics', 'GetLyrics', 'ShowLyrics', 'ShowQuickPresentation', 'CloseCurrentPresentation'] as const;

export interface CompatConfig {
  port: number;
  token: string;
}

export interface HttpStatus {
  listening: boolean;
  port: number;
  addresses: string[];
  error?: string;
}

export type ClientEventKind = 'auth-ok' | 'auth-fail' | 'request';

export type PluginToBridge =
  | { type: 'hello'; version: string }
  | { type: 'generate-token' }
  | ({ type: 'config' } & CompatConfig)
  | { type: 'reply'; id: number; ok: true; data?: unknown }
  | { type: 'reply'; id: number; ok: false; error: string };

export type BridgeToPlugin =
  | ({ type: 'status' } & HttpStatus)
  | { type: 'token'; token: string }
  | ({ type: 'saved-config' } & CompatConfig)
  | { type: 'call'; id: number; action: string; body: Record<string, unknown> }
  | { type: 'event'; kind: ClientEventKind; at: string; remote: string; action?: string; reason?: string };

export function encode(msg: PluginToBridge | BridgeToPlugin): string {
  return JSON.stringify(msg);
}

function parse(raw: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { type?: unknown }).type === 'string') {
      return v as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function decodePluginMessage(raw: string): PluginToBridge | null {
  const m = parse(raw);
  if (!m) return null;
  if (m.type === 'hello' && typeof m.version === 'string') return m as unknown as PluginToBridge;
  if (m.type === 'config') return m as unknown as PluginToBridge;
  if (m.type === 'generate-token') return { type: 'generate-token' };
  if (m.type === 'reply' && typeof m.id === 'number') {
    if (m.ok === true) return m as unknown as PluginToBridge;
    if (m.ok === false && typeof m.error === 'string') return m as unknown as PluginToBridge;
  }
  return null;
}

export function decodeBridgeMessage(raw: string): BridgeToPlugin | null {
  const m = parse(raw);
  if (!m) return null;
  if (m.type === 'status' && typeof m.listening === 'boolean' && typeof m.port === 'number' && Array.isArray(m.addresses)) {
    return m as unknown as BridgeToPlugin;
  }
  if (m.type === 'token' && typeof m.token === 'string') return m as unknown as BridgeToPlugin;
  if (m.type === 'saved-config' && typeof m.port === 'number' && typeof m.token === 'string') return m as unknown as BridgeToPlugin;
  if (m.type === 'call' && typeof m.id === 'number' && typeof m.action === 'string' && m.body !== null && typeof m.body === 'object') {
    return m as unknown as BridgeToPlugin;
  }
  if (m.type === 'event' && typeof m.kind === 'string' && typeof m.at === 'string' && typeof m.remote === 'string') {
    return m as unknown as BridgeToPlugin;
  }
  return null;
}

export function validateConfig(input: unknown): { ok: true; config: CompatConfig } | { ok: false; error: string } {
  const o = (input ?? {}) as { port?: unknown; token?: unknown };
  const port = Number(o.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'porta inválida (use 1 a 65535)' };
  if (port === WS_PORT) return { ok: false, error: `a porta ${WS_PORT} é reservada para o plugin` };
  const token = typeof o.token === 'string' ? o.token.trim() : '';
  if (!token) return { ok: false, error: 'token vazio: use o mesmo token do perfil no CMElite' };
  return { ok: true, config: { port, token } };
}
