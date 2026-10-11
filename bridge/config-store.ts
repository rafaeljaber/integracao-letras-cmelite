// A ponte guarda a última configuração (porta e token) num arquivo próprio: reinstalar o plugin
// no Spresenter apaga a configuração dele, e assim ela volta sozinha.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { validateConfig, type CompatConfig } from '../src/protocol';

export function defaultConfigPath(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'ponte-cmelite', 'config.json');
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'ponte-cmelite', 'config.json');
  return join(home, '.config', 'ponte-cmelite', 'config.json');
}

export function loadSavedConfig(path: string): CompatConfig | null {
  try {
    const v = validateConfig(JSON.parse(readFileSync(path, 'utf8')));
    return v.ok ? v.config : null;
  } catch {
    return null;
  }
}

export function saveConfigFile(path: string, cfg: CompatConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}
