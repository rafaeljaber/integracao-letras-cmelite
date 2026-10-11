import { expect, test } from 'bun:test';
import { copyText } from '../src/ui/copy';

test('usa a área de transferência moderna quando ela funciona', async () => {
  const written: string[] = [];
  expect(await copyText('abc', { writeText: async (t) => void written.push(t), execCopy: () => false })).toBe('copied');
  expect(written).toEqual(['abc']);
});

test('se a moderna for bloqueada (iframe do painel), tenta o comando de cópia', async () => {
  let execs = 0;
  const r = await copyText('abc', {
    writeText: async () => {
      throw new Error('NotAllowedError');
    },
    execCopy: () => {
      execs += 1;
      return true;
    },
  });
  expect(r).toBe('copied');
  expect(execs).toBe(1);
});

test('sem área de transferência moderna, vai direto para o comando de cópia', async () => {
  expect(await copyText('abc', { execCopy: () => true })).toBe('copied');
});

test('se nada copiar, avisa que o texto ficou selecionado', async () => {
  expect(await copyText('abc', { writeText: async () => Promise.reject(new Error('x')), execCopy: () => false })).toBe('selected');
});
