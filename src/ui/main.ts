// Painel CMElite: status da ponte e do CMElite, o que está no ar, configuração e eventos.
import { onMessage, postMessage } from '@spresenter/plugin-sdk/ui';
import { Actions, Alert, Button, el, Field, Header, Hint, injectStyles, Panel, Root, Stack, StatusIndicator, TextInput } from '@spresenter/plugin-sdk/ui-kit';
import type { PanelState } from '../state';
import { copyText } from './copy';
import { toViewModel } from './view-model';

injectStyles();

const bridge = StatusIndicator({ label: 'Ponte' });
const client = StatusIndicator({ label: 'CMElite' });
const nowLine = el('div', { style: { fontWeight: '600' } });
const help = Hint('');
const port = TextInput({ type: 'number', placeholder: '8091' });
const token = TextInput({ type: 'password', placeholder: 'mesmo token do perfil no CMElite' });
// Lido no painel e digitado no CMElite (outro computador): fonte maior e monoespaçada.
Object.assign(token.style, { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '18px', letterSpacing: '1px' });
const feedback = el('div');
const events = el('ul', { style: { listStyle: 'none', margin: '0', padding: '0', display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '12px' } });

let dirty = false;
port.addEventListener('input', () => (dirty = true));
token.addEventListener('input', () => (dirty = true));

const toggle = Button({
  label: 'Mostrar',
  size: 'sm',
  onClick: () => {
    token.type = token.type === 'password' ? 'text' : 'password';
    toggle.textContent = token.type === 'password' ? 'Mostrar' : 'Ocultar';
  },
});
const generate = Button({
  label: 'Gerar token',
  size: 'sm',
  onClick: () => postMessage({ type: 'generate-token' }),
});
const copy = Button({
  label: 'Copiar',
  size: 'sm',
  onClick: () => {
    void copyText(token.value, {
      writeText: navigator.clipboard ? (text) => navigator.clipboard.writeText(text) : undefined,
      execCopy: () => {
        token.type = 'text';
        toggle.textContent = 'Ocultar';
        token.select();
        try {
          return document.execCommand('copy');
        } catch {
          return false;
        }
      },
    }).then((r) =>
      feedback.replaceChildren(
        Alert(
          r === 'copied'
            ? { variant: 'success', text: 'Token copiado. Cole no perfil do CMElite.' }
            : { variant: 'info', text: 'Token selecionado: use Cmd+C (Mac) ou Ctrl+C (Windows).' },
        ),
      ),
    );
  },
});
const save = Button({
  label: 'Salvar',
  variant: 'primary',
  onClick: () => {
    postMessage({ type: 'save-config', port: Number(port.value), token: token.value });
    dirty = false;
  },
});

document.getElementById('root')!.append(
  Root(
    Header({ title: 'CMElite', subtitle: 'Letras passadas pelo CMElite no Spresenter' }),
    Panel({ label: 'Status', children: [Stack(bridge, client, nowLine, help)] }),
    Panel({ label: 'Configuração', children: [Field({ label: 'Porta', control: port }), Field({ label: 'Token', control: token }), Actions(generate, copy, toggle, save), feedback] }),
    Panel({ label: 'Eventos', children: [events] }),
  ),
);

let last: PanelState | null = null;

function render(): void {
  if (!last) return;
  const vm = toViewModel(last, Date.now());
  bridge.set({ state: vm.bridge.state, detail: vm.bridge.detail });
  client.set({ state: vm.client.state, detail: vm.client.detail });
  nowLine.textContent = vm.nowPlaying;
  help.textContent = vm.help;
  if (!dirty) {
    port.value = String(last.config.port);
    token.value = last.config.token;
  }
  events.replaceChildren(...vm.events.map((e) => el('li', { style: { color: e.color } }, `${e.time}  ${e.message}`)));
}

onMessage((raw) => {
  const msg = raw as { type?: string; state?: PanelState; error?: string };
  if (msg.type === 'state' && msg.state) {
    last = msg.state;
    render();
  }
  if (msg.type === 'generated-token' && typeof (raw as { token?: unknown }).token === 'string') {
    token.value = (raw as { token: string }).token;
    token.type = 'text';
    toggle.textContent = 'Ocultar';
    dirty = false;
    feedback.replaceChildren(Alert({ variant: 'success', text: 'Token gerado e salvo. Copie e coloque o mesmo token no perfil do CMElite.' }));
  }
  if (msg.type === 'config-result') {
    feedback.replaceChildren(Alert(msg.error ? { variant: 'error', text: msg.error } : { variant: 'success', text: 'Configuração salva.' }));
  }
});

setInterval(render, 5000);
postMessage({ type: 'ui-ready' });
