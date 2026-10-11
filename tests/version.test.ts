import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRIDGE_VERSION } from '../bridge/version';

const root = join(import.meta.dir, '..');
const json = (file: string) => JSON.parse(readFileSync(join(root, file), 'utf8'));

test('plugin, ponte e package.json têm a mesma versão (a release usa a tag vX.Y.Z)', () => {
  const version = json('package.json').version;
  expect(json('manifest.json').version).toBe(version);
  expect(BRIDGE_VERSION).toBe(version);
});

test('o plugin continua exigindo o Spresenter 0.3.50 ou mais novo', () => {
  expect(json('manifest.json').minAppVersion).toBe('0.3.50');
});
