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

const lyricsCalls: string[] = [];
const library = {
  list: async () => [
    { guid: 'g1', type: 'music', title: 'Bom Perfume', author: 'Gabi Sampaio' },
    { guid: 'g2', type: 'music', title: 'Me Ama', author: 'Get Worship' },
  ],
  get: async () => null,
  getLyrics: async (guid: string) => {
    lyricsCalls.push(guid);
    return guid === 'g2'
      ? { sections: [{ text: 'Tem ciúmes de mim\nO Seu amor é como um furacão' }] }
      : { sections: [{ text: 'Ao Deus que me deu tudo\nEu dou meu coração' }] };
  },
};

test('findByText acha a música pela letra percorrendo a biblioteca (a busca do Spresenter só vê o título)', async () => {
  expect(await createSongStore(library).findByText('  Tem ciúmes de mim \nO Seu amor é como um furacão')).toEqual([
    { guid: 'g2', title: 'Me Ama', artist: 'Get Worship' },
  ]);
});

test('findByText guarda as letras em memória até a biblioteca mudar', async () => {
  lyricsCalls.length = 0;
  const s = createSongStore(library);
  await s.findByText('Tem ciúmes de mim');
  await s.findByText('Ao Deus que me deu tudo');
  expect(lyricsCalls).toEqual(['g1', 'g2']);
  s.invalidate();
  await s.findByText('Tem ciúmes de mim');
  expect(lyricsCalls).toEqual(['g1', 'g2', 'g1', 'g2']);
});

test('findByText com texto em branco não percorre nada', async () => {
  lyricsCalls.length = 0;
  expect(await createSongStore(library).findByText(' \n ')).toEqual([]);
  expect(lyricsCalls).toEqual([]);
});
