# Integração Letras CMElite

Faz o **CMElite** (controlador de multitracks no REAPER) passar as letras no
**Spresenter** automaticamente, no ritmo do VS, **sem nenhuma alteração no CMElite**.

O CMElite já sabe controlar um software de projeção por uma API HTTP de letras. Este
projeto faz o Spresenter responder a essa mesma API: você aponta o perfil de letras
do CMElite para o computador do Spresenter e as partes da música passam a ir para o
telão no tempo certo, com o tema da música (fundo, fonte, maiúsculas…).

> Projeto independente da comunidade, sem vínculo com os desenvolvedores do CMElite
> ou do Spresenter. Os nomes são marcas de seus respectivos donos.

## Como funciona

```
Computador do REAPER                 Computador do Spresenter
┌─────────────┐   rede local    ┌──────────────────┐  127.0.0.1   ┌──────────────────────────┐
│   CMElite   │ ──────────────▶ │  Ponte CMElite   │ ◀──────────▶ │ Plugin CMElite           │
│  (REAPER)   │   porta 8091    │ (programa à parte)│   porta 8092 │ (dentro do Spresenter)   │
└─────────────┘                 └──────────────────┘              └──────────────────────────┘
```

- **Plugin CMElite** (instalado no Spresenter): busca a música na biblioteca, põe
  cada parte no ar como se você tivesse clicado nela e mostra um painel de status.
- **Ponte CMElite** (executável à parte): recebe as chamadas do CMElite pela rede e
  entrega ao plugin. Ela existe porque plugins do Spresenter não podem abrir portas
  de rede.

O CMElite e o Spresenter podem estar no mesmo computador ou em computadores
diferentes da mesma rede.

## Requisitos

- **Spresenter 0.3.50** ou mais novo.
- **CMElite** com o perfil do servidor de letras (IP, porta e token) na tela de ajustes.
- Computador do Spresenter com **macOS** (Apple Silicon ou Intel) ou **Windows 64 bits**.
- As músicas na **biblioteca do Spresenter**, com o mesmo nome que você usa no CMElite.

## Instalação

Baixe os arquivos da versão mais recente na página **Releases** deste repositório:

| Arquivo | Para quê |
|---|---|
| `com.jaber.integracao-letras-cmelite-<versão>.zip` | o plugin (igual para todos os sistemas) |
| `ponte-cmelite-macos-arm64.zip` | ponte para Mac com Apple Silicon (M1, M2…) |
| `ponte-cmelite-macos-x64.zip` | ponte para Mac com Intel |
| `ponte-cmelite-windows-x64.zip` | ponte para Windows |
| `SHA256SUMS.txt` | somas para conferir os downloads |

### 1. Plugin

No Spresenter: **Configurações → Plugins → Instalar (.zip/pasta)** e escolha o zip do
plugin. Se o painel **CMElite** não aparecer conectado, desabilite e habilite o plugin.

### 2. Ponte

Descompacte o zip da ponte numa pasta fixa (ex.: `Aplicativos/Ponte CMElite` no Mac ou
`C:\Ponte CMElite` no Windows).

**macOS.** O executável não é assinado. Na primeira vez, abra o Terminal na pasta e rode:

```bash
xattr -d com.apple.quarantine ponte-cmelite-macos-arm64
```

```bash
./ponte-cmelite-macos-arm64
```

(Troque `arm64` por `x64` se o seu Mac for Intel.)

**Windows.** Dê dois cliques em `ponte-cmelite-windows-x64.exe`. Se aparecer o aviso do
SmartScreen, clique em **Mais informações → Executar assim mesmo**. A janela da ponte
precisa ficar aberta (pode minimizar).

**Nos dois sistemas,** quando o sistema perguntar se a ponte pode receber conexões da
rede, responda **Permitir**. Sem isso, um CMElite em outro computador não chega até ela.

### 3. Abrir sozinha ao ligar o computador (recomendado)

```bash
./ponte-cmelite-macos-arm64 --install
```

No Windows: `ponte-cmelite-windows-x64.exe --install` no Prompt de Comando, dentro da
pasta da ponte. Para desfazer, use `--uninstall`. No Mac, a ponte também é reiniciada
sozinha se fechar.

## Configuração

