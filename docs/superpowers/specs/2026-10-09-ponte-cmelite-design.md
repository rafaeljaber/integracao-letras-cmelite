# Ponte CMElite → Spresenter — Design

- **Data:** 2026-10-09
- **Status:** implementado e aceito com o CMElite real (2026-10-11)
- **Projeto:** `integracao-letras-cmelite` (plugin Spresenter + ponte)

## 1. Objetivo

O CMElite (controlador de multitracks que roda no REAPER) já passa as letras das
músicas automaticamente, conforme o andamento do VS, falando com um software de
projeção por uma API HTTP de letras. Queremos que o **Spresenter** ocupe esse
lugar: o CMElite continua falando o mesmo protocolo, e as letras passam no
Spresenter nos mesmos momentos.

**Critério de sucesso:** com o VS "Bom Perfume" tocando no CMElite e a música
"Bom Perfume" na biblioteca do Spresenter, cada seção do VS põe a parte certa no
ar na hora certa; seções sem letra (Contagem, Instrumental) deixam a tela sem
letra; parar o VS limpa a letra.

## 2. Restrições

1. **Nenhuma alteração no CMElite** — nem código nem arquivos. Só é permitido mudar,
   pela tela de ajustes dele, o IP/porta/token do perfil do servidor de letras.
2. **Sem o nome do software de projeção original** em código, nomes de arquivo,
   comentários ou textos de interface. Usar nomes neutros ("API de letras
   compatível", `compat/`). Os nomes das ações do protocolo (`SearchLyrics`,
   `ShowLyrics`…) ficam como são, pois é o CMElite que os chama.
3. **Topologia:** REAPER/CMElite e Spresenter rodam em **computadores diferentes**
   na mesma rede.
4. **Sistemas:** a máquina do Spresenter pode ser **macOS ou Windows**.
5. **Spresenter 0.3.50** instalado; o SDK em `sdk/spresenter-plugin-sdk.tgz` é o
   mesmo embutido no app (rótulo interno do pacote: 0.5.0). A API externa REST do
   Spresenter está **desligada** e não deve ser exigida.
6. Um plugin do Spresenter **não pode abrir porta** (o SDK só tem rede de saída),
   e a API REST do Spresenter só atende `/api/v1/...` (testado: `/api/ActionNext`
   → 404). Por isso existe uma **ponte** externa.

## 3. O que o CMElite faz (capturado)

Capturado com um servidor falso na porta 8091, com o CMElite real conectado.

### 3.1 Transporte

- `POST http://<IP>:<PORTA>/api/<Ação>?<auth>` com `Content-Type: application/json`.
- Resposta de sucesso: `{"status":"ok"}` ou `{"status":"ok","data":...}`.
- Resposta de erro: `{"status":"error","error":"<mensagem>"}`.

### 3.2 Autenticação (modo hash)

1. `POST /api/Auth` sem parâmetros → responder `{"status":"ok","data":{"sid":"…","nonce":"…"}}`.
2. `POST /api/Auth?sid=…&rid=0&dtoken=…` (corpo vazio) → responder `{"status":"ok"}`.
3. Demais chamadas: `?sid=…&rid=N&dtoken=…`, com `rid` crescendo de 1 em 1.

`dtoken = hex(sha256(nonce + ":" + rid + ":" + token + ":" + dados))`, onde
`dados` é a string `"auth"` no passo 2 do `Auth` e, nas demais chamadas, o
**corpo cru** da requisição (`""` quando vazio). **Confirmado com o tráfego real
do CMElite** (V1). Gabaritos:

| nonce | rid | token | dados | dtoken |
|---|---|---|---|---|
| `1a2b3c` | 4 | `abcdef` | `{}` | `f3391f69cbe03940bd0d4a63ee191092aab2f3573f56b410a9cf94da05d4cdb5` |
| `1a2b3c` | 5 | `abcdef` | `{"text": "Example", "show": true, "display_ahead": true}` | `02a7789759694c535cd032489bf101110837c972d76cec51c7ad7e797696749d` |
| `b58ba4f605bed27c40a20be53ee3cf3d` | 0 | `1234` | `auth` | `7a34b2de74f096ea79ca1e2fca28a99995805c6b002cc20949b7ea236dd5922f` |

O exemplo de `Auth` da documentação pública traz um `dtoken` que não corresponde
à fórmula; o valor da 3ª linha foi recalculado e é o que vale.

O protocolo também aceita o modo simples `?token=<token>`; a ponte aceita os dois.

### 3.3 Sequência observada

