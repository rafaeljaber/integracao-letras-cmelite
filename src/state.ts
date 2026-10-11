// Estado mostrado no painel; toda mudança é enviada completa para a UI.
import type { LogLevel } from './compat/actions';
import type { LinkStatus } from './bridge-client';
import { DEFAULT_HTTP_PORT, type ClientEventKind, type CompatConfig, type HttpStatus } from './protocol';

export const MAX_EVENTS = 20;

export interface LogEntry {
  at: string;
  level: LogLevel;
  message: string;
}

export interface PanelState {
  bridge: LinkStatus;
  http: HttpStatus | null;
  client: { remote: string | null; lastAuthAt: string | null; lastRequestAt: string | null; authFailedAt: string | null; authFailReason: string | null };
  now: { title: string | null; part: string | null };
  config: CompatConfig;
  events: LogEntry[];
}

export class PluginState {
  private s: PanelState = {
    bridge: 'disconnected',
    http: null,
    client: { remote: null, lastAuthAt: null, lastRequestAt: null, authFailedAt: null, authFailReason: null },
    now: { title: null, part: null },
    config: { port: DEFAULT_HTTP_PORT, token: '' },
    events: [],
  };

  constructor(private onChange: (s: PanelState) => void, private now: () => Date = () => new Date()) {}

  snapshot(): PanelState {
    return JSON.parse(JSON.stringify(this.s)) as PanelState;
  }

  private emit(): void {
    try {
      this.onChange(this.snapshot());
    } catch {
      // Sem painel aberto o host pode recusar a mensagem; o estado segue valendo e vai no próximo "ui-ready".
    }
  }

  setBridge(b: LinkStatus): void {
    if (this.s.bridge === b) return;
    this.s.bridge = b;
    if (b === 'disconnected') this.s.http = null;
    if (b === 'connected') this.log('info', 'ponte conectada');
    else this.log('warn', 'ponte desconectada');
  }

  setHttp(h: HttpStatus): void {
    this.s.http = { ...h };
    if (h.error) this.log('error', h.error);
    else this.emit();
  }

  clientEvent(kind: ClientEventKind, at: string, remote: string, _action?: string, reason?: string): void {
    const c = this.s.client;
    c.remote = remote;
    if (kind === 'auth-ok') {
      c.lastAuthAt = at;
      this.log('info', `CMElite conectado (${remote})`);
    } else if (kind === 'auth-fail') {
      if (reason === 'invalid rid') {
        this.log('warn', `chamada repetida recusada (${remote})`);
        return;
      }
      c.authFailedAt = at;
      c.authFailReason = reason ?? null;
      if (reason === 'invalid token') this.log('error', `CMElite recusado: token inválido (${remote})`);
      else this.log('warn', `sessão do CMElite perdida (a ponte reiniciou?) — reconecte o CMElite (${remote})`);
    } else {
      c.lastRequestAt = at;
      this.emit();
    }
  }

  setNow(title: string | null, part: string | null): void {
    this.s.now = { title, part };
    this.emit();
  }

  setConfig(cfg: CompatConfig): void {
    this.s.config = { ...cfg };
    this.emit();
  }

  log(level: LogLevel, message: string): void {
    this.s.events.unshift({ at: this.now().toISOString(), level, message });
    if (this.s.events.length > MAX_EVENTS) this.s.events.length = MAX_EVENTS;
    this.emit();
  }
}
