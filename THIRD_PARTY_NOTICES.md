# Avisos de terceiros

Este projeto é distribuído sob a licença MIT (veja `LICENSE`). Os arquivos de
release incluem ou foram gerados com os componentes de terceiros abaixo.

## @spresenter/plugin-sdk

- **Onde:** vendorizado em `sdk/spresenter-plugin-sdk.tgz`; partes da UI
  (`ui`, `ui-kit`) são empacotadas no painel do plugin (`dist/ui`).
- **Licença:** MIT, conforme declarado no `package.json` do pacote.

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Bun (runtime embutido nos executáveis da ponte)

Os executáveis `ponte-cmelite-*` são gerados com `bun build --compile` (Bun 1.3.14)
e contêm o runtime do Bun.

- **Bun:** licença MIT — https://github.com/oven-sh/bun
- **Licenças completas do Bun e das bibliotecas que ele embute:**
  https://github.com/oven-sh/bun/blob/bun-v1.3.14/LICENSE.md
- O Bun liga estaticamente o **JavaScriptCore/WebKit**, sob **LGPL-2**, e o
  **tinycc**, sob **LGPL-2.1**. O código-fonte do WebKit usado pelo Bun está em
  https://github.com/oven-sh/webkit, e o do Bun em https://github.com/oven-sh/bun.
- O Bun também embute bibliotecas sob licenças BSD, Apache-2.0, zlib, ICU e MIT
  (boringssl, libarchive, lol-html, lsquic, zstd, simdutf, uSockets, zlib-ng,
  libicu, mimalloc, brotli, c-ares, libuv, entre outras), listadas no
  `LICENSE.md` do Bun indicado acima.

**Substituir o runtime (LGPL):** o código-fonte completo da ponte está neste
repositório (`bridge/`, `src/protocol.ts`). Para usá-la com um Bun ou
JavaScriptCore modificado, compile o Bun a partir do código-fonte e rode
`bun bridge/main.ts`, ou gere um novo executável com
`bun build bridge/main.ts --compile`.

## Ferramentas de desenvolvimento

Vite, TypeScript, adm-zip e `@types/bun` são usados só para compilar e testar.
Eles não fazem parte dos arquivos distribuídos.
