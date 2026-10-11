import { dtokenFor } from '../bridge/auth';

export async function freePort(): Promise<number> {
  const s = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
  const port = s.port as number;
  s.stop(true);
  return port;
}

/** Simula o plugin do Spresenter conectado à ponte. */
export class FakePlugin {
  ws!: WebSocket;
  calls: Array<{ action: string; body: Record<string, unknown> }> = [];
  onCall: (action: string, body: Record<string, unknown>) => unknown = () => undefined;
  private queue: any[] = [];

  static async connect(port: number): Promise<FakePlugin> {
    const p = new FakePlugin();
    p.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    p.ws.addEventListener('message', async (e) => {
      const msg = JSON.parse(String(e.data));
      if (msg.type !== 'call') {
        p.queue.push(msg);
        return;
      }
      p.calls.push({ action: msg.action, body: msg.body });
      try {
        const data = await p.onCall(msg.action, msg.body);
        p.ws.send(JSON.stringify(data === undefined ? { type: 'reply', id: msg.id, ok: true } : { type: 'reply', id: msg.id, ok: true, data }));
      } catch (err) {
        p.ws.send(JSON.stringify({ type: 'reply', id: msg.id, ok: false, error: (err as Error).message }));
      }
    });
    await new Promise((r) => p.ws.addEventListener('open', r, { once: true }));
    return p;
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  async next(type: string, timeoutMs = 2000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.queue.findIndex((m) => m.type === type);
      if (i >= 0) return this.queue.splice(i, 1)[0];
      if (Date.now() > deadline) throw new Error(`tempo esgotado esperando "${type}"`);
      await Bun.sleep(20);
    }
  }

  close(): void {
    this.ws.close();
  }
}

/** Simula o CMElite: login em duas etapas e chamadas assinadas com rid crescente. */
export class FakeCmelite {
  private sid = '';
  private nonce = '';
  private rid = 0;

  constructor(private base: string, private token: string) {}

  post(path: string, body = ''): Promise<Response> {
    return fetch(`${this.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'cmelite-teste' }, body });
  }

  async login(): Promise<Response> {
    const c = (await (await this.post('/api/Auth')).json()) as { data: { sid: string; nonce: string } };
    this.sid = c.data.sid;
    this.nonce = c.data.nonce;
    this.rid = 0;
    return this.post(`/api/Auth?sid=${this.sid}&rid=0&dtoken=${dtokenFor(this.nonce, 0, this.token, 'auth')}`);
  }

  async call(action: string, body?: Record<string, unknown>): Promise<{ status: number; json: any }> {
    const raw = body === undefined ? '' : JSON.stringify(body);
    this.rid += 1;
    const r = await this.post(`/api/${action}?sid=${this.sid}&rid=${this.rid}&dtoken=${dtokenFor(this.nonce, this.rid, this.token, raw)}`, raw);
    return { status: r.status, json: await r.json() };
  }
}
