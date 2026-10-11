# Ponte CMElite → Spresenter — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Tarefas interativas:** as Tasks 1 e 13 precisam do usuário (carregar plugin no Spresenter, operar o CMElite, olhar a tela). Rode-as na sessão principal, nunca num subagente.

**Goal:** Fazer o CMElite passar as letras no Spresenter falando a API de letras que ele já usa, sem nenhuma alteração no CMElite.

**Architecture:** Uma ponte (Bun, executável único) escuta o CMElite na rede, faz a autenticação por hash e repassa cada chamada por WebSocket local (`127.0.0.1:8092`) a um plugin headless do Spresenter. O plugin implementa as ações com o SDK (busca na biblioteca, slides, pôr a parte no ar) e mantém um painel de status e configuração. A lógica do plugin fica em funções puras (`src/compat/`) testadas com `bun test`.

**Tech Stack:** TypeScript 5, Bun 1.3.14 (ponte, testes, compilação), Vite 5 (build do plugin e do painel), `@spresenter/plugin-sdk` (vendorizado em `sdk/`), Spresenter 0.3.50.

**Spec:** `docs/superpowers/specs/2026-10-09-ponte-cmelite-design.md`

## Global Constraints

- **Nenhuma alteração no CMElite** (código ou arquivos). Só o IP/porta/token do perfil, pela tela de ajustes dele.
- **O nome do software de projeção original não aparece** em código, nomes de arquivo, comentários, textos de interface ou documentos do repositório. O teste `tests/naming.test.ts` (Task 2) garante isso.
- Plugin roda num sandbox com apenas: `spresenter`, `console`, `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `queueMicrotask` + built-ins do JavaScript. **Não usar** `URL`, `fetch`, `TextEncoder`, `crypto`, `Buffer` nem módulos Node em `src/` (exceto `src/ui/`, que roda num iframe com DOM).
- Código do plugin (`src/`, fora `src/ui/`) compila com `lib: ES2020` — não usar `Array.prototype.at`, `replaceAll` nem outros recursos ES2021+.
- Portas: HTTP do CMElite padrão **8091** (configurável); WebSocket ponte⇄plugin **127.0.0.1:8092** fixo. Tempo máximo de resposta do plugin: **3000 ms**. Versão informada em `GetTokenInfo`: **`2.25.0`**.
- Autenticação: `dtoken = hex(sha256(nonce + ":" + rid + ":" + token + ":" + dados))`, `dados = "auth"` no passo 2 do `Auth` e corpo cru nas demais.
- Manifesto: `id` `com.jaber.integracao-letras-cmelite`, `minAppVersion` e `sdk` **`0.3.50`**.
- Textos para o usuário em **português do Brasil**. Mensagens de erro de autenticação devolvidas ao CMElite seguem o protocolo em inglês (`invalid token`, `invalid rid`, `invalid session`, `unauthorized`).
- Sem dependências de runtime novas. Dev: só `@types/bun`.

## Review Focus

1. **Corpo com acentos na verificação do hash** (o CMElite manda "Refrão", "Pré-refrão"): tem que autenticar igual a texto ASCII. → teste em Task 6.
2. **Porta do CMElite já ocupada** (ex.: o software original aberto na mesma máquina): a ponte não cai, informa o erro no painel e aceita outra porta. → teste em Task 8.
3. **Token vazio ou só espaços salvo no painel**: recusado com mensagem clara; a ponte não abre a porta. → testes em Tasks 2 e 8.
4. **CMElite refaz o login** (nova sessão) com a antiga ainda viva, e **`rid` repetido**: o novo login funciona; a repetição é recusada. → teste em Task 6.
5. **Painel aberto depois que tudo aconteceu**: recebe o estado atual completo, não uma tela vazia. → teste em Task 10.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/protocol.ts` | Constantes, tipos e (de)codificação das mensagens ponte⇄plugin; `validateConfig` |
| `src/compat/normalize.ts` | Normalização de texto (busca e comparação de slides) |
| `src/compat/search.ts` | Busca e ordenação de músicas; formato de resposta; `pickFields` |
| `src/compat/slides.ts` | Letra do Spresenter → slides do protocolo |
| `src/compat/match.ts` | Texto recebido → índice da parte |
| `src/compat/actions.ts` | As 5 ações do plugin sobre interfaces injetadas (`SongStore`, `Projector`) |
| `src/songs.ts` | Adaptador SDK → `SongStore` |
| `src/projector.ts` | Adaptador SDK → `Projector` (pôr parte no ar, apagar, texto livre) |
| `src/bridge-client.ts` | Conexão WebSocket do plugin com a ponte, com reconexão |
| `src/alerts.ts` | Avisos no sino do Spresenter |
| `src/state.ts` | Estado do painel (`PluginState`) |
| `src/ui-messages.ts` | Mensagens painel → plugin |
| `src/code.ts` | Entrada do plugin: liga tudo |
| `src/ui/*` | Painel (HTML + `main.ts` + `view-model.ts`) |
| `bridge/auth.ts` | Sessões, nonce, verificação de `dtoken`/`rid` |
| `bridge/compat-http.ts` | Tradução HTTP do CMElite ⇄ chamadas ao plugin |
| `bridge/plugin-link.ts` | Conexão da ponte com o plugin, chamadas pendentes e tempo esgotado |
| `bridge/server.ts` | Sobe os servidores HTTP e WebSocket; aplica configuração |
| `bridge/autostart.ts` | Início automático (macOS LaunchAgent / Windows registro) |
| `bridge/main.ts` | Linha de comando da ponte |
| `scripts/build-bridge.ts` | Compila os executáveis da ponte |
| `tests/*.test.ts` | Testes `bun test` |

---

### Task 1: Sonda no Spresenter (verificações V2, V3, V4) — INTERATIVA

Responde, no Spresenter real, o que o SDK não documenta. O código desta tarefa é **descartável**: fica em `probe/`, não é commitado e é apagado no fim.

**Files:**
- Create (temporário): `probe/manifest.json`, `probe/code.js`, `probe/driver.ts`
- Modify: `docs/superpowers/specs/2026-10-09-ponte-cmelite-design.md` (§11, registrar resultados)

**Interfaces:**
- Produces: decisões **D1–D7** (abaixo), usadas nas Tasks 4, 9 e 13.

| Decisão | Pergunta | Onde é usada |
|---|---|---|
| D1 | Tipo de asset das músicas é `music`? | `src/songs.ts` (`MUSIC_TYPE`) |
| D2 | `setMusicVerse` indexa `sections[]` (e `lyrics[i] === sections[i].text`)? | `src/compat/slides.ts` |
| D3 | Em qual camada o clique manual põe a música? | `PROJECTOR_CONFIG.layer` |
| D4 | Uma chamada de `setMusicVerse` atinge todas as saídas do clique manual? | `PROJECTOR_CONFIG.perOutput` |
| D5 | Como apagar só a letra mantendo o fundo: `clear` ou `hide`? | `PROJECTOR_CONFIG.blankMode` |
| D6 | `wsOpen` resolve já aberto? evento `open` dispara depois? | conferência de `src/bridge-client.ts` |
| D7 | Apresentação de texto livre (`live.apply`) aparece? | `Projector.showText` |

- [ ] **Step 1: Criar `probe/manifest.json`**

```json
{
  "id": "com.jaber.cmelite-sonda",
  "name": "Sonda CMElite (temporária)",
  "version": "0.0.1",
  "minAppVersion": "0.3.50",
  "sdk": "0.3.50",
  "main": "code.js",
  "permissions": ["outputs:read", "assets:read", "live:read", "live:write", "net:connect"],
  "background": true
}
```

- [ ] **Step 2: Criar `probe/code.js`**

```js
// Sonda temporária: executa comandos enviados por probe/driver.ts e devolve o resultado.
const DRIVER = 'ws://127.0.0.1:8092';
const log = (...a) => console.log('[sonda]', ...a);

async function run(cmd) {
  switch (cmd.op) {
    case 'outputs':
      return { outputs: await spresenter.outputs.list(), layers: await spresenter.layers.list() };
    case 'songs':
      return (await spresenter.assets.list({ type: 'music' })).map((a) => ({ guid: a.guid, type: a.type, title: a.title, author: a.author }));
    case 'lyrics':
      return await spresenter.assets.getLyrics(cmd.guid);
    case 'read': {
      const outs = await spresenter.outputs.list();
      const r = {};
      for (const o of outs) {
        const k = String(o.index);
        const live = await spresenter.live.read(k);
        const st = await spresenter.live.readState(k);
        r[k] = live
          .map((p, layer) => (p ? { layer, asset: p.asset && { guid: p.asset.guid, type: p.asset.type, title: p.asset.title }, title: p.title, props: p.props, show: st[layer] && st[layer].show } : null))
          .filter(Boolean);
      }
      return r;
    }
    case 'verse':
      await spresenter.live.setMusicVerse(String(cmd.output), cmd.layer, cmd.guid, cmd.index);
      return 'ok';
    case 'clear':
      await spresenter.live.clear(String(cmd.output), cmd.layer);
      return 'ok';
    case 'state':
      return await spresenter.live.setState(String(cmd.output), cmd.layer, cmd.patch);
    case 'apply':
      await spresenter.live.apply(String(cmd.output), cmd.layer, cmd.presentation);
      await spresenter.live.setState(String(cmd.output), cmd.layer, { show: true });
      return 'ok';
    default:
      throw new Error('op desconhecida: ' + cmd.op);
  }
}

async function connect() {
  let id;
  try {
    id = await spresenter.net.wsOpen(DRIVER);
  } catch (e) {
    log('wsOpen falhou', String(e));
    setTimeout(connect, 2000);
    return;
  }
  log('wsOpen resolveu', id);
  spresenter.net.on(id, 'open', () => {
    spresenter.net.wsSend(id, JSON.stringify({ hello: true, via: 'open' }));
  });
  spresenter.net.on(id, 'message', async (e) => {
    const cmd = JSON.parse(e.data);
    try {
      const result = await run(cmd);
      await spresenter.net.wsSend(id, JSON.stringify({ seq: cmd.seq, ok: true, result }));
    } catch (err) {
      await spresenter.net.wsSend(id, JSON.stringify({ seq: cmd.seq, ok: false, error: String((err && err.message) || err) }));
    }
  });
  spresenter.net.on(id, 'close', () => {
    log('fechou');
    setTimeout(connect, 2000);
  });
  const sent = await spresenter.net.wsSend(id, JSON.stringify({ hello: true, via: 'resolve' }));
  log('wsSend logo após resolver =', sent);
}

connect();
```

- [ ] **Step 3: Criar `probe/driver.ts`**

```ts
// Sonda temporária: conversa com probe/code.js e guia o teste no Spresenter.
import { createInterface } from 'node:readline/promises';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const SONG = process.env.SONG ?? 'Bom Perfume';
const LAYER = Number(process.env.LAYER ?? 0);

let sock: { send(data: string): unknown } | null = null;
let seq = 0;
const waiting = new Map<number, (m: { ok: boolean; result?: any; error?: string }) => void>();
const hellos: string[] = [];
let ready!: () => void;
const connected = new Promise<void>((r) => (ready = r));

Bun.serve({
  hostname: '127.0.0.1',
  port: 8092,
  fetch(req, srv) {
    return srv.upgrade(req) ? undefined : new Response('sonda', { status: 426 });
  },
  websocket: {
    open(ws) {
      sock = ws;
      ready();
    },
    message(_ws, raw) {
      const m = JSON.parse(String(raw));
      if (m.hello) {
        hellos.push(m.via);
        return;
      }
      waiting.get(m.seq)?.(m);
      waiting.delete(m.seq);
    },
    close() {
      sock = null;
    },
  },
});

async function cmd(op: string, extra: Record<string, unknown> = {}): Promise<any> {
  const s = ++seq;
  const p = new Promise<{ ok: boolean; result?: any; error?: string }>((r) => waiting.set(s, r));
  sock!.send(JSON.stringify({ seq: s, op, ...extra }));
  const m = await p;
  if (!m.ok) throw new Error(m.error);
  return m.result;
}
const show = (title: string, v: unknown) => console.log(`\n=== ${title}\n${JSON.stringify(v, null, 2)}`);
const ask = (q: string) => rl.question(`\n>>> ${q}\n(Enter para continuar) `);

console.log('Aguardando a sonda conectar (carregue a pasta probe/ no Spresenter)...');
await connected;
await Bun.sleep(1500);
show('D6: hellos recebidos (resolve = wsOpen já estava aberto; open = evento open disparou)', hellos);

const { outputs, layers } = await cmd('outputs');
show('saídas', outputs);
show('camadas', layers);

const songs = await cmd('songs');
show('D1: tipos de asset devolvidos com filtro type=music', [...new Set(songs.map((s: any) => s.type))]);
const song = songs.find((s: any) => (s.title ?? '').toLowerCase().includes(SONG.toLowerCase()));
if (!song) throw new Error(`música "${SONG}" não encontrada; rode de novo com SONG="<título>"`);
show('música escolhida', song);

const lyrics = await cmd('lyrics', { guid: song.guid });
show('D2: estrutura da letra', {
  lyricsLen: lyrics.lyrics?.length,
  sectionsLen: lyrics.sections?.length,
  textosIguais: (lyrics.sections ?? []).map((s: any, i: number) => s.text === lyrics.lyrics?.[i]),
  tipos: (lyrics.sections ?? []).map((s: any) => s.type),
  grupos: lyrics.groups,
});

await ask(`No Spresenter, CLIQUE MANUALMENTE na 3ª parte de "${song.title}" (índice 2) e deixe no ar.`);
show('D3/D4: estado após o clique manual', await cmd('read'));

await ask('Agora tire a música do ar no Spresenter (limpe a tela).');
const out0 = String(outputs[0]?.index ?? 0);
await cmd('verse', { output: out0, layer: LAYER, guid: song.guid, index: 2 });
show(`D3/D4: estado após setMusicVerse(${out0}, ${LAYER}, guid, 2)`, await cmd('read'));
await ask('Compare: é a MESMA parte, com o MESMO tema e fundo do clique manual? Apareceu em TODAS as saídas que o clique manual usou? Anote.');

await cmd('clear', { output: out0, layer: LAYER });
await ask('D5a: usei live.clear na camada. O FUNDO continuou na tela ou sumiu tudo? Anote.');

await cmd('verse', { output: out0, layer: LAYER, guid: song.guid, index: 2 });
await cmd('state', { output: out0, layer: LAYER, patch: { show: false } });
await ask('D5b: usei setState({show:false}). O FUNDO continuou e só a letra sumiu? Anote.');
await cmd('state', { output: out0, layer: LAYER, patch: { show: true } });
await cmd('clear', { output: out0, layer: LAYER });

await cmd('apply', {
  output: out0,
  layer: LAYER,
  presentation: {
    title: 'Sonda',
    asset: { type: 'presentation', guid: 'sonda-texto', title: 'Sonda' },
    theme: {
      title: 'Sonda',
      css: {},
      elements: [
        {
          id: 'texto', type: 'TEXT', text: 'Texto livre da sonda\nsegunda linha', x: 0, y: 0, visible: true,
          css: { width: '100%', height: '100%', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'text-align': 'center', 'white-space': 'pre-line', 'font-family': 'Arial', 'font-size': '72px', 'font-weight': '700', color: '#ffffff' },
        },
      ],
    },
    props: {},
  },
});
await ask('D7: apareceu "Texto livre da sonda" em duas linhas? Anote.');
await cmd('clear', { output: out0, layer: LAYER });
console.log('\nFim da sonda.');
process.exit(0);
```

- [ ] **Step 4: Rodar a sonda com o usuário**

Garanta que nada escuta na 8092 (`lsof -nP -iTCP:8092 -sTCP:LISTEN` vazio). Rode em segundo plano e acompanhe a saída:

```bash
SONG="Bom Perfume" bun probe/driver.ts
```

Peça ao usuário: **Spresenter → Configurações → Plugins → Carregar pasta (dev) → `probe/`**. Conduza as perguntas do driver com ele. Se o estado após o clique manual mostrar a música numa camada diferente de 0, rode de novo com `LAYER=<n>`.

- [ ] **Step 5: Registrar as decisões**

