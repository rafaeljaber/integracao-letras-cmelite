import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// O nome do software de projeção original não pode aparecer no projeto; fica codificado aqui.
const banned = Buffer.from('aG9seXJpY3M=', 'base64').toString('utf8');
const root = join(import.meta.dir, '..');
const roots = ['src', 'bridge', 'tests', 'scripts', 'docs', 'manifest.json', 'package.json', 'README.md'];

function files(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { recursive: true })
    .map((p) => join(path, String(p)))
    .filter((p) => statSync(p).isFile());
}

test('o nome do software original não aparece em código, nomes de arquivo nem textos', () => {
  const offenders = roots
    .flatMap((r) => files(join(root, r)))
    .filter((f) => f.toLowerCase().includes(banned) || readFileSync(f, 'utf8').toLowerCase().includes(banned));
  expect(offenders).toEqual([]);
});