| # | Ação | Corpo | Quando |
|---|---|---|---|
| 1 | `Auth` ×2, `GetTokenInfo` | — | ao conectar |
| 2 | `SearchLyrics` | `{"text":"<nome>","fields":"id,title,artist,author"}` | ao associar a música pelo nome |
| 3 | `GetLyrics` | `{"id":"<id>","fields":"slides"}` | logo após uma busca com resultado (pega o **primeiro**) |
| 4 | `ShowLyrics` | `{"id":"<id>"}` | ao dar play |
| 5 | `ShowQuickPresentation` | `{"text":"<texto do slide>"}` ou `{"text":" "}` | a cada seção do VS |
| 6 | `CloseCurrentPresentation` | — | ao parar |

Comportamentos observados:

- Busca **sem resultado** faz o CMElite mostrar "Estrutura inesperada: data[1]
  ausente" (ele espera `data` como lista não vazia).
- O CMElite baixa todos os slides uma vez e, durante o play, **manda o texto** do
  slide, não um índice.
- Seção do VS sem slide correspondente → `{"text":" "}` (tela sem letra).
- As seções do VS de "Bom Perfume" se chamam Contagem, Introdução, Verso,
  Pré Refrão, Refrão, Instrumental, Ponte e Final.
- O casamento seção → slide parece usar o nome da seção contra o
  `slide_description` e contar repetições: o 2º "Verso" virou o slide
  "Verso 2"; "Introdução" **não** casou com um slide chamado "Intro".

## 4. Arquitetura

```
CMElite ──HTTP (API de letras compatível)──▶ Ponte ◀──WebSocket (127.0.0.1)── Plugin ──SDK──▶ Spresenter
         máquina do REAPER                    máquina do Spresenter
```

- **Ponte** (Bun, executável único): imita o servidor da API de letras, faz a
  autenticação e repassa cada chamada ao plugin. Não conhece o Spresenter.
- **Plugin** (logic thread do Spresenter, `background: true`): conecta na ponte
  como cliente WebSocket, implementa as ações com o SDK, mantém o painel.
- **Painel** (UI do plugin): status e configuração.

### 4.1 Estrutura de arquivos

```
manifest.json            permissões, painel, background
src/
  code.ts                entrada do plugin: conexão, despacho, painel
  protocol.ts            mensagens ponte ⇄ plugin (tipos compartilhados)
  compat/
    normalize.ts         normalização de texto (acento, caixa, espaços)
    search.ts            busca e ordenação de músicas
    slides.ts            letra do Spresenter → slides do protocolo
    match.ts             texto recebido → índice da parte
    actions.ts           implementação das ações sobre uma interface do SDK injetada
  ui/                    painel (componentes visuais do SDK, sem React)
bridge/
  main.ts                entrada da ponte (HTTP + WebSocket + --install/--uninstall)
  auth.ts                sessões, nonce, verificação de dtoken e rid
  autostart.ts           LaunchAgent (macOS) / chave Run do usuário (Windows)
tests/                   bun test (unitários e integração da ponte)
```

`compat/` não importa o SDK diretamente: `actions.ts` recebe um objeto com as
funções do SDK que usa, para poder ser testado com dublês.

### 4.2 Manifesto

- `permissions`: `net:connect`, `assets:read`, `live:write`, `outputs:read`,
  `notifications:write`.
- `background: true`, `main: dist/code.js`, `ui: dist/ui/index.html`.
- `panels: [{ id: "main", title: "CMElite", icon: "music" }]`.
- Remover o nó de automação de exemplo `clear-layer`.

## 5. Protocolo ponte ⇄ plugin

WebSocket em `ws://127.0.0.1:8092`, porta **fixa** (torná-la configurável só se
aparecer conflito real; ver §12). Mensagens JSON:

| Direção | Mensagem | Conteúdo |
|---|---|---|
| plugin → ponte | `hello` | versão do plugin |
| plugin → ponte | `generate-token` | pede um token novo |
| plugin → ponte | `config` | `{ port, token }` |
| plugin → ponte | `reply` | `{ id, ok: true, data? }` ou `{ id, ok: false, error }` |
| ponte → plugin | `token` | `{ token }` — 3 blocos de 4 (`K7MP-Q2XA-9RHD`), só maiúsculas e números sem 0/O e 1/I, gerador criptográfico da ponte; o CMElite fica em outro computador, então o token é lido no painel e digitado lá |
| ponte → plugin | `saved-config` | `{ port, token }` guardados pela ponte |
| ponte → plugin | `status` | `{ listening, port, addresses: string[], error? }` |
| ponte → plugin | `call` | `{ id, action, body }` |
| ponte → plugin | `event` | `{ kind: "auth-ok" \| "auth-fail" \| "request", at, remote, action? }` |

- A ponte guarda a última configuração válida num arquivo próprio
  (macOS `~/Library/Application Support/ponte-cmelite/config.json`, Windows
  `%APPDATA%\ponte-cmelite\config.json`) e, ao ligar, já abre a porta HTTP com ela.
  Reinstalar o plugin apaga o `spresenter.storage` dele; por isso, ao conectar, a ponte
  envia `saved-config` e o plugin a adota se estiver sem configuração própria.
