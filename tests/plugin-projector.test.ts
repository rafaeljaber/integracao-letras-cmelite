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
