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
