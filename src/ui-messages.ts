// Mensagens que o painel (iframe) manda para o plugin.
import { validateConfig, type CompatConfig } from './protocol';
import type { PluginState } from './state';

export interface UiContext {
  state: PluginState;
  post(msg: unknown): void;
  saveConfig(cfg: CompatConfig): Promise<void>;
  /** Pede um token novo à ponte; false se ela estiver desconectada. */
  requestToken(): boolean;
}

export async function handleUiMessage(raw: unknown, ctx: UiContext): Promise<void> {
  if (!raw || typeof raw !== 'object') return;
  const msg = raw as { type?: unknown; port?: unknown; token?: unknown };
  if (msg.type === 'ui-ready') {
    ctx.post({ type: 'state', state: ctx.state.snapshot() });
    return;
  }
  if (msg.type === 'generate-token') {
    if (!ctx.requestToken()) ctx.post({ type: 'config-result', error: 'ponte desconectada: abra a ponte CMElite para gerar um token' });
    return;
  }
  if (msg.type === 'save-config') {
    const v = validateConfig({ port: msg.port, token: msg.token });
    if (!v.ok) {
      ctx.post({ type: 'config-result', error: v.error });
      return;
    }
    await ctx.saveConfig(v.config);
    ctx.post({ type: 'config-result' });
  }
}

/** Token novo vindo da ponte: já salva (com a porta atual) e mostra no painel para copiar. */
export async function handleGeneratedToken(token: string, ctx: UiContext): Promise<void> {
  const v = validateConfig({ port: ctx.state.snapshot().config.port, token });
  if (!v.ok) {
    ctx.post({ type: 'config-result', error: v.error });
    return;
  }
  await ctx.saveConfig(v.config);
  ctx.post({ type: 'generated-token', token: v.config.token });
}

/** Configuração guardada na ponte: adotada só se o plugin estiver sem a dele (ex.: acabou de ser reinstalado). */
export async function adoptSavedConfig(saved: CompatConfig, ctx: UiContext): Promise<void> {
  if (ctx.state.snapshot().config.token) return;
  const v = validateConfig(saved);
  if (v.ok) await ctx.saveConfig(v.config);
}
