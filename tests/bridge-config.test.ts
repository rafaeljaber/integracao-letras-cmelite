import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfigPath, loadSavedConfig, saveConfigFile } from '../bridge/config-store';

test('caminho da configuração por sistema', () => {
  expect(defaultConfigPath('darwin', {}, '/Users/x')).toBe('/Users/x/Library/Application Support/ponte-cmelite/config.json');
  expect(defaultConfigPath('win32', { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }, 'C:\\Users\\x')).toBe(join('C:\\Users\\x\\AppData\\Roaming', 'ponte-cmelite', 'config.json'));
  expect(defaultConfigPath('linux', {}, '/home/x')).toBe('/home/x/.config/ponte-cmelite/config.json');
});

test('salva e lê de volta, criando a pasta', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ponte-')), 'sub', 'config.json');
  saveConfigFile(path, { port: 8091, token: 'ABCD-EFGH-JKLM' });
  expect(loadSavedConfig(path)).toEqual({ port: 8091, token: 'ABCD-EFGH-JKLM' });
});

test('arquivo ausente, corrompido ou inválido vira null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ponte-'));
  expect(loadSavedConfig(join(dir, 'nao-existe.json'))).toBeNull();
  writeFileSync(join(dir, 'lixo.json'), '{nao é json');
  expect(loadSavedConfig(join(dir, 'lixo.json'))).toBeNull();
  writeFileSync(join(dir, 'vazio.json'), JSON.stringify({ port: 8091, token: '' }));
  expect(loadSavedConfig(join(dir, 'vazio.json'))).toBeNull();
});