Com base na saída e nas respostas do usuário:

- **D1:** se o filtro devolveu só `music` → `MUSIC_TYPE = 'music'`. Se veio outro valor → use esse valor em `src/songs.ts` (Task 9).
- **D2:** se `sectionsLen === lyricsLen` e todos `textosIguais` são `true`, e o clique manual no índice 2 mostrou a mesma parte que `setMusicVerse(…, 2)` → **seções confirmadas** (Task 4 segue como está). Caso contrário → **PARE** e reabra o design com o usuário: a unidade de slide é diferente da assumida.
- **D3:** a camada onde o clique manual pôs a música → `PROJECTOR_CONFIG.layer`.
- **D4:** se a chamada única atingiu as mesmas saídas do clique manual → `perOutput: false`; se só a saída 0 → `perOutput: true`.
- **D5:** se D5a manteve o fundo → `blankMode: 'clear'`; senão, se D5b manteve → `'hide'`; se nenhum manteve → `'clear'` (a spec aceita limpar a camada).
- **D6:** anote os `hellos`. `BridgeClient` (Task 9) trata os dois casos; nada a mudar, só confirmar.
- **D7:** se o texto apareceu → `showText` como na Task 9. Se não → na Task 9 use a variante "sem texto livre" descrita lá.

Atualize a tabela §11 da spec marcando V2, V3 e V4 como feitos, com os valores de D1–D7.

- [ ] **Step 6: Limpar e commitar**

Peça ao usuário para remover a "Sonda CMElite (temporária)" da lista de plugins do Spresenter. Pare o driver. Depois:

```bash
rm -rf probe
git add docs/superpowers/specs/2026-10-09-ponte-cmelite-design.md
git commit -m "docs: resultados da sonda no Spresenter (V2–V4)"
```

---

### Task 2: Base do projeto, testes e protocolo compartilhado

**Files:**
- Commit inicial do scaffold existente (`.gitignore`, `README.md`, `manifest.json`, `package.json`, `package-lock.json`, `scripts/`, `sdk/`, `src/code.ts`, `tsconfig.json`, `vite.code.config.ts`)
- Create: `src/protocol.ts`, `bridge/tsconfig.json`, `tests/protocol.test.ts`, `tests/naming.test.ts`
- Modify: `package.json` (scripts, devDependency)

**Interfaces:**
- Produces (`src/protocol.ts`):
  - `WS_PORT = 8092`, `DEFAULT_HTTP_PORT = 8091`, `CALL_TIMEOUT_MS = 3000`, `COMPAT_VERSION = '2.25.0'`
  - `PLUGIN_ACTIONS: readonly ['SearchLyrics','GetLyrics','ShowLyrics','ShowQuickPresentation','CloseCurrentPresentation']`
  - `interface CompatConfig { port: number; token: string }`
  - `interface HttpStatus { listening: boolean; port: number; addresses: string[]; error?: string }`
  - `type ClientEventKind = 'auth-ok' | 'auth-fail' | 'request'`
  - `type PluginToBridge`, `type BridgeToPlugin` (ver código)
  - `encode(msg)`, `decodePluginMessage(raw): PluginToBridge | null`, `decodeBridgeMessage(raw): BridgeToPlugin | null`
  - `validateConfig(input: unknown): { ok: true; config: CompatConfig } | { ok: false; error: string }`

- [ ] **Step 1: Commitar o scaffold como base**

```bash
git add .gitignore README.md manifest.json package.json package-lock.json scripts sdk src/code.ts tsconfig.json vite.code.config.ts
git commit -m "chore: base do plugin gerada pelo Spresenter"
```

- [ ] **Step 2: Instalar tipos do Bun e scripts**

```bash
npm install -D @types/bun
npm pkg set scripts.test="bun test"
npm pkg set scripts.typecheck="tsc -p tsconfig.json && tsc -p bridge/tsconfig.json"
```

Crie `bridge/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ESNext"],
    "types": ["bun"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["./**/*.ts", "../tests/**/*.ts"]
}
```

- [ ] **Step 3: Escrever o teste de nomes (guarda)**

`tests/naming.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// O nome do software de projeção original não pode aparecer no projeto; fica codificado aqui.
const banned = Buffer.from('aG9seXJpY3M=', 'base64').toString('utf8');
const root = join(import.meta.dir, '..');
const roots = ['src', 'bridge', 'tests', 'scripts', 'docs', 'manifest.json', 'package.json', 'README.md'];

function files(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { recursive: true })
    .map((p) => join(path, String(p)))
    .filter((p) => statSync(p).isFile());
}

test('o nome do software original não aparece em código, nomes de arquivo nem textos', () => {
  const offenders = roots
    .flatMap((r) => files(join(root, r)))
    .filter((f) => f.toLowerCase().includes(banned) || readFileSync(f, 'utf8').toLowerCase().includes(banned));
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 4: Rodar a guarda**

Run: `bun test tests/naming.test.ts`
Expected: PASS (é uma guarda; passa desde o início e falha se alguém introduzir o nome).

- [ ] **Step 5: Escrever o teste do protocolo**

`tests/protocol.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { decodeBridgeMessage, decodePluginMessage, encode, validateConfig, WS_PORT } from '../src/protocol';

describe('validateConfig', () => {
  test('aceita porta e token válidos e apara o token', () => {
    expect(validateConfig({ port: '8091', token: '  abc123  ' })).toEqual({ ok: true, config: { port: 8091, token: 'abc123' } });
  });
  test('recusa token vazio ou só espaços', () => {
    expect(validateConfig({ port: 8091, token: '   ' })).toEqual({ ok: false, error: 'token vazio: use o mesmo token do perfil no CMElite' });
    expect(validateConfig({ port: 8091 })).toMatchObject({ ok: false });
  });
  test('recusa porta fora da faixa, não inteira ou reservada', () => {
    for (const port of [0, 65536, 80.5, 'abc', undefined]) expect(validateConfig({ port, token: 't' })).toMatchObject({ ok: false });
    expect(validateConfig({ port: WS_PORT, token: 't' })).toEqual({ ok: false, error: `a porta ${WS_PORT} é reservada para o plugin` });
  });
});

