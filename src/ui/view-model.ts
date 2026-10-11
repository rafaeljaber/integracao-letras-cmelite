// Converte o estado do plugin em textos e cores do painel (sem DOM, testável).
import type { PanelState } from '../state';

export type Dot = 'idle' | 'ok' | 'warn' | 'connecting' | 'error';

export interface ViewModel {
  bridge: { state: Dot; detail: string };
  client: { state: Dot; detail: string };
  nowPlaying: string;
  help: string;
  events: Array<{ time: string; message: string; color: string }>;
}

const COLORS = { info: 'inherit', warn: '#f5a524', error: '#f31260' } as const;

export function ago(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 60) return `há ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  return `há ${Math.round(m / 60)} h`;
}

export function clock(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

export function toViewModel(s: PanelState, nowMs: number): ViewModel {
  const bridge: ViewModel['bridge'] =
    s.bridge !== 'connected'
      ? { state: 'error', detail: 'desconectada — abra a ponte CMElite neste computador' }
      : s.http?.listening
        ? { state: 'ok', detail: `escutando na porta ${s.http.port}` }
        : { state: 'warn', detail: s.http?.error ?? 'aguardando configuração' };

  const c = s.client;
  const lastOk = c.lastRequestAt ?? c.lastAuthAt;
  const lastSuccess = [c.lastAuthAt, c.lastRequestAt].filter((x): x is string => x !== null).sort().pop() ?? null;
  const refused = c.authFailedAt !== null && (lastSuccess === null || c.authFailedAt > lastSuccess);
  const where = c.remote ? ` (${c.remote})` : '';
  const client: ViewModel['client'] = refused
    ? c.authFailReason === 'invalid token'
      ? { state: 'error', detail: `token recusado ${ago(c.authFailedAt as string, nowMs)}${where}` }
      : { state: 'warn', detail: `sessão perdida ${ago(c.authFailedAt as string, nowMs)} — reconecte o CMElite${where}` }
    : lastOk
      ? { state: 'ok', detail: `última chamada ${ago(lastOk, nowMs)}${c.remote ? ` de ${c.remote}` : ''}` }
      : { state: 'idle', detail: 'ainda não conectou' };

  const nowPlaying = s.now.title ? `No ar: ${s.now.title}${s.now.part ? ` — ${s.now.part}` : ' (sem letra)'}` : 'Nada no ar';

  const help = s.http?.listening
    ? s.http.addresses.length > 0
      ? `No CMElite, use IP ${s.http.addresses.join(' ou ')} e porta ${s.http.port}.`
      : `No CMElite, use o IP deste computador e porta ${s.http.port}.`
    : 'Configure o token abaixo e salve para a ponte começar a escutar.';

  return {
    bridge,
    client,
    nowPlaying,
    help,
    events: s.events.map((e) => ({ time: clock(e.at), message: e.message, color: COLORS[e.level] })),
  };
}