- Sem configuração guardada, a ponte só abre a porta HTTP depois do primeiro `config`.
  A partir daí ela fica aberta; se o plugin desconectar, as chamadas recebem
  `{"status":"error","error":"Spresenter desconectado"}`.
- Um novo `config` reabre a porta HTTP com os novos valores, sem reiniciar a ponte.
- Uma conexão de plugin por vez; a mais nova substitui a anterior.
- A ponte espera a `reply` por até **3 s**; depois responde
  `{"status":"error","error":"tempo esgotado"}`.
- `Auth` e `GetTokenInfo` são respondidos pela ponte, sem ir ao plugin
  (`GetTokenInfo` → `{ version: "2.25.0", permissions: "<ações suportadas>" }`).

## 6. Ações (plugin)

| Ação | Comportamento | Resposta |
|---|---|---|
| `SearchLyrics` | Busca músicas na biblioteca (`type: music`) conforme §7.1. Texto vazio → todas. | lista `{id, title, artist, author}` filtrada por `fields` |
| `GetLyrics` | `assets.getLyrics(id)` → slides conforme §7.2; guarda em memória. | `{ id, title, artist, author, slides }` filtrado por `fields`; `null` se não existe |
| `ShowLyrics` | Define a música atual (`id`) e carrega a letra. **Não projeta.** | ok |
| `ShowQuickPresentation` | Texto em branco → apaga a letra (§11, V3). Senão → acha a parte (§7.3) e projeta como no clique manual (§11, V2). | ok / erro |
| `CloseCurrentPresentation` | Apaga a letra e esquece a música atual. | ok |
| outras | Registra "não suportada" no painel. | ok |

Texto não encontrado: relê a letra da música atual e tenta de novo. Se continuar
sem achar — ou se o texto chegar **sem música aberta** — procura a música pela letra
percorrendo as letras da biblioteca (`assets.search` do Spresenter só busca no título;
as letras ficam em memória até o evento `assets`), abre a que tiver a parte e projeta
pelo tema. Só se nenhuma tiver, projeta o texto recebido como apresentação simples.
A música aberta é guardada em `spresenter.storage` (`currentSong`): se o plugin
reiniciar no meio da música, ele a retoma ao iniciar.
As chamadas rodam em fila, na ordem de chegada.

## 7. Regras

### 7.1 Busca

- Normalizar: Unicode NFD sem diacríticos, minúsculas, `trim`, espaços
  internos colapsados.
- Casa se **todas** as palavras do texto aparecem em `título + " " + artista`
  normalizados.
- Ordem (o CMElite usa o **primeiro**): título idêntico → título que começa com o
  texto → demais; desempate alfabético por título.

### 7.2 Slides

- Um slide por **parte projetável** do Spresenter (a mesma unidade usada por
  `live.setMusicVerse`; confirmar em §11, V2).
- `text`: texto da parte, com quebras de linha `\n`.
- `slide_description`: nome do grupo da parte no Spresenter (ex.: "Verso",
  "Refrão"). Sem grupo → nome a partir do tipo: `intro` Introdução, `verse` Verso,
  `pre-chorus` Pré-refrão, `chorus` Refrão, `bridge` Ponte, `instrumental`
  Instrumental, `tag` Tag, `outro` Final, `ending` Encerramento.
- Repetições ("Verso" duas vezes) mantêm o mesmo nome por padrão. Se o aceite
  (§10) mostrar que o CMElite espera numeração ("Verso 1", "Verso 2"), a
  numeração vira regra aqui. Fica isolado em `slides.ts`.

### 7.3 Escolha da parte pelo texto

- Comparar textos normalizados por linha (`\r\n` → `\n`, `trim` em cada linha).
- Texto com só espaços = **em branco**.
- Várias partes com o mesmo texto: a primeira ocorrência **depois** da parte
  atual; se não houver, a primeira da música.

## 8. Painel

- **Status:** ponte conectada/desconectada; CMElite (último `auth-ok` e horário
  da última chamada); música e parte no ar; últimos ~20 eventos.
- **Configuração:** token (campo oculto com "mostrar"), botões **Gerar token**
  (a ponte gera; o token já é salvo com a porta atual) e **Copiar**, e porta (padrão 8091), salvos em `spresenter.storage`
  e enviados à ponte. O token também pode ser digitado, para quem já tem um no CMElite.
- **Ajuda:** "No CMElite, use IP <endereço> e porta <porta>", com os endereços
  informados pela ponte em `status`.
- **Avisos no sino** (`notifications.publish`, `level: warning`, `id` fixo para
  não repetir): ponte caiu durante o uso; token recusado.