1. No Spresenter, abra o painel **CMElite**.
2. Em *Configuração*, deixe a porta **8091** e clique em **Gerar token**. O token
   (ex.: `K7MP-Q2XA-9RHD`) já fica salvo.
3. No **CMElite**, no perfil do servidor de letras, coloque:
   - **IP:** o que o painel mostra em "No CMElite, use IP …" (ou `127.0.0.1` se for o
     mesmo computador);
   - **Porta:** 8091;
   - **Token:** o token do painel.
4. Reconecte o perfil no CMElite. O painel passa a mostrar "CMElite: última chamada …".

Se o CMElite já tem um token configurado, você pode digitá-lo no painel e clicar em
**Salvar** em vez de gerar um novo.

## Uso

Associe as músicas no CMElite pelo nome, como antes, e dê play no VS. Cada seção põe a
parte correspondente no ar; seções sem letra (contagem, instrumental) deixam a tela sem
letra; parar o VS limpa a letra. O painel mostra o que está no ar e os últimos eventos.

**Dicas**

- **Maiúsculas, fonte, fundo:** vêm do tema da música no Spresenter (no editor de temas,
  elemento de texto → *Case* → *Maiúsculas*). O CMElite segue o mesmo visual do clique
  manual.
- **O plugin reiniciou no meio da música?** Ele retoma a música que estava tocando e, se
  precisar, a reconhece pela letra.
- **Atualizou o plugin?** A ponte guarda a configuração e a devolve ao plugin, sem
  precisar gerar outro token.

## Problemas comuns

| O painel mostra | O que fazer |
|---|---|
| Ponte desconectada | Abra a ponte neste computador (ou use `--install`). |
| Porta indisponível | Outro programa usa a porta: feche-o ou escolha outra porta no painel (e mude no CMElite). |
| CMElite recusado: token inválido | O token do painel e o do perfil no CMElite precisam ser iguais. |
| Sessão perdida — reconecte o CMElite | A ponte reiniciou: reconecte o perfil no CMElite. |
| Texto livre / texto não encontrado | A música não foi achada na biblioteca do Spresenter: confira se ela existe lá com o mesmo texto. |

A ponte guarda a configuração em `~/Library/Application Support/ponte-cmelite/config.json`
(macOS) ou `%APPDATA%\ponte-cmelite\config.json` (Windows).

## Segurança

- A ponte só aceita chamadas com o token: cada chamada é assinada (hash com desafio) e
  não pode ser repetida.
- A conexão entre a ponte e o plugin fica restrita ao próprio computador (`127.0.0.1`).
- Use a ponte só em redes de confiança (a rede da igreja, por exemplo).

## Desenvolvimento

Requisitos: **Node.js 20+** e **Bun 1.3.14**.

```bash
npm install
```

```bash
npm test
```

| Comando | O que faz |
|---|---|
| `npm test` | testes (bun test) |
| `npm run typecheck` | checagem de tipos do plugin, do painel e da ponte |
| `npm run build` | gera `dist/code.js` e `dist/ui/` |
| `npm run package` | gera o zip do plugin em `release/` |
| `npm run bridge:dev` | roda a ponte a partir do código |
| `npm run bridge:build` | gera os executáveis da ponte em `release/` |

Estrutura: `src/` é o plugin (lógica em `src/compat/`, painel em `src/ui/`), `bridge/` é a
ponte e `tests/` tem os testes. O design completo está em `docs/`.

Para testar o plugin sem instalar: **Configurações → Plugins → Carregar pasta (dev)**.
No modo dev, qualquer mudança na pasta recarrega o plugin e o deixa parado:
desabilite e habilite o plugin depois de cada build.

### Publicar uma versão

1. Atualize a versão em `package.json`, `manifest.json` e `bridge/version.ts` (o teste
   `tests/version.test.ts` confere se as três batem).
2. Faça o commit e crie a tag: `git tag v0.2.0 && git push --tags`.
3. O GitHub Actions roda os testes, gera o zip do plugin e os executáveis da ponte e
   publica a release com tudo anexado.

## Licença

[MIT](LICENSE). Os componentes de terceiros incluídos nos arquivos de release (SDK do
Spresenter e runtime do Bun) estão listados em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
