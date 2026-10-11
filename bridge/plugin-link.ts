// Conexão da ponte com o plugin: uma por vez, chamadas pendentes com tempo máximo.
import { decodePluginMessage, encode, type BridgeToPlugin, type PluginToBridge } from '../src/protocol';
import type { ForwardResult } from './compat-http';

export interface Sock {
  send(data: string): unknown;
  close(): void;
}

interface Pending {
  resolve(r: ForwardResult): void;
  timer: ReturnType<typeof setTimeout>;
}

export class PluginLink {
  private socket: Sock | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(private opts: { timeoutMs: number }) {}

  get connected(): boolean {
    return this.socket !== null;
  }

  attach(s: Sock): void {
    if (this.socket && this.socket !== s) this.socket.close();
    this.socket = s;
  }

  detach(s: Sock): void {
    if (this.socket !== s) return;
    this.socket = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: 'Spresenter desconectado' });
    }
    this.pending.clear();
  }

  send(msg: BridgeToPlugin): void {
    this.socket?.send(encode(msg));
  }

  call(action: string, body: Record<string, unknown>): Promise<ForwardResult> {
    if (!this.socket) return Promise.resolve({ ok: false, error: 'Spresenter desconectado' });
    const id = this.nextId++;
    return new Promise<ForwardResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'tempo esgotado' });
      }, this.opts.timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.send({ type: 'call', id, action, body });
    });
  }

  /** Resolve respostas; devolve as demais mensagens (hello, config) para quem chamou. */
  handleMessage(from: Sock, raw: string): PluginToBridge | null {
    if (from !== this.socket) return null;
    const msg = decodePluginMessage(raw);
    if (!msg) return null;
    if (msg.type !== 'reply') return msg;
    const p = this.pending.get(msg.id);
    if (!p) return null;
    clearTimeout(p.timer);
    this.pending.delete(msg.id);
    if (!msg.ok) p.resolve({ ok: false, error: msg.error });
    else p.resolve('data' in msg ? { ok: true, data: msg.data } : { ok: true });
    return null;
  }
}
