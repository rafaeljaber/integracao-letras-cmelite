// Conexão do plugin com a ponte (WebSocket local), com reconexão automática.
// No Spresenter 0.3.50, wsOpen resolve antes de abrir (e resolve mesmo com a ponte fora do ar,
// seguido de "close"); só o evento "open" indica conexão real.
import { decodeBridgeMessage, encode, type BridgeToPlugin, type PluginToBridge } from './protocol';

export interface NetApi {
  wsOpen(url: string): Promise<string>;
  wsSend(connId: string, data: string): Promise<boolean>;
  wsClose(connId: string): Promise<boolean>;
  on(connId: string, type: 'open' | 'message' | 'close' | 'error', cb: (e: { connId: string; type: string; data?: string }) => void): void;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type LinkStatus = 'connected' | 'disconnected';

export interface BridgeClientOptions {
  net: NetApi;
  url: string;
  retryMs: number;
  timers: Timers;
  onStatus(s: LinkStatus): void;
  /** Chamado quando a conexão abre de verdade (evento "open"). */
  onReady(): void;
  onMessage(msg: BridgeToPlugin): void;
}

export class BridgeClient {
  private conn: string | null = null;
  private status: LinkStatus = 'disconnected';
  private retry: unknown = null;

  constructor(private opts: BridgeClientOptions) {}

  get connected(): boolean {
    return this.status === 'connected';
  }

  start(): void {
    void this.connect();
  }

  send(msg: PluginToBridge): void {
    if (!this.conn || this.status !== 'connected') return;
    this.opts.net.wsSend(this.conn, encode(msg)).catch(() => undefined);
  }

  private setStatus(s: LinkStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.opts.onStatus(s);
  }

  private scheduleRetry(): void {
    if (this.retry !== null) return;
    this.retry = this.opts.timers.setTimeout(() => {
      this.retry = null;
      void this.connect();
    }, this.opts.retryMs);
  }

  private async connect(): Promise<void> {
    let id: string;
    try {
      id = await this.opts.net.wsOpen(this.opts.url);
    } catch {
      this.setStatus('disconnected');
      this.scheduleRetry();
      return;
    }
    this.conn = id;
    const lost = () => {
      if (this.conn !== id) return;
      this.conn = null;
      this.setStatus('disconnected');
      this.scheduleRetry();
    };
    this.opts.net.on(id, 'open', () => {
      if (this.conn !== id) return;
      this.setStatus('connected');
      this.opts.onReady();
    });
    this.opts.net.on(id, 'message', (e) => {
      if (this.conn !== id || typeof e.data !== 'string') return;
      const msg = decodeBridgeMessage(e.data);
      if (msg) this.opts.onMessage(msg);
    });
    this.opts.net.on(id, 'close', lost);
    this.opts.net.on(id, 'error', lost);
  }
}