describe('mensagens', () => {
  test('ida e volta de uma chamada', () => {
    const raw = encode({ type: 'call', id: 1, action: 'SearchLyrics', body: { text: 'x' } });
    expect(decodeBridgeMessage(raw)).toEqual({ type: 'call', id: 1, action: 'SearchLyrics', body: { text: 'x' } });
  });
  test('resposta com e sem data', () => {
    expect(decodePluginMessage(encode({ type: 'reply', id: 2, ok: true }))).toEqual({ type: 'reply', id: 2, ok: true });
    expect(decodePluginMessage(encode({ type: 'reply', id: 3, ok: true, data: null }))).toEqual({ type: 'reply', id: 3, ok: true, data: null });
    expect(decodePluginMessage(encode({ type: 'reply', id: 4, ok: false, error: 'falhou' }))).toEqual({ type: 'reply', id: 4, ok: false, error: 'falhou' });
  });
  test('status e evento da ponte', () => {
    expect(decodeBridgeMessage(encode({ type: 'status', listening: true, port: 8091, addresses: ['10.0.0.2'] }))).toEqual({ type: 'status', listening: true, port: 8091, addresses: ['10.0.0.2'] });
    expect(decodeBridgeMessage(encode({ type: 'event', kind: 'auth-ok', at: '2026-10-09T18:00:00.000Z', remote: '10.0.0.5' }))).toMatchObject({ kind: 'auth-ok' });
  });
  test('ignora lixo', () => {
    for (const raw of ['', 'nada', '[]', '{"type":5}', '{"type":"call","id":"1"}', '{"type":"reply","id":1,"ok":false}']) {
      expect(decodeBridgeMessage(raw)).toBeNull();
      expect(decodePluginMessage(raw)).toBeNull();
    }
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `bun test tests/protocol.test.ts`
Expected: FAIL — `Cannot find module '../src/protocol'`.

- [ ] **Step 7: Implementar `src/protocol.ts`**

```ts
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
  | ({ type: 'config' } & CompatConfig)
  | { type: 'reply'; id: number; ok: true; data?: unknown }
  | { type: 'reply'; id: number; ok: false; error: string };

export type BridgeToPlugin =
  | ({ type: 'status' } & HttpStatus)
  | { type: 'call'; id: number; action: string; body: Record<string, unknown> }
  | { type: 'event'; kind: ClientEventKind; at: string; remote: string; action?: string };

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
```

Note: `Number(undefined)` é `NaN` e `Number('abc')` é `NaN`, ambos recusados por `Number.isInteger`.

- [ ] **Step 8: Rodar tudo**

Run: `bun test && npm run typecheck`
Expected: PASS em `protocol.test.ts` e `naming.test.ts`; typecheck sem erros.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json bridge/tsconfig.json src/protocol.ts tests/protocol.test.ts tests/naming.test.ts
git commit -m "feat: protocolo ponte-plugin e infraestrutura de testes"
```

---

### Task 3: Normalização e busca de músicas

**Files:**
- Create: `src/compat/normalize.ts`, `src/compat/search.ts`, `tests/compat-search.test.ts`

**Interfaces:**
- Produces:
  - `fold(s: string): string` — sem acentos, minúsculas, espaços colapsados, aparado
  - `normalizeSlideText(s: string): string` — `\r\n`→`\n`, cada linha com espaços colapsados e aparada, sem linhas vazias nas pontas
  - `isBlank(s: string): boolean`
  - `interface SongRef { guid: string; title: string; artist: string }`
  - `searchSongs(songs: SongRef[], text: string): SongRef[]`
  - `toSongSummary(s: SongRef): { id: string; title: string; artist: string; author: string }`
  - `pickFields<T extends Record<string, unknown>>(obj: T, fields: unknown): Partial<T>`

- [ ] **Step 1: Escrever o teste**

`tests/compat-search.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { fold, isBlank, normalizeSlideText } from '../src/compat/normalize';
import { pickFields, searchSongs, toSongSummary, type SongRef } from '../src/compat/search';

describe('normalize', () => {
  test('fold remove acentos, caixa e espaços extras', () => {
    expect(fold('  Grande É  o Senhor ')).toBe('grande e o senhor');
    expect(fold('Pré-Refrão')).toBe('pre-refrao');
  });
  test('normalizeSlideText unifica quebras e espaços por linha', () => {
    expect(normalizeSlideText('\r\n  Linha  um \r\nLinha dois  \n\n')).toBe('Linha um\nLinha dois');
  });
  test('isBlank', () => {
    expect(isBlank(' ')).toBe(true);
    expect(isBlank('\n\t\u00a0')).toBe(true);
    expect(isBlank(' a ')).toBe(false);
  });
});

const songs: SongRef[] = [
  { guid: 'g1', title: 'Bom Perfume', artist: 'Gabi Sampaio' },
  { guid: 'g2', title: 'Teu Toque', artist: 'Gabi Sampaio' },
  { guid: 'g3', title: 'Grande é o Senhor', artist: 'Eli Soares' },
  { guid: 'g4', title: 'Bom Perfume (Ao Vivo)', artist: 'Outro' },
  { guid: 'g5', title: 'Um Bom Perfume', artist: 'Outro' },
];
const ids = (r: SongRef[]) => r.map((s) => s.guid);

describe('searchSongs', () => {
  test('texto vazio devolve todas, em ordem alfabética', () => {
    expect(ids(searchSongs(songs, '   '))).toEqual(['g1', 'g4', 'g3', 'g2', 'g5']);
  });
  test('ignora acento, caixa e espaço no fim', () => {
    expect(ids(searchSongs(songs, 'grande E o senhor '))).toEqual(['g3']);
  });
  test('todas as palavras precisam aparecer em título ou artista', () => {
    expect(ids(searchSongs(songs, 'toque gabi'))).toEqual(['g2']);
    expect(ids(searchSongs(songs, 'toque eli'))).toEqual([]);
  });
  test('título idêntico primeiro, depois quem começa com o texto, depois o resto', () => {
    expect(ids(searchSongs(songs, 'bom perfume'))).toEqual(['g1', 'g4', 'g5']);
  });
});

describe('formato de resposta', () => {
  test('toSongSummary usa o guid como id e o artista também como autor', () => {
    expect(toSongSummary(songs[0])).toEqual({ id: 'g1', title: 'Bom Perfume', artist: 'Gabi Sampaio', author: 'Gabi Sampaio' });
  });
  test('pickFields respeita a lista pedida e ignora lista vazia', () => {
    const s = toSongSummary(songs[0]);
    expect(pickFields(s, 'id, title')).toEqual({ id: 'g1', title: 'Bom Perfume' });
    expect(pickFields(s, '')).toEqual(s);
    expect(pickFields(s, undefined)).toEqual(s);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test tests/compat-search.test.ts`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Implementar `src/compat/normalize.ts`**

```ts
// Normalização de texto usada na busca de músicas e na comparação de slides.

/** Minúsculas, sem acentos, espaços colapsados e aparado — para comparar nomes. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Texto de slide comparável: quebras unificadas, cada linha aparada, sem linhas vazias nas pontas. */
export function normalizeSlideText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** O CMElite manda " " para seções do VS sem letra. */
export function isBlank(s: string): boolean {
  return s.trim() === '';
}
```

- [ ] **Step 4: Implementar `src/compat/search.ts`**

```ts
// Busca de músicas no formato que o CMElite espera (ele usa sempre o primeiro resultado).
import { fold } from './normalize';

export interface SongRef {
  guid: string;
  title: string;
  artist: string;
}

export function searchSongs(songs: SongRef[], text: string): SongRef[] {
  const q = fold(text);
  const words = q ? q.split(' ') : [];
  const rank = (title: string) => (q && title === q ? 0 : q && title.startsWith(q) ? 1 : 2);
  return songs
    .map((s) => ({ s, title: fold(s.title), hay: fold(`${s.title} ${s.artist}`) }))
    .filter(({ hay }) => words.every((w) => hay.includes(w)))
    .sort((a, b) => rank(a.title) - rank(b.title) || a.title.localeCompare(b.title))
    .map(({ s }) => s);
}

export function toSongSummary(s: SongRef): { id: string; title: string; artist: string; author: string } {
  return { id: s.guid, title: s.title, artist: s.artist, author: s.artist };
}

/** Mantém só os campos pedidos em `fields` ("id,title,..."); sem lista, devolve tudo. */
export function pickFields<T extends Record<string, unknown>>(obj: T, fields: unknown): Partial<T> {
  if (typeof fields !== 'string' || !fields.trim()) return obj;
  const keep = new Set(fields.split(',').map((f) => f.trim()).filter(Boolean));
  return Object.fromEntries(Object.entries(obj).filter(([k]) => keep.has(k))) as Partial<T>;
}
```

- [ ] **Step 5: Rodar**

Run: `bun test tests/compat-search.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/compat/normalize.ts src/compat/search.ts tests/compat-search.test.ts
git commit -m "feat: busca tolerante de músicas no formato compatível"
```

---

### Task 4: Slides e escolha da parte pelo texto

Pressupõe **D2 = seções** (Task 1). Se D2 deu outro resultado, esta tarefa não deve ser executada como está.

**Files:**
- Create: `src/compat/slides.ts`, `src/compat/match.ts`, `tests/compat-slides.test.ts`

**Interfaces:**
- Consumes: `normalizeSlideText` (Task 3)
- Produces:
  - `interface LyricsLike { lyrics?: string[]; sections?: Array<{ type?: string; text: string; group?: string }>; groups?: Array<{ id: string; name: string }> }`
  - `interface CompatSlide { number: number; text: string; slide_description: string; background_id: string }`
  - `TYPE_NAMES: Record<string, string>`
  - `buildSlides(l: LyricsLike | null): CompatSlide[]`
  - `findPartIndex(slides: ReadonlyArray<{ text: string }>, text: string, current: number | null): number` (−1 se não achar)

- [ ] **Step 1: Escrever o teste**

`tests/compat-slides.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { buildSlides, TYPE_NAMES } from '../src/compat/slides';
import { findPartIndex } from '../src/compat/match';

const lyrics = {
  lyrics: ['Intro a', 'Verso a\nlinha 2', 'Refrão a', 'Verso b', 'Refrão a'],
  sections: [
    { type: 'intro', text: 'Intro a' },
    { type: 'verse', text: 'Verso a\nlinha 2', group: 'v1' },
    { type: 'chorus', text: 'Refrão a', group: 'r' },
    { type: 'verse', text: 'Verso b', group: 'v1' },
    { type: 'chorus', text: 'Refrão a', group: 'r' },
  ],
  groups: [
    { id: 'v1', name: 'Verso' },
    { id: 'r', name: 'Refrão' },
  ],
};

describe('buildSlides', () => {
  test('um slide por seção, com nome do grupo ou do tipo', () => {
    expect(buildSlides(lyrics)).toEqual([
      { number: 1, text: 'Intro a', slide_description: 'Introdução', background_id: '' },
      { number: 2, text: 'Verso a\nlinha 2', slide_description: 'Verso', background_id: '' },
      { number: 3, text: 'Refrão a', slide_description: 'Refrão', background_id: '' },
      { number: 4, text: 'Verso b', slide_description: 'Verso', background_id: '' },
      { number: 5, text: 'Refrão a', slide_description: 'Refrão', background_id: '' },
    ]);
  });
  test('sem seções, usa lyrics[] sem nome', () => {
    expect(buildSlides({ lyrics: ['a', 'b'] })).toEqual([
      { number: 1, text: 'a', slide_description: '', background_id: '' },
      { number: 2, text: 'b', slide_description: '', background_id: '' },
    ]);
  });
  test('letra nula vira lista vazia; tipo desconhecido fica sem nome', () => {
    expect(buildSlides(null)).toEqual([]);
    expect(buildSlides({ sections: [{ type: 'xyz', text: 't' }] })[0].slide_description).toBe('');
  });
  test('nomes dos tipos em português', () => {
    expect(TYPE_NAMES).toEqual({
      intro: 'Introdução', verse: 'Verso', 'pre-chorus': 'Pré-refrão', chorus: 'Refrão', bridge: 'Ponte',
      instrumental: 'Instrumental', tag: 'Tag', outro: 'Final', ending: 'Encerramento',
    });
  });
});

describe('findPartIndex', () => {
  const slides = buildSlides(lyrics);
  test('acha o texto mesmo com \\r\\n e espaços diferentes', () => {
    expect(findPartIndex(slides, 'Verso a \r\n linha 2 ', null)).toBe(1);
  });
  test('texto repetido: fica na parte atual se ela já é esse texto', () => {
    expect(findPartIndex(slides, 'Refrão a', 2)).toBe(2);
  });
  test('texto repetido: escolhe a primeira ocorrência depois da parte atual', () => {
    expect(findPartIndex(slides, 'Refrão a', 3)).toBe(4);
  });
  test('sem ocorrência adiante, volta para a primeira', () => {
    expect(findPartIndex(slides, 'Verso a\nlinha 2', 4)).toBe(1);
    expect(findPartIndex(slides, 'Refrão a', null)).toBe(2);
  });
  test('não encontrado ou em branco devolve -1', () => {
    expect(findPartIndex(slides, 'outra coisa', 0)).toBe(-1);
    expect(findPartIndex(slides, '  ', 0)).toBe(-1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test tests/compat-slides.test.ts`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Implementar `src/compat/slides.ts`**

```ts
// Converte a letra do Spresenter nos slides do protocolo compatível.
// O CMElite casa as seções do VS com `slide_description`, então o nome importa.

export interface LyricsLike {
  lyrics?: string[];
  sections?: Array<{ type?: string; text: string; group?: string }>;
  groups?: Array<{ id: string; name: string }>;
}

export interface CompatSlide {
  number: number;
  text: string;
  slide_description: string;
  background_id: string;
}

export const TYPE_NAMES: Record<string, string> = {
  intro: 'Introdução',
  verse: 'Verso',
  'pre-chorus': 'Pré-refrão',
  chorus: 'Refrão',
  bridge: 'Ponte',
  instrumental: 'Instrumental',
  tag: 'Tag',
  outro: 'Final',
  ending: 'Encerramento',
};

export function buildSlides(l: LyricsLike | null): CompatSlide[] {
  if (!l) return [];
  const groups = new Map((l.groups ?? []).map((g) => [g.id, g.name] as [string, string]));
  const sections = l.sections ?? [];
  if (sections.length > 0) {
    return sections.map((s, i) => ({
      number: i + 1,
      text: s.text,
      slide_description: (s.group && groups.get(s.group)) || (s.type && TYPE_NAMES[s.type]) || '',
      background_id: '',
    }));
  }
  return (l.lyrics ?? []).map((text, i) => ({ number: i + 1, text, slide_description: '', background_id: '' }));
}
```

- [ ] **Step 4: Implementar `src/compat/match.ts`**

```ts
// Acha qual parte da música corresponde ao texto que o CMElite mandou.
import { normalizeSlideText } from './normalize';

/**
 * Índice da parte com esse texto, ou -1. Com texto repetido (refrão), prefere:
 * a parte atual (se já é esse texto) → a primeira depois da atual → a primeira da música.
 */
export function findPartIndex(slides: ReadonlyArray<{ text: string }>, text: string, current: number | null): number {
  const target = normalizeSlideText(text);
  if (!target) return -1;
  const hits: number[] = [];
  slides.forEach((s, i) => {
    if (normalizeSlideText(s.text) === target) hits.push(i);
  });
  if (hits.length === 0) return -1;
  if (current !== null) {
    if (hits.indexOf(current) >= 0) return current;
    for (const i of hits) if (i > current) return i;
  }
  return hits[0];
}
```

- [ ] **Step 5: Rodar**

Run: `bun test tests/compat-slides.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/compat/slides.ts src/compat/match.ts tests/compat-slides.test.ts
git commit -m "feat: slides compatíveis e escolha da parte pelo texto"
```

---

### Task 5: Ações compatíveis do plugin

**Files:**
- Create: `src/compat/actions.ts`, `tests/compat-actions.test.ts`

**Interfaces:**
- Consumes: `searchSongs`, `toSongSummary`, `pickFields`, `SongRef` (Task 3); `isBlank` (Task 3); `buildSlides`, `CompatSlide`, `LyricsLike` (Task 4); `findPartIndex` (Task 4)
- Produces:
  - `interface SongStore { listSongs(): Promise<SongRef[]>; getSong(guid: string): Promise<SongRef | null>; getLyrics(guid: string): Promise<LyricsLike | null> }`
  - `interface Projector { showPart(guid: string, index: number): Promise<void>; clearLyrics(): Promise<void>; showText(text: string): Promise<void> }`
  - `type LogLevel = 'info' | 'warn' | 'error'`
  - `interface ActionDeps { songs: SongStore; projector: Projector; log(level: LogLevel, message: string): void; onNowPlaying(title: string | null, part: string | null): void }`
  - `class CompatActions { constructor(deps: ActionDeps); handle(action: string, body: Record<string, unknown>): Promise<unknown> }` — `undefined` = responder sem `data`; lança `Error` para erro

- [ ] **Step 1: Escrever o teste**

`tests/compat-actions.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { CompatActions, type Projector, type SongStore } from '../src/compat/actions';
import type { SongRef } from '../src/compat/search';
import type { LyricsLike } from '../src/compat/slides';

const BOM: SongRef = { guid: 'g1', title: 'Bom Perfume', artist: 'Gabi Sampaio' };
const OUTRA: SongRef = { guid: 'g2', title: 'Teu Toque', artist: 'Gabi Sampaio' };
const letra = (): LyricsLike => ({
  sections: [
    { type: 'verse', text: 'Verso um', group: 'v' },
    { type: 'chorus', text: 'Refrão', group: 'r' },
    { type: 'verse', text: 'Verso dois', group: 'v' },
    { type: 'chorus', text: 'Refrão', group: 'r' },
  ],
  groups: [
    { id: 'v', name: 'Verso' },
    { id: 'r', name: 'Refrão' },
  ],
});

let lyricsByGuid: Record<string, LyricsLike | null>;
let calls: string[];
let logs: Array<[string, string]>;
let now: Array<[string | null, string | null]>;
let actions: CompatActions;

const songs: SongStore = {
  listSongs: async () => [BOM, OUTRA],
  getSong: async (guid) => [BOM, OUTRA].find((s) => s.guid === guid) ?? null,
  getLyrics: async (guid) => lyricsByGuid[guid] ?? null,
};
const projector: Projector = {
  showPart: async (guid, index) => {
    calls.push(`part ${guid} ${index}`);
  },
  clearLyrics: async () => {
    calls.push('clear');
  },
  showText: async (text) => {
    calls.push(`text ${text}`);
  },
};

beforeEach(() => {
  lyricsByGuid = { g1: letra(), g2: letra() };
  calls = [];
  logs = [];
  now = [];
  actions = new CompatActions({
    songs,
    projector,
    log: (level, message) => logs.push([level, message]),
    onNowPlaying: (t, p) => now.push([t, p]),
  });
});

describe('busca e letra', () => {
  test('SearchLyrics devolve só os campos pedidos', async () => {
    expect(await actions.handle('SearchLyrics', { text: 'bom ', fields: 'id,title,artist,author' })).toEqual([
      { id: 'g1', title: 'Bom Perfume', artist: 'Gabi Sampaio', author: 'Gabi Sampaio' },
    ]);
  });
  test('GetLyrics devolve os slides e null para id desconhecido', async () => {
    const r = (await actions.handle('GetLyrics', { id: 'g1', fields: 'slides' })) as { slides: Array<{ slide_description: string }> };
    expect(Object.keys(r)).toEqual(['slides']);
    expect(r.slides.map((s) => s.slide_description)).toEqual(['Verso', 'Refrão', 'Verso', 'Refrão']);
    expect(await actions.handle('GetLyrics', { id: 'nao-existe' })).toBeNull();
  });
});

describe('passagem das partes', () => {
  test('ShowLyrics só prepara; o texto põe a parte no ar', async () => {
    await actions.handle('ShowLyrics', { id: 'g1' });
    expect(calls).toEqual([]);
    await actions.handle('ShowQuickPresentation', { text: 'Verso dois' });
    expect(calls).toEqual(['part g1 2']);
    expect(now.at(-1)).toEqual(['Bom Perfume', 'Verso']);
  });
  test('refrão repetido segue para a ocorrência seguinte e não repete o que já está no ar', async () => {
    await actions.handle('ShowLyrics', { id: 'g1' });
    await actions.handle('ShowQuickPresentation', { text: 'Refrão' });
    await actions.handle('ShowQuickPresentation', { text: 'Refrão' });
    await actions.handle('ShowQuickPresentation', { text: 'Verso dois' });
    await actions.handle('ShowQuickPresentation', { text: 'Refrão' });
    expect(calls).toEqual(['part g1 1', 'part g1 2', 'part g1 3']);
  });
  test('texto em branco apaga a letra e a mesma parte volta ao ar depois', async () => {
    await actions.handle('ShowLyrics', { id: 'g1' });
    await actions.handle('ShowQuickPresentation', { text: 'Refrão' });
    await actions.handle('ShowQuickPresentation', { text: ' ' });
    await actions.handle('ShowQuickPresentation', { text: 'Refrão' });
    expect(calls).toEqual(['part g1 1', 'clear', 'part g1 1']);
    expect(now.at(-2)).toEqual(['Bom Perfume', null]);
  });
  test('letra editada no meio: relê e acha o texto novo', async () => {
    await actions.handle('ShowLyrics', { id: 'g1' });
    lyricsByGuid.g1 = { sections: [{ type: 'verse', text: 'Verso editado' }] };
    await actions.handle('ShowQuickPresentation', { text: 'Verso editado' });
    expect(calls).toEqual(['part g1 0']);
  });
  test('texto que não existe na música vira texto livre, com aviso', async () => {
    await actions.handle('ShowLyrics', { id: 'g1' });
    await actions.handle('ShowQuickPresentation', { text: 'Outra letra' });
    expect(calls).toEqual(['text Outra letra']);
    expect(logs.at(-1)?.[0]).toBe('warn');
  });
  test('texto sem música aberta vira texto livre', async () => {
    await actions.handle('ShowQuickPresentation', { text: 'Solto' });
    expect(calls).toEqual(['text Solto']);
  });
  test('CloseCurrentPresentation apaga e esquece a música', async () => {
    await actions.handle('ShowLyrics', { id: 'g1' });
    await actions.handle('CloseCurrentPresentation', {});
    await actions.handle('ShowQuickPresentation', { text: 'Refrão' });
    expect(calls).toEqual(['clear', 'text Refrão']);
    expect(now).toContainEqual([null, null]);
  });
  test('ShowLyrics de música inexistente é erro', async () => {
    await expect(actions.handle('ShowLyrics', { id: 'nao-existe' })).rejects.toThrow('música não encontrada: nao-existe');
  });
  test('ação desconhecida responde sem dados e registra aviso', async () => {
    expect(await actions.handle('ActionNext', {})).toBeUndefined();
    expect(logs.at(-1)).toEqual(['warn', 'ação não suportada: ActionNext']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test tests/compat-actions.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `src/compat/actions.ts`**

```ts
// As ações que o CMElite chama, implementadas sobre interfaces injetadas (testáveis sem o Spresenter).
import { findPartIndex } from './match';
import { isBlank } from './normalize';
import { pickFields, searchSongs, toSongSummary, type SongRef } from './search';
import { buildSlides, type CompatSlide, type LyricsLike } from './slides';

export interface SongStore {
  listSongs(): Promise<SongRef[]>;
  getSong(guid: string): Promise<SongRef | null>;
  getLyrics(guid: string): Promise<LyricsLike | null>;
}

export interface Projector {
  showPart(guid: string, index: number): Promise<void>;
  clearLyrics(): Promise<void>;
  showText(text: string): Promise<void>;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface ActionDeps {
  songs: SongStore;
  projector: Projector;
  log(level: LogLevel, message: string): void;
  onNowPlaying(title: string | null, part: string | null): void;
}

interface Current {
  guid: string;
  title: string;
  slides: CompatSlide[];
  index: number | null;
  onAir: boolean;
}

export class CompatActions {
  private current: Current | null = null;

  constructor(private deps: ActionDeps) {}

  async handle(action: string, body: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      case 'SearchLyrics':
        return this.search(body);
      case 'GetLyrics':
        return this.getLyrics(body);
      case 'ShowLyrics':
        return this.showLyrics(body);
      case 'ShowQuickPresentation':
        return this.showText(body);
      case 'CloseCurrentPresentation':
        return this.close();
      default:
        this.deps.log('warn', `ação não suportada: ${action}`);
        return undefined;
    }
  }

  private async search(body: Record<string, unknown>): Promise<unknown> {
    const text = String(body.text ?? body.input ?? '');
    const found = searchSongs(await this.deps.songs.listSongs(), text);
    this.deps.log('info', `busca "${text.trim()}" → ${found.length} resultado(s)`);
    return found.map((s) => pickFields(toSongSummary(s), body.fields));
  }

  private async load(guid: string): Promise<{ song: SongRef; slides: CompatSlide[] } | null> {
    if (!guid) return null;
    const song = await this.deps.songs.getSong(guid);
    if (!song) return null;
    return { song, slides: buildSlides(await this.deps.songs.getLyrics(guid)) };
  }

  private async getLyrics(body: Record<string, unknown>): Promise<unknown> {
    const loaded = await this.load(String(body.id ?? ''));
    if (!loaded) return null;
    return pickFields({ ...toSongSummary(loaded.song), slides: loaded.slides }, body.fields);
  }

  private async showLyrics(body: Record<string, unknown>): Promise<unknown> {
    const guid = String(body.id ?? '');
    const loaded = await this.load(guid);
    if (!loaded) throw new Error(`música não encontrada: ${guid}`);
    this.current = { guid, title: loaded.song.title, slides: loaded.slides, index: null, onAir: false };
    this.deps.log('info', `música aberta: ${loaded.song.title}`);
    this.deps.onNowPlaying(loaded.song.title, null);
    return undefined;
  }

  private async showText(body: Record<string, unknown>): Promise<unknown> {
    const text = String(body.text ?? '');
    const cur = this.current;
    if (isBlank(text)) {
      await this.deps.projector.clearLyrics();
      if (cur) cur.onAir = false;
      this.deps.onNowPlaying(cur ? cur.title : null, null);
      return undefined;
    }
    if (!cur) {
      await this.deps.projector.showText(text);
      this.deps.log('warn', 'texto recebido sem música aberta; exibido como texto livre');
      return undefined;
    }
    let idx = findPartIndex(cur.slides, text, cur.index);
    if (idx < 0) {
      const fresh = await this.load(cur.guid);
      if (fresh) {
        cur.slides = fresh.slides;
        idx = findPartIndex(cur.slides, text, cur.index);
      }
    }
    if (idx < 0) {
      await this.deps.projector.showText(text);
      cur.onAir = false;
      this.deps.log('warn', `texto não encontrado em "${cur.title}"; exibido como texto livre`);
      this.deps.onNowPlaying(cur.title, null);
      return undefined;
    }
    if (idx === cur.index && cur.onAir) return undefined;
    await this.deps.projector.showPart(cur.guid, idx);
    cur.index = idx;
    cur.onAir = true;
    const part = cur.slides[idx].slide_description || `parte ${idx + 1}`;
    this.deps.log('info', `${part} no ar`);
    this.deps.onNowPlaying(cur.title, part);
    return undefined;
  }

  private async close(): Promise<unknown> {
    await this.deps.projector.clearLyrics();
    this.current = null;
    this.deps.log('info', 'letra encerrada');
    this.deps.onNowPlaying(null, null);
    return undefined;
  }
}
```

- [ ] **Step 4: Rodar**

Run: `bun test tests/compat-actions.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/compat/actions.ts tests/compat-actions.test.ts
git commit -m "feat: ações compatíveis do plugin (busca, letra, passagem das partes)"
```

---

### Task 6: Autenticação da ponte

**Files:**
- Create: `bridge/auth.ts`, `tests/bridge-auth.test.ts`

**Interfaces:**
- Produces:
  - `dtokenFor(nonce: string, rid: number | string, token: string, data: string): string`
  - `interface AuthParams { sid: string | null; rid: string | null; dtoken: string | null; token: string | null }`
  - `type AuthVerdict = { kind: 'challenge'; sid: string; nonce: string } | { kind: 'ok' } | { kind: 'fail'; reason: string }`
  - `class AuthSessions { constructor(opts?: { now?: () => number; ttlMs?: number; random?: (bytes: number) => string }); verify(action: string, p: AuthParams, body: string, accessToken: string): AuthVerdict }`

- [ ] **Step 1: Escrever o teste**

`tests/bridge-auth.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { AuthSessions, dtokenFor, type AuthParams } from '../bridge/auth';

const none: AuthParams = { sid: null, rid: null, dtoken: null, token: null };

describe('dtokenFor', () => {
  test('gabaritos da spec', () => {
    expect(dtokenFor('1a2b3c', 4, 'abcdef', '{}')).toBe('f3391f69cbe03940bd0d4a63ee191092aab2f3573f56b410a9cf94da05d4cdb5');
    expect(dtokenFor('1a2b3c', 5, 'abcdef', '{"text": "Example", "show": true, "display_ahead": true}')).toBe(
      '02a7789759694c535cd032489bf101110837c972d76cec51c7ad7e797696749d',
    );
    expect(dtokenFor('b58ba4f605bed27c40a20be53ee3cf3d', 0, '1234', 'auth')).toBe('7a34b2de74f096ea79ca1e2fca28a99995805c6b002cc20949b7ea236dd5922f');
  });
  test('corpo com acentos é assinado em UTF-8', () => {
    expect(dtokenFor('1a2b3c', 7, 'abcdef', '{"text":"[Refrão] Pré-refrão — linha"}')).toBe(
      '7725e976f90e7e53a3c28296af86ec6d96819afa79ed0db4e698491203da47b6',
    );
  });
});

function handshake(auth: AuthSessions, token: string) {
  const c = auth.verify('Auth', none, '', token);
  if (c.kind !== 'challenge') throw new Error('esperava desafio');
  const ok = auth.verify('Auth', { sid: c.sid, rid: '0', dtoken: dtokenFor(c.nonce, 0, token, 'auth'), token: null }, '', token);
  return { sid: c.sid, nonce: c.nonce, ok };
}
const call = (auth: AuthSessions, s: { sid: string; nonce: string }, rid: number, body: string) =>
  auth.verify('SearchLyrics', { sid: s.sid, rid: String(rid), dtoken: dtokenFor(s.nonce, rid, 'segredo', body), token: null }, body, 'segredo');

describe('AuthSessions', () => {
  test('fluxo completo como o CMElite', () => {
    const auth = new AuthSessions();
    const s = handshake(auth, 'segredo');
    expect(s.ok).toEqual({ kind: 'ok' });
    expect(call(auth, s, 1, '')).toEqual({ kind: 'ok' });
    expect(call(auth, s, 2, '{"text":"Refrão"}')).toEqual({ kind: 'ok' });
  });
  test('token errado no Auth é recusado', () => {
    const auth = new AuthSessions();
    const c = auth.verify('Auth', none, '', 'segredo');
    if (c.kind !== 'challenge') throw new Error('esperava desafio');
    expect(auth.verify('Auth', { sid: c.sid, rid: '0', dtoken: dtokenFor(c.nonce, 0, 'errado', 'auth'), token: null }, '', 'segredo')).toEqual({
      kind: 'fail',
      reason: 'invalid token',
    });
  });
  test('rid repetido ou menor é recusado', () => {
    const auth = new AuthSessions();
    const s = handshake(auth, 'segredo');
    expect(call(auth, s, 5, '')).toEqual({ kind: 'ok' });
    expect(call(auth, s, 5, '')).toEqual({ kind: 'fail', reason: 'invalid rid' });
    expect(call(auth, s, 3, '')).toEqual({ kind: 'fail', reason: 'invalid rid' });
  });
  test('corpo adulterado é recusado', () => {
    const auth = new AuthSessions();
    const s = handshake(auth, 'segredo');
    const assinado = dtokenFor(s.nonce, 1, 'segredo', '{"text":"a"}');
    expect(auth.verify('ShowQuickPresentation', { sid: s.sid, rid: '1', dtoken: assinado, token: null }, '{"text":"b"}', 'segredo')).toEqual({
      kind: 'fail',
      reason: 'invalid token',
    });
  });
  test('novo login com sessão antiga viva funciona, e as duas seguem independentes', () => {
    const auth = new AuthSessions();
    const a = handshake(auth, 'segredo');
    const b = handshake(auth, 'segredo');
    expect(a.sid).not.toBe(b.sid);
    expect(call(auth, b, 1, '')).toEqual({ kind: 'ok' });
    expect(call(auth, a, 1, '')).toEqual({ kind: 'ok' });
  });
  test('sessão sem login completo não pode chamar ações', () => {
    const auth = new AuthSessions();
    const c = auth.verify('Auth', none, '', 'segredo');
    if (c.kind !== 'challenge') throw new Error('esperava desafio');
    expect(call(auth, c, 1, '')).toEqual({ kind: 'fail', reason: 'unauthorized' });
  });
  test('sessão expira após o tempo sem uso', () => {
    let t = 0;
    const auth = new AuthSessions({ now: () => t, ttlMs: 1000 });
    const s = handshake(auth, 'segredo');
    t = 1001;
    expect(call(auth, s, 1, '')).toEqual({ kind: 'fail', reason: 'invalid session' });
  });
  test('modo simples com ?token=', () => {
    const auth = new AuthSessions();
    expect(auth.verify('SearchLyrics', { ...none, token: 'segredo' }, '', 'segredo')).toEqual({ kind: 'ok' });
    expect(auth.verify('SearchLyrics', { ...none, token: 'outro' }, '', 'segredo')).toEqual({ kind: 'fail', reason: 'invalid token' });
  });
  test('ação sem credencial é recusada; sem token configurado nada passa', () => {
    const auth = new AuthSessions();
    expect(auth.verify('SearchLyrics', none, '', 'segredo')).toEqual({ kind: 'fail', reason: 'unauthorized' });
    expect(auth.verify('Auth', none, '', '')).toEqual({ kind: 'fail', reason: 'token não configurado' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test tests/bridge-auth.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `bridge/auth.ts`**

```ts
// Autenticação da API de letras compatível: desafio (nonce) + hash por chamada, com rid crescente.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function dtokenFor(nonce: string, rid: number | string, token: string, data: string): string {
  return createHash('sha256').update(`${nonce}:${rid}:${token}:${data}`, 'utf8').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface AuthParams {
  sid: string | null;
  rid: string | null;
  dtoken: string | null;
  token: string | null;
}

export type AuthVerdict = { kind: 'challenge'; sid: string; nonce: string } | { kind: 'ok' } | { kind: 'fail'; reason: string };

interface Session {
  nonce: string;
  authenticated: boolean;
  lastRid: number;
  lastUsed: number;
}

const TWELVE_HOURS = 12 * 60 * 60 * 1000;

export class AuthSessions {
  private sessions = new Map<string, Session>();

  constructor(private opts: { now?: () => number; ttlMs?: number; random?: (bytes: number) => string } = {}) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private random(bytes: number): string {
    return this.opts.random ? this.opts.random(bytes) : randomBytes(bytes).toString('hex');
  }

  private prune(): void {
    const ttl = this.opts.ttlMs ?? TWELVE_HOURS;
    const t = this.now();
    for (const [sid, s] of this.sessions) if (t - s.lastUsed > ttl) this.sessions.delete(sid);
  }

  verify(action: string, p: AuthParams, body: string, accessToken: string): AuthVerdict {
    if (!accessToken) return { kind: 'fail', reason: 'token não configurado' };
    this.prune();

    if (p.token !== null) return safeEqual(p.token, accessToken) ? { kind: 'ok' } : { kind: 'fail', reason: 'invalid token' };

    if (p.sid === null && p.dtoken === null) {
      if (action !== 'Auth') return { kind: 'fail', reason: 'unauthorized' };
      const sid = this.random(6);
      const nonce = this.random(16);
      this.sessions.set(sid, { nonce, authenticated: false, lastRid: -1, lastUsed: this.now() });
      return { kind: 'challenge', sid, nonce };
    }

    const s = p.sid !== null ? this.sessions.get(p.sid) : undefined;
    if (!s) return { kind: 'fail', reason: 'invalid session' };
    const rid = Number(p.rid);
    if (!Number.isInteger(rid) || rid < 0 || !p.dtoken) return { kind: 'fail', reason: 'unauthorized' };

    if (action === 'Auth') {
      if (rid !== 0 || !safeEqual(p.dtoken, dtokenFor(s.nonce, 0, accessToken, 'auth'))) return { kind: 'fail', reason: 'invalid token' };
      s.authenticated = true;
      s.lastRid = 0;
      s.lastUsed = this.now();
      return { kind: 'ok' };
    }

    if (!s.authenticated) return { kind: 'fail', reason: 'unauthorized' };
    if (rid <= s.lastRid) return { kind: 'fail', reason: 'invalid rid' };
    if (!safeEqual(p.dtoken, dtokenFor(s.nonce, rid, accessToken, body))) return { kind: 'fail', reason: 'invalid token' };
    s.lastRid = rid;
    s.lastUsed = this.now();
    return { kind: 'ok' };
  }
}
```

- [ ] **Step 4: Rodar**

Run: `bun test tests/bridge-auth.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bridge/auth.ts tests/bridge-auth.test.ts
git commit -m "feat(ponte): autenticação por desafio e hash com rid crescente"
```

---

### Task 7: Tradução HTTP do CMElite na ponte

**Files:**
- Create: `bridge/compat-http.ts`, `tests/bridge-http.test.ts`

**Interfaces:**
- Consumes: `AuthSessions`, `dtokenFor` (Task 6); `COMPAT_VERSION`, `PLUGIN_ACTIONS`, `ClientEventKind` (Task 2)
- Produces:
  - `type ForwardResult = { ok: true; data?: unknown } | { ok: false; error: string }`
  - `interface HttpDeps { auth: AuthSessions; getToken(): string; forward(action: string, body: Record<string, unknown>): Promise<ForwardResult>; onEvent(e: { kind: ClientEventKind; remote: string; action?: string }): void }`
  - `handleCompatRequest(req: Request, remote: string, deps: HttpDeps): Promise<Response>`

- [ ] **Step 1: Escrever o teste**

`tests/bridge-http.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { AuthSessions, dtokenFor } from '../bridge/auth';
import { handleCompatRequest, type ForwardResult, type HttpDeps } from '../bridge/compat-http';

let events: Array<{ kind: string; action?: string }>;
let forwarded: Array<{ action: string; body: Record<string, unknown> }>;
let reply: ForwardResult;
let deps: HttpDeps;

beforeEach(() => {
  events = [];
  forwarded = [];
  reply = { ok: true };
  deps = {
    auth: new AuthSessions(),
    getToken: () => 'segredo',
    forward: async (action, body) => {
      forwarded.push({ action, body });
      return reply;
    },
    onEvent: (e) => events.push({ kind: e.kind, action: e.action }),
  };
});

const post = (path: string, body = '') =>
  handleCompatRequest(new Request(`http://ponte${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }), '10.0.0.5', deps);

async function login() {
  const c = (await (await post('/api/Auth')).json()) as { data: { sid: string; nonce: string } };
  const { sid, nonce } = c.data;
  const r = await post(`/api/Auth?sid=${sid}&rid=0&dtoken=${dtokenFor(nonce, 0, 'segredo', 'auth')}`);
  let rid = 0;
  const call = (action: string, body = '') => {
    rid += 1;
    return post(`/api/${action}?sid=${sid}&rid=${rid}&dtoken=${dtokenFor(nonce, rid, 'segredo', body)}`, body);
  };
  return { r, call };
}

describe('handleCompatRequest', () => {
  test('login em duas etapas e evento auth-ok', async () => {
    const { r } = await login();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: 'ok' });
    expect(events).toEqual([{ kind: 'auth-ok', action: undefined }]);
  });
  test('GetTokenInfo é respondido pela ponte', async () => {
    const { call } = await login();
    expect(await (await call('GetTokenInfo')).json()).toEqual({
      status: 'ok',
      data: { version: '2.25.0', permissions: 'SearchLyrics,GetLyrics,ShowLyrics,ShowQuickPresentation,CloseCurrentPresentation,GetTokenInfo' },
    });
    expect(forwarded).toEqual([]);
  });
  test('ações vão ao plugin com o corpo já interpretado', async () => {
    const { call } = await login();
    reply = { ok: true, data: [{ id: 'g1' }] };
    const r = await call('SearchLyrics', '{"text":"Bom Perfume","fields":"id,title,artist,author"}');
    expect(await r.json()).toEqual({ status: 'ok', data: [{ id: 'g1' }] });
    expect(forwarded).toEqual([{ action: 'SearchLyrics', body: { text: 'Bom Perfume', fields: 'id,title,artist,author' } }]);
    expect(events.at(-1)).toEqual({ kind: 'request', action: 'SearchLyrics' });
  });
  test('data null é preservado; sem data responde só ok', async () => {
    const { call } = await login();
    reply = { ok: true, data: null };
    expect(await (await call('GetLyrics', '{"id":"x"}')).json()).toEqual({ status: 'ok', data: null });
    reply = { ok: true };
    expect(await (await call('CloseCurrentPresentation')).json()).toEqual({ status: 'ok' });
  });
  test('erro do plugin vira status error', async () => {
    const { call } = await login();
    reply = { ok: false, error: 'Spresenter desconectado' };
    expect(await (await call('ShowLyrics', '{"id":"g1"}')).json()).toEqual({ status: 'error', error: 'Spresenter desconectado' });
  });
  test('token errado: 401, evento auth-fail e nada vai ao plugin', async () => {
    const c = (await (await post('/api/Auth')).json()) as { data: { sid: string; nonce: string } };
    const r = await post(`/api/Auth?sid=${c.data.sid}&rid=0&dtoken=${dtokenFor(c.data.nonce, 0, 'errado', 'auth')}`);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ status: 'error', error: 'invalid token' });
    expect(events).toEqual([{ kind: 'auth-fail', action: 'Auth' }]);
    expect(forwarded).toEqual([]);
  });
  test('JSON inválido é recusado sem ir ao plugin', async () => {
    const { call } = await login();
    expect((await call('ShowLyrics', '{nao é json')).status).toBe(400);
    expect(forwarded).toEqual([]);
  });
  test('caminho fora de /api/<Ação> é 404', async () => {
    expect((await post('/outra/coisa')).status).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test tests/bridge-http.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `bridge/compat-http.ts`**

```ts
// Recebe as chamadas HTTP do CMElite (API de letras compatível) e as traduz para o plugin.
import { COMPAT_VERSION, PLUGIN_ACTIONS, type ClientEventKind } from '../src/protocol';
import type { AuthSessions } from './auth';

export type ForwardResult = { ok: true; data?: unknown } | { ok: false; error: string };

export interface HttpDeps {
  auth: AuthSessions;
  getToken(): string;
  forward(action: string, body: Record<string, unknown>): Promise<ForwardResult>;
  onEvent(e: { kind: ClientEventKind; remote: string; action?: string }): void;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export async function handleCompatRequest(req: Request, remote: string, deps: HttpDeps): Promise<Response> {
  const url = new URL(req.url);
  const match = /^\/api\/([A-Za-z0-9_]+)$/.exec(url.pathname);
  if (!match) return json(404, { status: 'error', error: 'not found' });
  const action = match[1];
  const raw = req.method === 'GET' ? '' : await req.text();
  const q = url.searchParams;

  const verdict = deps.auth.verify(action, { sid: q.get('sid'), rid: q.get('rid'), dtoken: q.get('dtoken'), token: q.get('token') }, raw, deps.getToken());
  if (verdict.kind === 'challenge') return json(200, { status: 'ok', data: { sid: verdict.sid, nonce: verdict.nonce } });
  if (verdict.kind === 'fail') {
    deps.onEvent({ kind: 'auth-fail', remote, action });
    return json(401, { status: 'error', error: verdict.reason });
  }
  if (action === 'Auth') {
    deps.onEvent({ kind: 'auth-ok', remote });
    return json(200, { status: 'ok' });
  }
  if (action === 'GetTokenInfo') {
    return json(200, { status: 'ok', data: { version: COMPAT_VERSION, permissions: [...PLUGIN_ACTIONS, 'GetTokenInfo'].join(',') } });
  }

  let body: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json(400, { status: 'error', error: 'invalid json' });
      body = parsed as Record<string, unknown>;
    } catch {
      return json(400, { status: 'error', error: 'invalid json' });
    }
  }

  deps.onEvent({ kind: 'request', remote, action });
  const result = await deps.forward(action, body);
  if (!result.ok) return json(200, { status: 'error', error: result.error });
  return json(200, 'data' in result ? { status: 'ok', data: result.data } : { status: 'ok' });
}
```

- [ ] **Step 4: Rodar**

Run: `bun test tests/bridge-http.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bridge/compat-http.ts tests/bridge-http.test.ts
git commit -m "feat(ponte): tradução das chamadas HTTP do CMElite"
```

---

### Task 8: Servidor da ponte (HTTP + WebSocket) e linha de comando

**Files:**
- Create: `bridge/plugin-link.ts`, `bridge/server.ts`, `bridge/main.ts`, `tests/helpers.ts`, `tests/bridge-server.test.ts`

**Interfaces:**
- Consumes: `AuthSessions` (Task 6); `handleCompatRequest`, `ForwardResult`, `HttpDeps` (Task 7); `validateConfig`, `encode`, `decodePluginMessage`, `CALL_TIMEOUT_MS`, `WS_PORT`, tipos (Task 2)
- Produces:
  - `class PluginLink { constructor(opts: { timeoutMs: number }); readonly connected: boolean; attach(s: Sock): void; detach(s: Sock): void; send(msg: BridgeToPlugin): void; call(action: string, body: Record<string, unknown>): Promise<ForwardResult>; handleMessage(from: Sock, raw: string): PluginToBridge | null }` com `interface Sock { send(data: string): unknown; close(): void }`
  - `lanAddresses(): string[]`
  - `interface BridgeOptions { wsPort: number; httpHost?: string; timeoutMs?: number; log?: (line: string) => void }`
  - `interface RunningBridge { readonly wsPort: number; readonly httpPort: number | null; stop(): void }`
  - `startBridge(opts: BridgeOptions): RunningBridge`
  - `BRIDGE_VERSION = '0.1.0'` (em `bridge/main.ts`)

- [ ] **Step 1: Escrever os helpers de teste**

`tests/helpers.ts`:

```ts
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
```

- [ ] **Step 2: Escrever o teste de integração**

`tests/bridge-server.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { startBridge, type RunningBridge } from '../bridge/server';
import { FakeCmelite, FakePlugin, freePort } from './helpers';

let bridge: RunningBridge | null = null;
let plugin: FakePlugin | null = null;

afterEach(() => {
  plugin?.close();
  plugin = null;
  bridge?.stop();
  bridge = null;
});

async function setup(opts: { timeoutMs?: number } = {}) {
  bridge = startBridge({ wsPort: 0, httpHost: '127.0.0.1', timeoutMs: opts.timeoutMs, log: () => {} });
  plugin = await FakePlugin.connect(bridge.wsPort);
  const port = await freePort();
  plugin.send({ type: 'hello', version: 'teste' });
  plugin.send({ type: 'config', port, token: 'segredo' });
  const status = await plugin.next('status');
  return { port, status, cmelite: new FakeCmelite(`http://127.0.0.1:${port}`, 'segredo') };
}

describe('ponte', () => {
  test('sequência real do CMElite chega ao plugin, na ordem', async () => {
    const { status, cmelite } = await setup();
    expect(status).toMatchObject({ type: 'status', listening: true });
    plugin!.onCall = (action) => {
      if (action === 'SearchLyrics') return [{ id: 'g1', title: 'Bom Perfume', artist: 'Gabi Sampaio', author: 'Gabi Sampaio' }];
      if (action === 'GetLyrics') return { slides: [{ number: 1, text: 'Refrão', slide_description: 'Refrão', background_id: '' }] };
      return undefined;
    };
    expect(await (await cmelite.login()).json()).toEqual({ status: 'ok' });
    expect((await cmelite.call('GetTokenInfo')).json.status).toBe('ok');
    expect((await cmelite.call('SearchLyrics', { text: 'Bom Perfume', fields: 'id,title,artist,author' })).json.data[0].id).toBe('g1');
    expect((await cmelite.call('GetLyrics', { id: 'g1', fields: 'slides' })).json.data.slides).toHaveLength(1);
    expect((await cmelite.call('ShowLyrics', { id: 'g1' })).json).toEqual({ status: 'ok' });
    expect((await cmelite.call('ShowQuickPresentation', { text: 'Refrão' })).json).toEqual({ status: 'ok' });
    expect((await cmelite.call('ShowQuickPresentation', { text: ' ' })).json).toEqual({ status: 'ok' });
    expect((await cmelite.call('CloseCurrentPresentation')).json).toEqual({ status: 'ok' });
    expect(plugin!.calls.map((c) => c.action)).toEqual([
      'SearchLyrics', 'GetLyrics', 'ShowLyrics', 'ShowQuickPresentation', 'ShowQuickPresentation', 'CloseCurrentPresentation',
    ]);
    expect(await plugin!.next('event')).toMatchObject({ kind: 'auth-ok' });
  });

  test('plugin desconectado: CMElite recebe erro na hora', async () => {
    const { cmelite } = await setup();
    await cmelite.login();
    plugin!.close();
    plugin = null;
    await Bun.sleep(100);
    expect((await cmelite.call('ShowLyrics', { id: 'g1' })).json).toEqual({ status: 'error', error: 'Spresenter desconectado' });
  });

  test('plugin lento: erro de tempo esgotado', async () => {
    const { cmelite } = await setup({ timeoutMs: 200 });
    plugin!.onCall = () => Bun.sleep(1000);
    await cmelite.login();
    expect((await cmelite.call('ShowLyrics', { id: 'g1' })).json).toEqual({ status: 'error', error: 'tempo esgotado' });
  });

  test('token errado gera evento auth-fail para o plugin', async () => {
    const { port } = await setup();
    const intruso = new FakeCmelite(`http://127.0.0.1:${port}`, 'errado');
    expect((await intruso.login()).status).toBe(401);
    expect(await plugin!.next('event')).toMatchObject({ kind: 'auth-fail', action: 'Auth' });
  });

  test('porta já ocupada: status com erro, ponte continua viva e aceita outra porta', async () => {
    const ocupada = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('outro') });
    bridge = startBridge({ wsPort: 0, httpHost: '127.0.0.1', log: () => {} });
    plugin = await FakePlugin.connect(bridge.wsPort);
    plugin.send({ type: 'config', port: ocupada.port, token: 'segredo' });
    const status = await plugin.next('status');
    ocupada.stop(true);
    expect(status).toMatchObject({ listening: false, port: ocupada.port });
    expect(status.error).toContain(`porta ${ocupada.port} indisponível`);
    const livre = await freePort();
    plugin.send({ type: 'config', port: livre, token: 'segredo' });
    expect(await plugin.next('status')).toMatchObject({ listening: true, port: livre });
  });

  test('config com token vazio não abre a porta', async () => {
    bridge = startBridge({ wsPort: 0, httpHost: '127.0.0.1', log: () => {} });
    plugin = await FakePlugin.connect(bridge.wsPort);
    plugin.send({ type: 'config', port: await freePort(), token: '  ' });
    expect(await plugin.next('status')).toMatchObject({ listening: false, error: 'token vazio: use o mesmo token do perfil no CMElite' });
    expect(bridge.httpPort).toBeNull();
  });

  test('trocar só o token mantém a porta e passa a exigir o novo token', async () => {
    const { port, cmelite } = await setup();
    plugin!.send({ type: 'config', port, token: 'novo' });
    expect(await plugin!.next('status')).toMatchObject({ listening: true, port });
    expect((await cmelite.login()).status).toBe(401);
    expect((await new FakeCmelite(`http://127.0.0.1:${port}`, 'novo').login()).status).toBe(200);
  });

  test('nova conexão do plugin substitui a anterior', async () => {
    const { cmelite } = await setup();
    const segundo = await FakePlugin.connect(bridge!.wsPort);
    segundo.onCall = () => 'do segundo';
    await cmelite.login();
    expect((await cmelite.call('SearchLyrics', { text: '' })).json).toEqual({ status: 'ok', data: 'do segundo' });
    segundo.close();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `bun test tests/bridge-server.test.ts`
Expected: FAIL — `Cannot find module '../bridge/server'`.

- [ ] **Step 4: Implementar `bridge/plugin-link.ts`**

```ts
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
```

- [ ] **Step 5: Implementar `bridge/server.ts`**

```ts
// Sobe o WebSocket local (plugin) e, quando o plugin manda a configuração, o HTTP do CMElite.
import { networkInterfaces } from 'node:os';
import { CALL_TIMEOUT_MS, validateConfig, type CompatConfig, type HttpStatus } from '../src/protocol';
import { AuthSessions } from './auth';
import { handleCompatRequest, type HttpDeps } from './compat-http';
import { PluginLink } from './plugin-link';

export interface BridgeOptions {
  wsPort: number;
  httpHost?: string;
  timeoutMs?: number;
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
        sendStatus();
      },
      message(socket, raw) {
        const msg = link.handleMessage(socket, String(raw));
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
```

- [ ] **Step 6: Rodar o teste de integração**

Run: `bun test tests/bridge-server.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 7: Implementar `bridge/main.ts`**

```ts
// Linha de comando da ponte CMElite.
import { WS_PORT } from '../src/protocol';
import { startBridge } from './server';

export const BRIDGE_VERSION = '0.1.0';

const arg = process.argv[2];

if (arg === '--version') {
  console.log(BRIDGE_VERSION);
  process.exit(0);
}

try {
  startBridge({ wsPort: WS_PORT });
  console.log(`[ponte] v${BRIDGE_VERSION} aguardando o plugin do Spresenter em 127.0.0.1:${WS_PORT}`);
} catch (e) {
  console.error(`[ponte] não consegui abrir 127.0.0.1:${WS_PORT} (já existe uma ponte rodando?): ${(e as Error).message}`);
  process.exit(1);
}
```

- [ ] **Step 8: Conferir a linha de comando**

```bash
npm pkg set scripts.bridge:dev="bun bridge/main.ts"
bun bridge/main.ts --version
```

Expected: `0.1.0`. Depois rode `bun bridge/main.ts` em segundo plano, confira `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8092/` → `426`, e pare o processo.

- [ ] **Step 9: Rodar tudo e commitar**

Run: `bun test && npm run typecheck`
Expected: PASS.

```bash
git add bridge/plugin-link.ts bridge/server.ts bridge/main.ts tests/helpers.ts tests/bridge-server.test.ts package.json
git commit -m "feat(ponte): servidores HTTP e WebSocket, ligação com o plugin"
```

---

### Task 9: Peças do plugin (músicas, projeção, conexão, avisos)

**Files:**
- Create: `src/songs.ts`, `src/projector.ts`, `src/bridge-client.ts`, `src/alerts.ts`
- Create: `tests/plugin-songs.test.ts`, `tests/plugin-projector.test.ts`, `tests/plugin-bridge-client.test.ts`, `tests/plugin-alerts.test.ts`

**Interfaces:**
- Consumes: `SongStore`, `Projector` (Task 5); `SongRef` (Task 3); `LyricsLike` (Task 4); `encode`, `decodeBridgeMessage`, tipos (Task 2); decisões D1, D3, D4, D5, D7 (Task 1)
- Produces:
  - `MUSIC_TYPE: string`; `interface AssetsApi`; `createSongStore(assets: AssetsApi): SongStore`
  - `interface ProjectorConfig { layer: number; perOutput: boolean; blankMode: 'clear' | 'hide' }`; `PROJECTOR_CONFIG`; `interface ProjectorApi`; `textPresentation(text: string): unknown`; `createProjector(api: ProjectorApi, cfg?: ProjectorConfig): Projector`
  - `interface NetApi`; `interface Timers`; `type LinkStatus = 'connected' | 'disconnected'`; `class BridgeClient { constructor(opts: BridgeClientOptions); readonly connected: boolean; start(): void; send(msg: PluginToBridge): void }`
  - `interface AlertInput { id: string; title: string; body: string; level: 'warning' }`; `class Alerts { constructor(publish: (n: AlertInput) => void, now?: () => number); bridgeUp(): void; bridgeDown(): void; tokenRejected(remote: string): void }`

- [ ] **Step 1: Escrever os testes**

`tests/plugin-songs.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { createSongStore } from '../src/songs';

const assets = {
  list: async (f?: { type?: string }) => {
    expect(f).toEqual({ type: 'music' });
    return [{ guid: 'g1', type: 'music', title: 'Bom Perfume', author: 'Gabi Sampaio' }, { guid: 'g2', type: 'music' }];
  },
  get: async (guid: string) =>
    guid === 'g1' ? { guid: 'g1', type: 'music', title: 'Bom Perfume', author: 'Gabi Sampaio' } : guid === 'img' ? { guid: 'img', type: 'image', title: 'Foto' } : null,
  getLyrics: async (guid: string) => (guid === 'g1' ? { lyrics: ['a'], sections: [{ text: 'a' }], groups: [] } : null),
};

test('lista só músicas e preenche título/artista ausentes com vazio', async () => {
  expect(await createSongStore(assets).listSongs()).toEqual([
    { guid: 'g1', title: 'Bom Perfume', artist: 'Gabi Sampaio' },
    { guid: 'g2', title: '', artist: '' },
  ]);
});

test('getSong ignora o que não é música', async () => {
  const s = createSongStore(assets);
  expect(await s.getSong('g1')).toEqual({ guid: 'g1', title: 'Bom Perfume', artist: 'Gabi Sampaio' });
  expect(await s.getSong('img')).toBeNull();
  expect(await s.getSong('')).toBeNull();
});

test('getLyrics repassa a letra', async () => {
  expect(await createSongStore(assets).getLyrics('g1')).toEqual({ lyrics: ['a'], sections: [{ text: 'a' }], groups: [] });
});
```

Se D1 apontou outro tipo que não `music`, troque `'music'` neste teste pelo valor de D1.

`tests/plugin-projector.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { createProjector, textPresentation, type ProjectorApi, type ProjectorConfig } from '../src/projector';

function fakeApi() {
  const calls: string[] = [];
  const api: ProjectorApi = {
    outputs: { list: async () => [{ index: 0, disabledLayers: [] }, { index: 1, disabledLayers: [2] }, { index: 2, disabledLayers: [] }] },
    live: {
      setMusicVerse: async (o, l, g, i) => {
        calls.push(`verse ${o} ${l} ${g} ${i}`);
      },
      clear: async (o, l) => {
        calls.push(`clear ${o} ${l}`);
      },
      setState: async (o, l, p) => {
        calls.push(`state ${o} ${l} ${JSON.stringify(p)}`);
        return {};
      },
      apply: async (o, l) => {
        calls.push(`apply ${o} ${l}`);
      },
    },
  };
  return { api, calls };
}
const cfg = (c: Partial<ProjectorConfig>): ProjectorConfig => ({ layer: 2, perOutput: false, blankMode: 'clear', ...c });

describe('projector', () => {
  test('uma chamada na primeira saída quando o Spresenter já espalha para as saídas', async () => {
    const { api, calls } = fakeApi();
    await createProjector(api, cfg({})).showPart('g1', 3);
    expect(calls).toEqual(['verse 0 2 g1 3']);
  });
  test('perOutput chama cada saída que não desativou a camada', async () => {
    const { api, calls } = fakeApi();
    await createProjector(api, cfg({ perOutput: true })).showPart('g1', 3);
    expect(calls).toEqual(['verse 0 2 g1 3', 'verse 2 2 g1 3']);
  });
  test('apagar a letra: clear, ou hide que reexibe ao mostrar a próxima parte', async () => {
    const a = fakeApi();
    await createProjector(a.api, cfg({})).clearLyrics();
    expect(a.calls).toEqual(['clear 0 2']);
    const b = fakeApi();
    const p = createProjector(b.api, cfg({ blankMode: 'hide' }));
    await p.clearLyrics();
    await p.showPart('g1', 1);
    expect(b.calls).toEqual(['state 0 2 {"show":false}', 'verse 0 2 g1 1', 'state 0 2 {"show":true}']);
  });
  test('texto livre aplica a apresentação e mostra a camada', async () => {
    const { api, calls } = fakeApi();
    await createProjector(api, cfg({})).showText('Olá');
    expect(calls).toEqual(['apply 0 2', 'state 0 2 {"show":true}']);
  });
  test('textPresentation leva o texto num elemento TEXT', () => {
    const p = textPresentation('linha 1\nlinha 2') as { asset: { type: string }; theme: { elements: Array<{ type: string; text: string }> } };
    expect(p.asset.type).toBe('presentation');
    expect(p.theme.elements[0]).toMatchObject({ type: 'TEXT', text: 'linha 1\nlinha 2' });
  });
});
```

Se D7 deu "texto livre não aparece", troque o teste `texto livre aplica a apresentação…` por:

```ts
  test('sem texto livre: showText não mexe na tela', async () => {
    const { api, calls } = fakeApi();
    await createProjector(api, cfg({})).showText('Olá');
    expect(calls).toEqual([]);
  });
```

`tests/plugin-bridge-client.test.ts`:

```ts
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
```

`tests/plugin-alerts.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { Alerts, type AlertInput } from '../src/alerts';

test('queda da ponte só avisa se ela estava conectada, uma vez por queda', () => {
  const sent: AlertInput[] = [];
  let t = 1000;
  const a = new Alerts((n) => sent.push(n), () => t);
  a.bridgeDown();
  expect(sent).toEqual([]);
  a.bridgeUp();
  a.bridgeDown();
  a.bridgeDown();
  expect(sent.map((n) => n.id)).toEqual(['cmelite-ponte-1000']);
  t = 2000;
  a.bridgeUp();
  a.bridgeDown();
  expect(sent.map((n) => n.id)).toEqual(['cmelite-ponte-1000', 'cmelite-ponte-2000']);
});

test('token recusado usa id fixo (a central não repete) e cita o endereço', () => {
  const sent: AlertInput[] = [];
  new Alerts((n) => sent.push(n)).tokenRejected('192.168.0.20');
  expect(sent[0]).toMatchObject({ id: 'cmelite-token', level: 'warning' });
  expect(sent[0].body).toContain('192.168.0.20');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test tests/plugin-songs.test.ts tests/plugin-projector.test.ts tests/plugin-bridge-client.test.ts tests/plugin-alerts.test.ts`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Implementar `src/songs.ts`**

```ts
// Adapta a biblioteca do Spresenter (SDK) para a interface SongStore.
import type { SongStore } from './compat/actions';
import type { SongRef } from './compat/search';
import type { LyricsLike } from './compat/slides';

/** Tipo de asset das músicas no Spresenter 0.3.50 (confirmado na Task 1, D1). */
export const MUSIC_TYPE = 'music';

interface AssetLike {
  guid: string;
  type?: string;
  title?: string;
  author?: string;
}

export interface AssetsApi {
  list(filters?: { type?: string }): Promise<AssetLike[]>;
  get(guid: string): Promise<AssetLike | null>;
  getLyrics(guid: string): Promise<LyricsLike | null>;
}

const toRef = (a: AssetLike): SongRef => ({ guid: a.guid, title: a.title ?? '', artist: a.author ?? '' });

export function createSongStore(assets: AssetsApi): SongStore {
  return {
    async listSongs() {
      return (await assets.list({ type: MUSIC_TYPE })).map(toRef);
    },
    async getSong(guid) {
      if (!guid) return null;
      const a = await assets.get(guid);
      return a && a.type === MUSIC_TYPE ? toRef(a) : null;
    },
    getLyrics: (guid) => assets.getLyrics(guid),
  };
}
```

- [ ] **Step 4: Implementar `src/projector.ts`**

Valores da Task 1 já aplicados: D3 → `layer: 1` ("Conteúdo"), D4 → `perOutput: false` (uma saída; chamada única igual ao clique manual), D5 → `blankMode: 'clear'`. D7 → texto livre funciona.

```ts
// Põe as partes da música no ar pelo SDK, do jeito mais próximo do clique manual.
import type { Projector } from './compat/actions';

export interface ProjectorConfig {
  layer: number;
  perOutput: boolean;
  blankMode: 'clear' | 'hide';
}

/** Valores confirmados na Task 1 (sonda no Spresenter 0.3.50, D3–D5). Ver spec §11. */
export const PROJECTOR_CONFIG: ProjectorConfig = { layer: 1, perOutput: false, blankMode: 'clear' };

export interface ProjectorApi {
  outputs: { list(): Promise<Array<{ index: number; disabledLayers?: number[] }>> };
  live: {
    setMusicVerse(output: string, layer: number, assetGuid: string, index: number): Promise<void>;
    clear(output: string, layer: number): Promise<void>;
    setState(output: string, layer: number, patch: { show: boolean }): Promise<unknown>;
    apply(output: string, layer: number, presentation: unknown): Promise<void>;
  };
}

/** Apresentação avulsa com um único texto (sem item na biblioteca). */
export function textPresentation(text: string): unknown {
  return {
    title: 'CMElite',
    asset: { type: 'presentation', guid: 'cmelite-texto-livre', title: 'CMElite' },
    theme: {
      title: 'CMElite',
      css: {},
      elements: [
        {
          id: 'texto',
          type: 'TEXT',
          text,
          x: 0,
          y: 0,
          visible: true,
          css: {
            width: '100%', height: '100%', display: 'flex', 'align-items': 'center', 'justify-content': 'center',
            'text-align': 'center', 'white-space': 'pre-line', 'font-family': 'Arial', 'font-size': '72px',
            'font-weight': '700', color: '#ffffff', padding: '0 80px',
          },
        },
      ],
    },
    props: {},
  };
}

export function createProjector(api: ProjectorApi, cfg: ProjectorConfig = PROJECTOR_CONFIG): Projector {
  const targets = async (): Promise<string[]> => {
    const usable = (await api.outputs.list()).filter((o) => (o.disabledLayers ?? []).indexOf(cfg.layer) < 0);
    const chosen = cfg.perOutput ? usable : usable.slice(0, 1);
    return chosen.length > 0 ? chosen.map((o) => String(o.index)) : ['0'];
  };
  return {
    async showPart(guid, index) {
      for (const o of await targets()) {
        await api.live.setMusicVerse(o, cfg.layer, guid, index);
        if (cfg.blankMode === 'hide') await api.live.setState(o, cfg.layer, { show: true });
      }
    },
    async clearLyrics() {
      for (const o of await targets()) {
        if (cfg.blankMode === 'hide') await api.live.setState(o, cfg.layer, { show: false });
        else await api.live.clear(o, cfg.layer);
      }
    },
    async showText(text) {
      for (const o of await targets()) {
        await api.live.apply(o, cfg.layer, textPresentation(text));
        await api.live.setState(o, cfg.layer, { show: true });
      }
    },
  };
}
```

Se D7 deu "texto livre não aparece", troque o corpo de `showText` por um no-op (o aviso no painel já é registrado por `CompatActions`):

```ts
    async showText() {
      // D7: o Spresenter 0.3.50 não exibiu apresentação avulsa; a tela fica como está.
    },
```

- [ ] **Step 5: Implementar `src/bridge-client.ts`**

```ts
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
```

- [ ] **Step 6: Implementar `src/alerts.ts`**

```ts
// Avisos no sino do Spresenter para os dois casos críticos durante o culto.

export interface AlertInput {
  id: string;
  title: string;
  body: string;
  level: 'warning';
}

export class Alerts {
  private up = false;

  constructor(private publish: (n: AlertInput) => void, private now: () => number = () => Date.now()) {}

  bridgeUp(): void {
    this.up = true;
  }

  bridgeDown(): void {
    if (!this.up) return;
    this.up = false;
    this.publish({
      id: `cmelite-ponte-${this.now()}`,
      title: 'Ponte CMElite desconectada',
      body: 'A ponte parou de responder. As letras do CMElite não vão passar até ela voltar.',
      level: 'warning',
    });
  }

  tokenRejected(remote: string): void {
    this.publish({
      id: 'cmelite-token',
      title: 'CMElite recusado',
      body: `Token inválido vindo de ${remote}. Confira se o token é o mesmo no painel CMElite e no perfil do CMElite.`,
      level: 'warning',
    });
  }
}
```

- [ ] **Step 7: Rodar**

Run: `bun test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/songs.ts src/projector.ts src/bridge-client.ts src/alerts.ts tests/plugin-songs.test.ts tests/plugin-projector.test.ts tests/plugin-bridge-client.test.ts tests/plugin-alerts.test.ts
git commit -m "feat(plugin): biblioteca, projeção, conexão com a ponte e avisos"
```

---

### Task 10: Estado do painel, mensagens da UI e entrada do plugin

**Files:**
- Create: `src/state.ts`, `src/ui-messages.ts`, `tests/plugin-state.test.ts`
- Modify: `src/code.ts` (substituir o nó de exemplo), `manifest.json` (permissões e descrição)

**Interfaces:**
- Consumes: tudo das Tasks 2, 5 e 9
- Produces:
  - `MAX_EVENTS = 20`; `interface LogEntry { at: string; level: LogLevel; message: string }`
  - `interface PanelState { bridge: LinkStatus; http: HttpStatus | null; client: { remote: string | null; lastAuthAt: string | null; lastRequestAt: string | null; authFailedAt: string | null }; now: { title: string | null; part: string | null }; config: CompatConfig; events: LogEntry[] }`
  - `class PluginState { constructor(onChange: (s: PanelState) => void, now?: () => Date); snapshot(): PanelState; setBridge(b): void; setHttp(h: HttpStatus): void; clientEvent(kind: ClientEventKind, at: string, remote: string, action?: string): void; setNow(title, part): void; setConfig(cfg: CompatConfig): void; log(level: LogLevel, message: string): void }`
  - `interface UiContext { state: PluginState; post(msg: unknown): void; saveConfig(cfg: CompatConfig): Promise<void> }`; `handleUiMessage(raw: unknown, ctx: UiContext): Promise<void>`
  - Mensagens da UI: `{type:'ui-ready'}`, `{type:'save-config', port, token}`; para a UI: `{type:'state', state: PanelState}`, `{type:'config-result', error?: string}`

- [ ] **Step 1: Escrever o teste**

`tests/plugin-state.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { MAX_EVENTS, PluginState, type PanelState } from '../src/state';
import { handleUiMessage } from '../src/ui-messages';

const clock = () => {
  let n = 0;
  return () => new Date(Date.UTC(2026, 9, 9, 18, 0, n++));
};

describe('PluginState', () => {
  test('estado inicial', () => {
    expect(new PluginState(() => {}, clock()).snapshot()).toEqual({
      bridge: 'disconnected',
      http: null,
      client: { remote: null, lastAuthAt: null, lastRequestAt: null, authFailedAt: null },
      now: { title: null, part: null },
      config: { port: 8091, token: '' },
      events: [],
    });
  });
  test('eventos: mais recente primeiro, no máximo MAX_EVENTS', () => {
    const st = new PluginState(() => {}, clock());
    for (let i = 0; i < MAX_EVENTS + 5; i++) st.log('info', `e${i}`);
    const ev = st.snapshot().events;
    expect(ev).toHaveLength(MAX_EVENTS);
    expect(ev[0].message).toBe(`e${MAX_EVENTS + 4}`);
  });
  test('ponte desconectada limpa o status HTTP e registra', () => {
    const st = new PluginState(() => {}, clock());
    st.setBridge('connected');
    st.setHttp({ listening: true, port: 8091, addresses: ['192.168.0.12'] });
    st.setBridge('disconnected');
    const s = st.snapshot();
    expect(s.http).toBeNull();
    expect(s.events.map((e) => e.message)).toEqual(['ponte desconectada', 'ponte conectada']);
  });
  test('eventos do CMElite', () => {
    const st = new PluginState(() => {}, clock());
    st.clientEvent('auth-ok', '2026-10-09T18:00:00.000Z', '10.0.0.5');
    st.clientEvent('request', '2026-10-09T18:00:05.000Z', '10.0.0.5', 'SearchLyrics');
    st.clientEvent('auth-fail', '2026-10-09T18:01:00.000Z', '10.0.0.9', 'Auth');
    expect(st.snapshot().client).toEqual({
      remote: '10.0.0.9',
      lastAuthAt: '2026-10-09T18:00:00.000Z',
      lastRequestAt: '2026-10-09T18:00:05.000Z',
      authFailedAt: '2026-10-09T18:01:00.000Z',
    });
    expect(st.snapshot().events[0]).toMatchObject({ level: 'error', message: 'CMElite recusado: token inválido (10.0.0.9)' });
  });
  test('snapshot é cópia: mexer nele não altera o estado', () => {
    const st = new PluginState(() => {}, clock());
    st.snapshot().events.push({ at: 'x', level: 'info', message: 'intruso' });
    expect(st.snapshot().events).toEqual([]);
  });
  test('cada mudança notifica com o estado completo', () => {
    const seen: PanelState[] = [];
    const st = new PluginState((s) => seen.push(s), clock());
    st.setNow('Bom Perfume', 'Refrão');
    expect(seen[seen.length - 1].now).toEqual({ title: 'Bom Perfume', part: 'Refrão' });
  });
});

describe('handleUiMessage', () => {
  function ctx() {
    const posted: unknown[] = [];
    const saved: unknown[] = [];
    const state = new PluginState(() => {}, clock());
    return {
      posted,
      saved,
      c: {
        state,
        post: (m: unknown) => posted.push(m),
        saveConfig: async (cfg: { port: number; token: string }) => {
          saved.push(cfg);
        },
      },
    };
  }
  test('painel aberto depois recebe o estado atual completo', async () => {
    const { posted, c } = ctx();
    c.state.setBridge('connected');
    c.state.setNow('Bom Perfume', 'Verso');
    await handleUiMessage({ type: 'ui-ready' }, c);
    expect(posted).toEqual([{ type: 'state', state: c.state.snapshot() }]);
  });
  test('salvar configuração válida', async () => {
    const { posted, saved, c } = ctx();
    await handleUiMessage({ type: 'save-config', port: '8091', token: ' abc ' }, c);
    expect(saved).toEqual([{ port: 8091, token: 'abc' }]);
    expect(posted).toEqual([{ type: 'config-result' }]);
  });
  test('configuração inválida não salva e devolve o erro', async () => {
    const { posted, saved, c } = ctx();
    await handleUiMessage({ type: 'save-config', port: 8091, token: '' }, c);
    expect(saved).toEqual([]);
    expect(posted).toEqual([{ type: 'config-result', error: 'token vazio: use o mesmo token do perfil no CMElite' }]);
  });
  test('mensagens desconhecidas são ignoradas', async () => {
    const { posted, c } = ctx();
    await handleUiMessage(null, c);
    await handleUiMessage({ type: 'outra' }, c);
    expect(posted).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test tests/plugin-state.test.ts`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Implementar `src/state.ts`**

```ts
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
  client: { remote: string | null; lastAuthAt: string | null; lastRequestAt: string | null; authFailedAt: string | null };
  now: { title: string | null; part: string | null };
  config: CompatConfig;
  events: LogEntry[];
}

export class PluginState {
  private s: PanelState = {
    bridge: 'disconnected',
    http: null,
    client: { remote: null, lastAuthAt: null, lastRequestAt: null, authFailedAt: null },
    now: { title: null, part: null },
    config: { port: DEFAULT_HTTP_PORT, token: '' },
    events: [],
  };

  constructor(private onChange: (s: PanelState) => void, private now: () => Date = () => new Date()) {}

  snapshot(): PanelState {
    return JSON.parse(JSON.stringify(this.s)) as PanelState;
  }

  private emit(): void {
    this.onChange(this.snapshot());
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

  clientEvent(kind: ClientEventKind, at: string, remote: string, _action?: string): void {
    const c = this.s.client;
    c.remote = remote;
    if (kind === 'auth-ok') {
      c.lastAuthAt = at;
      this.log('info', `CMElite conectado (${remote})`);
    } else if (kind === 'auth-fail') {
      c.authFailedAt = at;
      this.log('error', `CMElite recusado: token inválido (${remote})`);
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
```

- [ ] **Step 4: Implementar `src/ui-messages.ts`**

```ts
// Mensagens que o painel (iframe) manda para o plugin.
import { validateConfig, type CompatConfig } from './protocol';
import type { PluginState } from './state';

export interface UiContext {
  state: PluginState;
  post(msg: unknown): void;
  saveConfig(cfg: CompatConfig): Promise<void>;
}

export async function handleUiMessage(raw: unknown, ctx: UiContext): Promise<void> {
  if (!raw || typeof raw !== 'object') return;
  const msg = raw as { type?: unknown; port?: unknown; token?: unknown };
  if (msg.type === 'ui-ready') {
    ctx.post({ type: 'state', state: ctx.state.snapshot() });
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
```

- [ ] **Step 5: Rodar o teste**

Run: `bun test tests/plugin-state.test.ts`
Expected: PASS.

- [ ] **Step 6: Reescrever `src/code.ts`**

Substitua todo o conteúdo (o nó de exemplo `clear-layer` sai):

```ts
/// <reference types="@spresenter/plugin-sdk/code" />
// Plugin CMElite: recebe da ponte as chamadas da API de letras compatível e projeta as partes no Spresenter.
import { Alerts } from './alerts';
import { BridgeClient } from './bridge-client';
import { CompatActions } from './compat/actions';
import { createProjector } from './projector';
import { DEFAULT_HTTP_PORT, WS_PORT, type BridgeToPlugin, type CompatConfig } from './protocol';
import { createSongStore } from './songs';
import { PluginState } from './state';
import { handleUiMessage } from './ui-messages';

const RETRY_MS = 3000;
let config: CompatConfig = { port: DEFAULT_HTTP_PORT, token: '' };

const state = new PluginState((s) => spresenter.ui.postMessage({ type: 'state', state: s }));
const alerts = new Alerts((n) => {
  spresenter.notifications.publish(n).catch(() => undefined);
});
const actions = new CompatActions({
  songs: createSongStore(spresenter.assets),
  projector: createProjector(spresenter),
  log: (level, message) => state.log(level, message),
  onNowPlaying: (title, part) => state.setNow(title, part),
});

const client = new BridgeClient({
  net: spresenter.net,
  url: `ws://127.0.0.1:${WS_PORT}`,
  retryMs: RETRY_MS,
  timers: {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
  onStatus: (s) => {
    state.setBridge(s);
    if (s === 'connected') alerts.bridgeUp();
    else alerts.bridgeDown();
  },
  onReady: () => {
    client.send({ type: 'hello', version: spresenter.manifest.version });
    if (config.token) client.send({ type: 'config', port: config.port, token: config.token });
  },
  onMessage: (msg) => {
    void onBridgeMessage(msg);
  },
});

async function onBridgeMessage(msg: BridgeToPlugin): Promise<void> {
  if (msg.type === 'status') {
    state.setHttp({ listening: msg.listening, port: msg.port, addresses: msg.addresses, error: msg.error });
    return;
  }
  if (msg.type === 'event') {
    state.clientEvent(msg.kind, msg.at, msg.remote, msg.action);
    if (msg.kind === 'auth-fail') alerts.tokenRejected(msg.remote);
    return;
  }
  try {
    const data = await actions.handle(msg.action, msg.body);
    client.send(data === undefined ? { type: 'reply', id: msg.id, ok: true } : { type: 'reply', id: msg.id, ok: true, data });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    state.log('error', `${msg.action}: ${error}`);
    client.send({ type: 'reply', id: msg.id, ok: false, error });
  }
}

spresenter.ui.onmessage = (raw) => {
  void handleUiMessage(raw, {
    state,
    post: (m) => spresenter.ui.postMessage(m),
    saveConfig: async (cfg) => {
      config = cfg;
      await spresenter.storage.set('config', cfg);
      state.setConfig(cfg);
      client.send({ type: 'config', port: cfg.port, token: cfg.token });
    },
  });
};

spresenter.storage.get<CompatConfig>('config').then(
  (saved) => {
    if (saved) config = saved;
    state.setConfig(config);
    client.start();
  },
  () => client.start(),
);
```

- [ ] **Step 7: Atualizar `manifest.json`**

Troque `description`, `author` e `permissions` (mantenha os outros campos):

```json
{
  "id": "com.jaber.integracao-letras-cmelite",
  "name": "Integração Letras CMElite",
  "version": "0.3.50",
  "description": "Recebe do CMElite (REAPER) a passagem das letras e projeta as partes da música no Spresenter.",
  "author": "Rafael Jáber",
  "minAppVersion": "0.3.50",
  "sdk": "0.3.50",
  "main": "dist/code.js",
  "permissions": ["net:connect", "assets:read", "live:write", "outputs:read", "notifications:write"],
  "background": true
}
```

- [ ] **Step 8: Build, typecheck e conferência do bundle**

Run: `npm run typecheck && npm run build && bun test`
Expected: sem erros; `dist/code.js` gerado.

Run: `grep -c -E "require\(|import\(" dist/code.js`
Expected: `0` (o bundle não pode depender de módulos externos).

- [ ] **Step 9: Commit**

```bash
git add src/state.ts src/ui-messages.ts src/code.ts manifest.json tests/plugin-state.test.ts
git commit -m "feat(plugin): estado do painel, mensagens da UI e entrada do plugin"
```

---

### Task 11: Painel no Spresenter

**Files:**
- Create: `src/ui/index.html`, `src/ui/main.ts`, `src/ui/view-model.ts`, `src/ui/tsconfig.json`, `vite.ui.config.ts`, `tests/ui-view-model.test.ts`
- Modify: `tsconfig.json` (excluir `src/ui`), `package.json` (scripts `build` e `typecheck`), `manifest.json` (`ui` e `panels`)

**Interfaces:**
- Consumes: `PanelState`, `LogEntry` (Task 10); mensagens da UI (Task 10); `postMessage`/`onMessage` de `@spresenter/plugin-sdk/ui`; componentes de `@spresenter/plugin-sdk/ui-kit`
- Produces:
  - `type Dot = 'idle' | 'ok' | 'warn' | 'connecting' | 'error'`
  - `interface ViewModel { bridge: { state: Dot; detail: string }; client: { state: Dot; detail: string }; nowPlaying: string; help: string; events: Array<{ time: string; message: string; color: string }> }`
  - `ago(iso: string, nowMs: number): string`, `clock(iso: string): string`, `toViewModel(s: PanelState, nowMs: number): ViewModel`

- [ ] **Step 1: Escrever o teste do view model**

`tests/ui-view-model.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { PanelState } from '../src/state';
import { ago, clock, toViewModel } from '../src/ui/view-model';

const base = (): PanelState => ({
  bridge: 'connected',
  http: { listening: true, port: 8091, addresses: ['192.168.0.12'] },
  client: { remote: null, lastAuthAt: null, lastRequestAt: null, authFailedAt: null },
  now: { title: null, part: null },
  config: { port: 8091, token: 't' },
  events: [],
});
const T = Date.parse('2026-10-09T18:00:00.000Z');

describe('view model', () => {
  test('ponte ok mostra a porta e a frase de ajuda com o IP', () => {
    const vm = toViewModel(base(), T);
    expect(vm.bridge).toEqual({ state: 'ok', detail: 'escutando na porta 8091' });
    expect(vm.help).toBe('No CMElite, use IP 192.168.0.12 e porta 8091.');
  });
  test('ponte desconectada', () => {
    expect(toViewModel({ ...base(), bridge: 'disconnected', http: null }, T).bridge).toEqual({
      state: 'error',
      detail: 'desconectada — abra a ponte CMElite neste computador',
    });
  });
  test('ponte conectada sem porta mostra o erro', () => {
    const vm = toViewModel({ ...base(), http: { listening: false, port: 8091, addresses: [], error: 'porta 8091 indisponível: em uso' } }, T);
    expect(vm.bridge).toEqual({ state: 'warn', detail: 'porta 8091 indisponível: em uso' });
    expect(vm.help).toBe('Configure o token abaixo e salve para a ponte começar a escutar.');
  });
  test('ponte conectada aguardando configuração', () => {
    expect(toViewModel({ ...base(), http: null }, T).bridge).toEqual({ state: 'warn', detail: 'aguardando configuração' });
  });
  test('CMElite: nunca conectou, ativo, recusado', () => {
    expect(toViewModel(base(), T).client).toEqual({ state: 'idle', detail: 'ainda não conectou' });
    const ativo = { ...base(), client: { remote: '10.0.0.5', lastAuthAt: '2026-10-09T17:59:00.000Z', lastRequestAt: '2026-10-09T17:59:50.000Z', authFailedAt: null } };
    expect(toViewModel(ativo, T).client).toEqual({ state: 'ok', detail: 'última chamada há 10 s de 10.0.0.5' });
    const recusado = { ...base(), client: { remote: '10.0.0.9', lastAuthAt: '2026-10-09T17:00:00.000Z', lastRequestAt: null, authFailedAt: '2026-10-09T17:58:00.000Z' } };
    expect(toViewModel(recusado, T).client).toEqual({ state: 'error', detail: 'token recusado há 2 min (10.0.0.9)' });
  });
  test('o que está no ar', () => {
    expect(toViewModel(base(), T).nowPlaying).toBe('Nada no ar');
    expect(toViewModel({ ...base(), now: { title: 'Bom Perfume', part: null } }, T).nowPlaying).toBe('No ar: Bom Perfume (sem letra)');
    expect(toViewModel({ ...base(), now: { title: 'Bom Perfume', part: 'Refrão' } }, T).nowPlaying).toBe('No ar: Bom Perfume — Refrão');
  });
  test('ago e clock', () => {
    expect(ago('2026-10-09T17:59:55.000Z', T)).toBe('há 5 s');
    expect(ago('2026-10-09T17:30:00.000Z', T)).toBe('há 30 min');
    expect(ago('2026-10-09T15:00:00.000Z', T)).toBe('há 3 h');
    expect(clock(new Date(2026, 9, 9, 8, 5, 3).toISOString())).toBe('08:05:03');
  });
  test('eventos com hora e cor por nível', () => {
    const at = new Date(2026, 9, 9, 18, 40, 5).toISOString();
    expect(toViewModel({ ...base(), events: [{ at, level: 'error', message: 'falhou' }] }, T).events).toEqual([
      { time: '18:40:05', message: 'falhou', color: '#f31260' },
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test tests/ui-view-model.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `src/ui/view-model.ts`**

```ts
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
  const refused = c.authFailedAt !== null && (c.lastAuthAt === null || c.authFailedAt > c.lastAuthAt);
  const client: ViewModel['client'] = refused
    ? { state: 'error', detail: `token recusado ${ago(c.authFailedAt as string, nowMs)}${c.remote ? ` (${c.remote})` : ''}` }
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
```

- [ ] **Step 4: Rodar o teste**

Run: `bun test tests/ui-view-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Criar a página e o script do painel**

`src/ui/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CMElite</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`src/ui/main.ts`:

```ts
// Painel CMElite: status da ponte e do CMElite, o que está no ar, configuração e eventos.
import { onMessage, postMessage } from '@spresenter/plugin-sdk/ui';
import { Actions, Alert, Button, el, Field, Header, Hint, injectStyles, Panel, Root, Stack, StatusIndicator, TextInput } from '@spresenter/plugin-sdk/ui-kit';
import type { PanelState } from '../state';
import { toViewModel } from './view-model';

injectStyles();

const bridge = StatusIndicator({ label: 'Ponte' });
const client = StatusIndicator({ label: 'CMElite' });
const nowLine = el('div', { style: { fontWeight: '600' } });
const help = Hint('');
const port = TextInput({ type: 'number', placeholder: '8091' });
const token = TextInput({ type: 'password', placeholder: 'mesmo token do perfil no CMElite' });
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
    Panel({ label: 'Configuração', children: [Field({ label: 'Porta', control: port }), Field({ label: 'Token', control: token }), Actions(toggle, save), feedback] }),
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
  if (msg.type === 'config-result') {
    feedback.replaceChildren(Alert(msg.error ? { variant: 'error', text: msg.error } : { variant: 'success', text: 'Configuração salva.' }));
  }
});

setInterval(render, 5000);
postMessage({ type: 'ui-ready' });
```

- [ ] **Step 6: Configuração de build e typecheck do painel**

`src/ui/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["./**/*.ts"]
}
```

Em `tsconfig.json` (raiz), adicione `"exclude": ["src/ui"]` ao lado de `"include": ["src"]`.

`vite.ui.config.ts`:

```ts
import { defineConfig } from 'vite';
import { resolve } from 'path';

// Build do painel (thread de UI), exibido num iframe isolado. `base: './'` mantém os caminhos
// relativos para o app servir o build em /plugins/<id>/ui/.
export default defineConfig({
  root: resolve(__dirname, 'src/ui'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/ui'),
    emptyOutDir: true,
    target: 'es2020',
  },
});
```

```bash
npm pkg set scripts.build="vite build --config vite.code.config.ts && vite build --config vite.ui.config.ts"
npm pkg set scripts.typecheck="tsc -p tsconfig.json && tsc -p src/ui/tsconfig.json && tsc -p bridge/tsconfig.json"
```

Em `manifest.json`, adicione depois de `"main"`:

```json
  "ui": "dist/ui/index.html",
  "panels": [{ "id": "main", "title": "CMElite", "icon": "music" }],
```

- [ ] **Step 7: Build e verificação**

Run: `npm run typecheck && npm run build && bun test`
Expected: sem erros; existem `dist/code.js`, `dist/ui/index.html` e `dist/ui/assets/*.js`.

Run: `ls dist/ui dist/ui/assets`

- [ ] **Step 8: Commit**

```bash
git add src/ui vite.ui.config.ts tsconfig.json package.json manifest.json tests/ui-view-model.test.ts
git commit -m "feat(plugin): painel de status e configuração no Spresenter"
```

---

### Task 12: Distribuição da ponte e início automático

**Files:**
- Create: `bridge/autostart.ts`, `scripts/build-bridge.ts`, `tests/bridge-autostart.test.ts`
- Modify: `bridge/main.ts` (`--install`/`--uninstall`), `package.json` (`bridge:build`), `README.md` (reescrever em português)

**Interfaces:**
- Consumes: `BRIDGE_VERSION`, `startBridge` (Task 8)
- Produces:
  - `AGENT_LABEL = 'com.jaber.ponte-cmelite'`, `RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'`, `RUN_VALUE = 'PonteCMElite'`
  - `launchAgentPlist(execPath: string, logPath: string): string`
  - `windowsRunCommand(execPath: string): string[]`, `windowsRemoveCommand(): string[]`
  - `installAutostart(execPath?: string, platform?: NodeJS.Platform): string`, `uninstallAutostart(platform?: NodeJS.Platform): string`

- [ ] **Step 1: Escrever o teste**

`tests/bridge-autostart.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { AGENT_LABEL, RUN_KEY, RUN_VALUE, launchAgentPlist, windowsRemoveCommand, windowsRunCommand } from '../bridge/autostart';

describe('autostart', () => {
  test('plist do LaunchAgent', () => {
    const xml = launchAgentPlist('/Apps/Ponte & Cia/ponte-cmelite', '/Users/x/Library/Logs/ponte-cmelite.log');
    expect(xml).toContain(`<string>${AGENT_LABEL}</string>`);
    expect(xml).toContain('<string>/Apps/Ponte &amp; Cia/ponte-cmelite</string>');
    expect(xml).toContain('<key>RunAtLoad</key>\n  <true/>');
    expect(xml).toContain('<key>KeepAlive</key>\n  <true/>');
    expect(xml).toContain('<string>/Users/x/Library/Logs/ponte-cmelite.log</string>');
  });
  test('comandos do registro do Windows', () => {
    expect(windowsRunCommand('C:\\Ponte\\ponte-cmelite.exe')).toEqual(['reg', 'add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', '"C:\\Ponte\\ponte-cmelite.exe"', '/f']);
    expect(windowsRemoveCommand()).toEqual(['reg', 'delete', RUN_KEY, '/v', RUN_VALUE, '/f']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test tests/bridge-autostart.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `bridge/autostart.ts`**

```ts
// Faz a ponte iniciar sozinha no login: LaunchAgent no macOS, registro do usuário no Windows.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const AGENT_LABEL = 'com.jaber.ponte-cmelite';
export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
export const RUN_VALUE = 'PonteCMElite';

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function launchAgentPlist(execPath: string, logPath: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${AGENT_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${xml(execPath)}</string>`,
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>StandardOutPath</key>',
    `  <string>${xml(logPath)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${xml(logPath)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

export function windowsRunCommand(execPath: string): string[] {
  return ['reg', 'add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', `"${execPath}"`, '/f'];
}

export function windowsRemoveCommand(): string[] {
  return ['reg', 'delete', RUN_KEY, '/v', RUN_VALUE, '/f'];
}

const plistPath = () => join(homedir(), 'Library', 'LaunchAgents', `${AGENT_LABEL}.plist`);
const uid = () => (process.getuid ? process.getuid() : 0);

function run(cmd: string[]): void {
  const r = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`${cmd[0]} falhou: ${r.stderr.toString().trim()}`);
}

export function installAutostart(execPath: string = process.execPath, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') {
    const plist = plistPath();
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
    writeFileSync(plist, launchAgentPlist(execPath, join(homedir(), 'Library', 'Logs', 'ponte-cmelite.log')));
    Bun.spawnSync(['launchctl', 'bootout', `gui/${uid()}`, plist]);
    run(['launchctl', 'bootstrap', `gui/${uid()}`, plist]);
    return `Início automático ativado. A ponte já está rodando e vai abrir sozinha nos próximos logins (${plist}).`;
  }
  if (platform === 'win32') {
    run(windowsRunCommand(execPath));
    return 'Início automático ativado. A ponte vai abrir sozinha no próximo login; para agora, abra o executável normalmente.';
  }
  throw new Error(`sistema não suportado: ${platform}`);
}

export function uninstallAutostart(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') {
    Bun.spawnSync(['launchctl', 'bootout', `gui/${uid()}/${AGENT_LABEL}`]);
    rmSync(plistPath(), { force: true });
    return 'Início automático desativado e ponte parada.';
  }
  if (platform === 'win32') {
    run(windowsRemoveCommand());
    return 'Início automático desativado.';
  }
  throw new Error(`sistema não suportado: ${platform}`);
}
```

- [ ] **Step 4: Rodar o teste**

Run: `bun test tests/bridge-autostart.test.ts`
Expected: PASS.

- [ ] **Step 5: Ligar `--install`/`--uninstall` em `bridge/main.ts`**

Substitua o conteúdo de `bridge/main.ts`:

```ts
// Linha de comando da ponte CMElite.
import { WS_PORT } from '../src/protocol';
import { installAutostart, uninstallAutostart } from './autostart';
import { startBridge } from './server';

export const BRIDGE_VERSION = '0.1.0';

const arg = process.argv[2];

try {
  if (arg === '--version') {
    console.log(BRIDGE_VERSION);
    process.exit(0);
  }
  if (arg === '--install') {
    console.log(installAutostart());
    process.exit(0);
  }
  if (arg === '--uninstall') {
    console.log(uninstallAutostart());
    process.exit(0);
  }
} catch (e) {
  console.error(`[ponte] ${(e as Error).message}`);
  process.exit(1);
}

try {
  startBridge({ wsPort: WS_PORT });
  console.log(`[ponte] v${BRIDGE_VERSION} aguardando o plugin do Spresenter em 127.0.0.1:${WS_PORT}`);
} catch (e) {
  console.error(`[ponte] não consegui abrir 127.0.0.1:${WS_PORT} (já existe uma ponte rodando?): ${(e as Error).message}`);
  process.exit(1);
}
```

- [ ] **Step 6: Script de compilação**

`scripts/build-bridge.ts`:

```ts
// Gera os executáveis da ponte: macOS Apple Silicon, macOS Intel e Windows.
import { mkdirSync } from 'node:fs';

const targets = [
  { target: 'bun-darwin-arm64', out: 'release/ponte-cmelite-macos-arm64' },
  { target: 'bun-darwin-x64', out: 'release/ponte-cmelite-macos-x64' },
  { target: 'bun-windows-x64', out: 'release/ponte-cmelite-windows-x64.exe' },
];

mkdirSync('release', { recursive: true });
for (const t of targets) {
  const r = Bun.spawnSync(['bun', 'build', 'bridge/main.ts', '--compile', `--target=${t.target}`, `--outfile=${t.out}`], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (r.exitCode !== 0) {
    console.error(`falhou: ${t.target}`);
    process.exit(1);
  }
  console.log(`ok: ${t.out}`);
}
```

```bash
npm pkg set scripts.bridge:build="bun scripts/build-bridge.ts"
npm run bridge:build
./release/ponte-cmelite-macos-arm64 --version
```

Expected: três arquivos em `release/`; a última linha imprime `0.1.0`.

- [ ] **Step 7: Conferir o início automático no macOS (pedir ok ao usuário antes)**

Isto cria e remove um LaunchAgent na conta do usuário. Peça confirmação antes de rodar:

```bash
./release/ponte-cmelite-macos-arm64 --install
lsof -nP -iTCP:8092 -sTCP:LISTEN
./release/ponte-cmelite-macos-arm64 --uninstall
lsof -nP -iTCP:8092 -sTCP:LISTEN || echo "parada"
```

Expected: depois do `--install` há um processo escutando na 8092; depois do `--uninstall`, `parada`.

- [ ] **Step 8: Reescrever `README.md`**

```markdown
# Integração Letras CMElite

Faz o **CMElite** (controlador de multitracks no REAPER) passar as letras no **Spresenter**,
sem mudar nada no CMElite. São duas peças, as duas no computador do Spresenter:

- **Plugin CMElite** (dentro do Spresenter): busca as músicas na biblioteca e põe cada parte no ar.
- **Ponte CMElite** (programa à parte): recebe as chamadas do CMElite pela rede e entrega ao plugin.

## Instalar

1. **Plugin:** no Spresenter, *Configurações → Plugins → Instalar (.zip/pasta)* e escolha
   `release/com.jaber.integracao-letras-cmelite-<versão>.zip` (gerado com `npm run package`).
2. **Ponte:** copie o executável do seu sistema da pasta `release/`:
   - macOS Apple Silicon: `ponte-cmelite-macos-arm64`
   - macOS Intel: `ponte-cmelite-macos-x64`
   - Windows: `ponte-cmelite-windows-x64.exe`
3. Abra a ponte uma vez:
   - **macOS:** clique com o botão direito → *Abrir* (o executável não é assinado).
   - **Windows / macOS:** quando o sistema perguntar se a ponte pode receber conexões da rede,
     responda **Permitir**. Sem isso o CMElite, em outro computador, não chega até ela.
4. Para a ponte abrir sozinha no login, rode no terminal: `ponte-cmelite --install`
   (`--uninstall` desfaz).

## Configurar

1. No Spresenter, abra o painel **CMElite**.
2. Em *Configuração*, coloque a **porta** (8091) e o **mesmo token** do perfil no CMElite. Salve.
3. O painel mostra a frase "No CMElite, use IP … e porta …". Coloque esse IP e essa porta
   no perfil do CMElite e reconecte.

## Uso

Associe a música no CMElite pelo nome, como antes. Ao dar play no VS, cada seção põe a parte
correspondente no ar; seções sem letra deixam a tela sem letra; parar o VS limpa a letra.
O painel mostra o que está no ar e os últimos eventos.

## Problemas comuns

| Painel mostra | O que fazer |
|---|---|
| Ponte desconectada | Abra a ponte neste computador (ou rode `--install`). |
| Porta indisponível | Outro programa usa a porta; feche-o ou escolha outra porta (e mude no CMElite). |
| CMElite recusado: token inválido | O token do painel e o do perfil no CMElite precisam ser iguais. |
| Texto não encontrado | A letra no Spresenter mudou ou a música associada é outra; confira a música no CMElite. |

## Desenvolvimento

```bash
npm install
npm test            # testes (bun)
npm run typecheck
npm run build       # dist/code.js + dist/ui/
npm run bridge:dev  # roda a ponte a partir do código
npm run bridge:build
npm run package     # zip do plugin em release/
```

Para testar o plugin sem instalar: *Configurações → Plugins → Carregar pasta (dev)* e escolha
esta pasta.
```

- [ ] **Step 9: Rodar tudo e commitar**

Run: `bun test && npm run typecheck && npm run build && npm run package`
Expected: tudo verde; zip do plugin em `release/`.

```bash
git add bridge/autostart.ts bridge/main.ts scripts/build-bridge.ts tests/bridge-autostart.test.ts package.json README.md
git commit -m "feat(ponte): executáveis, início automático e README"
```

---

### Task 13: Aceite de ponta a ponta com o CMElite real — INTERATIVA

**Files:**
- Modify (se necessário): `src/compat/slides.ts`, `tests/compat-slides.test.ts`
- Modify: `docs/superpowers/specs/2026-10-09-ponte-cmelite-design.md` (status e achados)

- [ ] **Step 1: Preparar**

Run: `npm run build && bun test && npm run typecheck`
Expected: tudo verde.

Rode a ponte a partir do código, em segundo plano: `npm run bridge:dev`.

Peça ao usuário:
1. No Spresenter: *Configurações → Plugins → Carregar pasta (dev)* → esta pasta.
2. Abrir o painel **CMElite**, digitar a porta `8091` e o token do perfil do CMElite, e salvar.
   (Quem digita o token é o usuário.)
3. No CMElite: perfil com IP `127.0.0.1` (mesma máquina, nesta etapa) e porta `8091`; reconectar.

Expected no painel: Ponte "escutando na porta 8091"; CMElite "última chamada há …".

- [ ] **Step 2: Rodar o VS "Bom Perfume"**

A música "Bom Perfume" precisa estar na biblioteca do Spresenter. Peça ao usuário para associá-la no CMElite e dar play do começo até depois do 2º refrão (~4 min), sem clicar em nada. Acompanhe os eventos do painel. Checklist (compare com as seções do VS: Contagem, Introdução, Verso, Pré Refrão ×2, Refrão, Verso, Pré Refrão ×2, Refrão ×2, Instrumental…):

- [ ] A busca encontrou a música certa (primeiro resultado).
- [ ] Contagem: tela sem letra.
- [ ] Cada seção com letra pôs a parte certa no ar, na hora certa.
- [ ] O **2º Verso** mostrou o texto do 2º verso (não o 1º).
- [ ] Instrumental: tela sem letra, fundo como no clique manual.
- [ ] Parar o VS limpou a letra.

- [ ] **Step 3: Se o 2º Verso mostrou o texto errado ou ficou em branco**

Significa que o CMElite espera nomes numerados nas repetições ("Verso 1", "Verso 2"). Aplique a regra de numeração em `src/compat/slides.ts`, com TDD.

Teste a acrescentar em `tests/compat-slides.test.ts`:

```ts
import { numberRepeats } from '../src/compat/slides';

test('numera nomes repetidos com textos diferentes; repetição do mesmo texto mantém o número', () => {
  const s = (text: string, slide_description: string, number: number) => ({ number, text, slide_description, background_id: '' });
  expect(
    numberRepeats([s('v1', 'Verso', 1), s('r', 'Refrão', 2), s('v2', 'Verso', 3), s('r', 'Refrão', 4), s('i', 'Introdução', 5)]).map((x) => x.slide_description),
  ).toEqual(['Verso 1', 'Refrão', 'Verso 2', 'Refrão', 'Introdução']);
});
```

Implementação a acrescentar em `src/compat/slides.ts` e aplicar no retorno de `buildSlides` quando há seções (`return numberRepeats(sections.map(...))`):

```ts
/** "Verso", "Verso" (textos diferentes) → "Verso 1", "Verso 2". Mesmo nome com o mesmo texto não é numerado. */
export function numberRepeats(slides: CompatSlide[]): CompatSlide[] {
  const texts = new Map<string, string[]>();
  for (const s of slides) {
    if (!s.slide_description) continue;
    const list = texts.get(s.slide_description) ?? [];
    if (list.indexOf(s.text) < 0) list.push(s.text);
    texts.set(s.slide_description, list);
  }
  return slides.map((s) => {
    const list = texts.get(s.slide_description);
    if (!list || list.length < 2) return s;
    return { ...s, slide_description: `${s.slide_description} ${list.indexOf(s.text) + 1}` };
  });
}
```

Atualize as expectativas que mudam com a numeração:
- `tests/compat-slides.test.ts`, teste `um slide por seção…`: os dois "Verso" viram "Verso 1" e "Verso 2".
- `tests/compat-actions.test.ts`, teste `GetLyrics devolve os slides…`: `['Verso 1', 'Refrão', 'Verso 2', 'Refrão']`.
- `tests/compat-actions.test.ts`, teste `ShowLyrics só prepara…`: `now.at(-1)` passa a ser `['Bom Perfume', 'Verso 2']`.

Rode `bun test`, refaça o `npm run build`, peça ao usuário para recarregar o plugin e repita o Step 2.

- [ ] **Step 4: Falhas controladas**

- [ ] Trocar o token no painel por um errado e reconectar o CMElite → painel "CMElite recusado" e aviso no sino. Voltar o token certo.
- [ ] Parar a ponte (`Ctrl+C`) com o VS tocando → painel "Ponte desconectada" e aviso no sino. Subir de novo → reconecta sozinho em até ~3 s.

- [ ] **Step 5: Registrar e commitar**

Atualize a spec: status "implementado", e em §13 os achados do aceite (regra de numeração aplicada ou não, comportamento observado). Rode `bun test` (inclui a guarda de nomes).

```bash
git add -A docs src tests
git commit -m "test: aceite de ponta a ponta com o CMElite real"
```

Pendência para depois desta sessão (máquina do culto): repetir Steps 1–4 em Windows com `ponte-cmelite-windows-x64.exe`, com o CMElite em outro computador apontando para o IP mostrado no painel.