## 9. Falhas e segurança

| Situação | Comportamento |
|---|---|
| Ponte fora do ar | Plugin tenta reconectar a cada 3 s, sem limite; painel mostra. |
| Spresenter fechado | Ponte responde erro ao CMElite. |
| Plugin lento (> 3 s) | Ponte responde erro "tempo esgotado". |
| Token errado | Ponte responde erro, emite `auth-fail`; aviso no painel e no sino. |
| Erro do SDK | Erro com a mensagem para o CMElite; registro no painel. |

- WebSocket só em `127.0.0.1`.
- Porta HTTP exige token (modo hash ou `?token=`); `rid` repetido ou menor que o
  último da sessão é recusado; sessões expiram após 12 h sem uso.

## 10. Distribuição, início automático e testes

**Distribuição**
- Plugin: `npm run package` (inclui `dist/ui`).
- Ponte: `bun build --compile` para `bun-darwin-arm64`, `bun-darwin-x64` e
  `bun-windows-x64`, gerando `release/ponte-cmelite-*`.
- `ponte-cmelite --install` / `--uninstall`: LaunchAgent em
  `~/Library/LaunchAgents` (macOS) ou chave `HKCU\…\CurrentVersion\Run`
  (Windows). Sem administrador.
- README em português: liberar no firewall na primeira execução; no macOS, abrir
  com clique direito → Abrir (binário não assinado).

**Testes**
1. Unitários (`bun test`): `normalize`, `search` (acento, caixa, espaços,
   ordem), `slides`, `match` (repetição, em branco, não encontrado), `auth`
   (gabaritos da §3.2, `rid`).
2. Integração da ponte: ponte real + plugin falso por WebSocket, reproduzindo a
   sequência da §3.3 com hash e `rid` como o CMElite.
3. Verificação no Spresenter (§11).
4. Aceite ponta a ponta com o usuário (critério da §1).

## 11. Verificações do primeiro passo

| # | O que confirmar | Como |
|---|---|---|
| V1 | ✅ **Feito em 2026-10-09:** `dados = "auth"` no passo 2 do `Auth`; corpo cru nas demais | Servidor de captura registrou `nonce` e `dtoken`; conferido localmente com o token do perfil do CMElite |
| V2 | ✅ **Feito em 2026-10-09:** índice de `setMusicVerse` = posição em `sections[]` (`lyrics[i] === sections[i].text`, 34/34). `setMusicVerse("0", 1, guid, i)` produz estado e visual idênticos ao clique manual. O clique manual usa a **camada 1 ("Conteúdo")**; a camada 0 é "Fundo". Há uma única saída ("Principal"), então uma chamada basta. Tipo de asset das músicas: `music` | Sonda no Spresenter 0.3.50 + conferência visual do usuário |
| V3 | ✅ **Feito em 2026-10-09:** `live.clear(saída, 1)` e `setState({show:false})` apagam a letra; o fundo fica em outra camada (0), então limpar a camada 1 não o afeta. Escolhido `live.clear`. Apresentação avulsa de texto (`live.apply` com elemento `TEXT`) aparece corretamente | Sonda + conferência visual |
| V4 | ✅ **Feito em 2026-10-09:** `net.wsOpen` funciona, mas **resolve antes de abrir** e também resolve com a ponte fora do ar (seguido de `close`). `wsSend` antes de `open` rejeita. Só o evento `open` indica conexão real | Sonda + logs do Spresenter |

## 12. Fora do escopo

Outras ações do protocolo; Bíblia; vários CMElite simultâneos; assinatura dos
executáveis; Linux; importar músicas para o Spresenter; porta do WebSocket
configurável.

## 13. Riscos

- **Regras de casamento do CMElite** (repetições, nomes parecidos) são uma caixa
  preta. Mitigação: `slide_description` isolado em `slides.ts` e validado no
  aceite.
- **Comportamento de `setMusicVerse`** pode não reproduzir o clique manual.
  Mitigação: V2 antes de escrever `actions.ts`.
- **Firewall e Gatekeeper** podem bloquear a ponte na primeira execução.
  Mitigação: README e mensagem de ajuda no painel.
- **Músicas sem nomes de parte — resolvido no aceite.** "Bom Perfume - Ao Vivo" e
  "Me Ama" têm as partes sem tipo nem grupo e funcionaram: o CMElite escolhe o texto
  de cada seção sem depender de `slide_description`. A numeração de repetições
  (Task 13, Step 3) não foi necessária.
- **Plugin dev no Spresenter:** qualquer mudança na pasta do plugin faz um
  "dev reload" que para o plugin `background` e não o reinicia; é preciso
  reiniciar o Spresenter depois de cada build durante o desenvolvimento.
