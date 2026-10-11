import { beforeEach, expect, test } from 'bun:test';
import { BridgeClient, type NetApi, type Timers } from '../src/bridge-client';
import type { BridgeToPlugin } from '../src/protocol';

type Handler = (e: { connId: string; type: string; data?: string }) => void;

class FakeNet implements NetApi {
  opened = 0;
  failNext = false;
  sent: Array<[string, string]> = [];
  handlers = new Map<string, Map<string, Handler>>();
  async wsOpen(_url: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('ECONNREFUSED');
    }
    const id = `c${++this.opened}`;
    this.handlers.set(id, new Map());
    return id;
  }
  async wsSend(id: string, data: string) {
    this.sent.push([id, data]);
    return true;
  }
  async wsClose() {
    return true;
  }
  on(id: string, type: 'open' | 'message' | 'close' | 'error', cb: Handler) {
    this.handlers.get(id)!.set(type, cb);
  }
  fire(id: string, type: string, data?: string) {
    this.handlers.get(id)?.get(type)?.({ connId: id, type, data });
  }
}

class FakeTimers implements Timers {
  pending: Array<{ fn: () => void; ms: number }> = [];
  setTimeout(fn: () => void, ms: number) {
    this.pending.push({ fn, ms });
    return this.pending.length;
  }
  clearTimeout() {}
  runAll() {
    this.pending.splice(0).forEach((t) => t.fn());
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let net: FakeNet;
let timers: FakeTimers;
let statuses: string[];
let msgs: BridgeToPlugin[];
let readies: number;
let client: BridgeClient;

beforeEach(() => {
  net = new FakeNet();
  timers = new FakeTimers();
  statuses = [];
  msgs = [];
  readies = 0;
  client = new BridgeClient({
    net,
    url: 'ws://127.0.0.1:8092',
    retryMs: 3000,
    timers,
    onStatus: (s) => statuses.push(s),
    onReady: () => {
      readies += 1;
    },
    onMessage: (m) => msgs.push(m),
  });
});

test('só fica conectado e pronto no evento open (wsOpen resolve antes de abrir)', async () => {
  client.start();
  await flush();
  expect(statuses).toEqual([]);
  expect(readies).toBe(0);
  net.fire('c1', 'open');
  expect(statuses).toEqual(['connected']);
  expect(readies).toBe(1);
});

test('entrega mensagens válidas e ignora lixo', async () => {
  client.start();
  await flush();
  net.fire('c1', 'open');
  net.fire('c1', 'message', '{"type":"call","id":1,"action":"ShowLyrics","body":{"id":"g1"}}');
  net.fire('c1', 'message', 'lixo');
  expect(msgs).toEqual([{ type: 'call', id: 1, action: 'ShowLyrics', body: { id: 'g1' } }]);
});

test('queda: desconectado e nova tentativa após retryMs', async () => {
  client.start();
  await flush();
  net.fire('c1', 'open');
  net.fire('c1', 'close');
  expect(statuses).toEqual(['connected', 'disconnected']);
  expect(timers.pending.map((t) => t.ms)).toEqual([3000]);
  timers.runAll();
  await flush();
  expect(net.opened).toBe(2);
  net.fire('c2', 'open');
  expect(statuses).toEqual(['connected', 'disconnected', 'connected']);
});

test('ponte fora do ar (wsOpen resolve e logo fecha): tenta de novo sem mudar status', async () => {
  client.start();
  await flush();
  net.fire('c1', 'close');
  expect(statuses).toEqual([]);
  expect(timers.pending).toHaveLength(1);
  timers.runAll();
  await flush();
  net.fire('c2', 'open');
  expect(statuses).toEqual(['connected']);
});

test('wsOpen rejeitado também agenda nova tentativa', async () => {
  net.failNext = true;
  client.start();
  await flush();
  expect(statuses).toEqual([]);
  expect(timers.pending).toHaveLength(1);
});

test('error e close da mesma conexão agendam uma só tentativa; conexão velha é ignorada', async () => {
  client.start();
  await flush();
  net.fire('c1', 'open');
  net.fire('c1', 'error');
  net.fire('c1', 'close');
  expect(timers.pending).toHaveLength(1);
  timers.runAll();
  await flush();
  net.fire('c2', 'open');
  net.fire('c1', 'close');
  net.fire('c1', 'message', '{"type":"call","id":9,"action":"X","body":{}}');
  expect(statuses).toEqual(['connected', 'disconnected', 'connected']);
  expect(msgs).toEqual([]);
});

test('send só envia depois do open', async () => {
  client.send({ type: 'hello', version: '1' });
  client.start();
  await flush();
  client.send({ type: 'hello', version: '1' });
  expect(net.sent).toEqual([]);
  net.fire('c1', 'open');
  client.send({ type: 'hello', version: '1' });
  expect(net.sent).toEqual([['c1', '{"type":"hello","version":"1"}']]);
});
