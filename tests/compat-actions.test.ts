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
let remembered: Array<string | null>;
let actions: CompatActions;

const songs: SongStore = {
  listSongs: async () => [BOM, OUTRA],
  getSong: async (guid) => [BOM, OUTRA].find((s) => s.guid === guid) ?? null,
  getLyrics: async (guid) => lyricsByGuid[guid] ?? null,
  findByText: async () => [BOM, OUTRA],
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
  remembered = [];
  actions = new CompatActions({
    songs,
    projector,
    log: (level, message) => logs.push([level, message]),
    onNowPlaying: (t, p) => now.push([t, p]),
    rememberSong: (guid) => remembered.push(guid),
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
    await actions.handle('ShowQuickPresentation', { text: 'Outra letra' });
    expect(calls).toEqual(['clear', 'text Outra letra']);
    expect(now).toContainEqual([null, null]);
  });
  test('chamadas rodam em fila: um apagar não passa na frente de uma parte lenta', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = new CompatActions({
      songs,
      projector: {
        showPart: async (guid, index) => {
          await gate;
          calls.push(`part ${guid} ${index}`);
        },
        clearLyrics: async () => {
          calls.push('clear');
        },
        showText: async (text) => {
          calls.push(`text ${text}`);
        },
      },
      log: () => {},
      onNowPlaying: () => {},
      rememberSong: () => {},
    });
    await slow.handle('ShowLyrics', { id: 'g1' });
    const a = slow.handle('ShowQuickPresentation', { text: 'Refrão' });
    const b = slow.handle('ShowQuickPresentation', { text: ' ' });
    await new Promise((r) => setTimeout(r, 10));
    release();
    await Promise.all([a, b]);
    expect(calls).toEqual(['part g1 1', 'clear']);
  });
  test('texto sem música aberta: reconhece a música pela letra e põe a parte no ar', async () => {
    lyricsByGuid.g2 = { sections: [{ type: 'verse', text: 'Outra A' }, { type: 'chorus', text: 'Tem ciúmes de mim\nO Seu amor', group: 'r' }], groups: [{ id: 'r', name: 'Refrão' }] };
    await actions.handle('ShowQuickPresentation', { text: 'Tem ciúmes de mim\nO Seu amor' });
    expect(calls).toEqual(['part g2 1']);
    expect(now[now.length - 1]).toEqual(['Teu Toque', 'Refrão']);
    expect(logs).toContainEqual(['info', 'música reconhecida pela letra: Teu Toque']);
  });
  test('texto de outra música com uma aberta: troca para a música reconhecida', async () => {
    lyricsByGuid.g2 = { sections: [{ type: 'verse', text: 'Outra A' }, { type: 'verse', text: 'Só da segunda' }] };
    await actions.handle('ShowLyrics', { id: 'g1' });
    await actions.handle('ShowQuickPresentation', { text: 'Só da segunda' });
    expect(calls).toEqual(['part g2 1']);
    await actions.handle('ShowQuickPresentation', { text: 'Outra A' });
    expect(calls).toEqual(['part g2 1', 'part g2 0']);
  });
  test('ShowLyrics lembra a música; Close esquece', async () => {
    await actions.handle('ShowLyrics', { id: 'g1' });
    await actions.handle('CloseCurrentPresentation', {});
    expect(remembered).toEqual(['g1', null]);
  });
  test('restore volta à música lembrada sem pôr nada no ar; o texto seguinte usa o tema', async () => {
    await actions.restore('g1');
    expect(calls).toEqual([]);
    await actions.handle('ShowQuickPresentation', { text: 'Verso dois' });
    expect(calls).toEqual(['part g1 2']);
  });
  test('restore de música que não existe mais não quebra', async () => {
    await actions.restore('sumiu');
    await actions.handle('ShowQuickPresentation', { text: 'Solto' });
    expect(calls).toEqual(['text Solto']);
  });
  test('ShowLyrics de música inexistente é erro', async () => {
    await expect(actions.handle('ShowLyrics', { id: 'nao-existe' })).rejects.toThrow('música não encontrada: nao-existe');
  });
  test('ação desconhecida responde sem dados e registra aviso', async () => {
    expect(await actions.handle('ActionNext', {})).toBeUndefined();
    expect(logs.at(-1)).toEqual(['warn', 'ação não suportada: ActionNext']);
  });
});
