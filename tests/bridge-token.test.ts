import { expect, test } from 'bun:test';
import { TOKEN_ALPHABET, generateToken } from '../bridge/token';

test('token em 3 blocos de 4, só maiúsculas e números', () => {
  expect(generateToken()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
});

test('alfabeto sem caracteres que se confundem na leitura', () => {
  for (const ch of generateToken().replace(/-/g, '')) expect(TOKEN_ALPHABET).toContain(ch);
  for (const ambiguous of ['0', 'O', '1', 'I', 'l']) expect(TOKEN_ALPHABET).not.toContain(ambiguous);
  expect(TOKEN_ALPHABET).toBe(TOKEN_ALPHABET.toUpperCase());
});

test('tokens não se repetem', () => {
  const all = new Set(Array.from({ length: 200 }, () => generateToken()));
  expect(all.size).toBe(200);
});
