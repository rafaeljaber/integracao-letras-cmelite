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
