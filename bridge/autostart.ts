// Faz a ponte iniciar sozinha no login: LaunchAgent no macOS, registro do usuário no Windows.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const AGENT_LABEL = 'com.jaber.ponte-cmelite';
export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
export const RUN_VALUE = 'PonteCMElite';

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function launchAgentPlist(execPath: string, logPath: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${AGENT_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${xml(execPath)}</string>`,
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>StandardOutPath</key>',
    `  <string>${xml(logPath)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${xml(logPath)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

export function windowsRunCommand(execPath: string): string[] {
  return ['reg', 'add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', `"${execPath}"`, '/f'];
}

export function windowsRemoveCommand(): string[] {
  return ['reg', 'delete', RUN_KEY, '/v', RUN_VALUE, '/f'];
}

const plistPath = () => join(homedir(), 'Library', 'LaunchAgents', `${AGENT_LABEL}.plist`);
const uid = () => (process.getuid ? process.getuid() : 0);

function run(cmd: string[]): void {
  const r = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`${cmd[0]} falhou: ${r.stderr.toString().trim()}`);
}

export function installAutostart(execPath: string = process.execPath, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') {
    const plist = plistPath();
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
    writeFileSync(plist, launchAgentPlist(execPath, join(homedir(), 'Library', 'Logs', 'ponte-cmelite.log')));
    Bun.spawnSync(['launchctl', 'bootout', `gui/${uid()}`, plist]);
    run(['launchctl', 'bootstrap', `gui/${uid()}`, plist]);
    return `Início automático ativado. A ponte já está rodando e vai abrir sozinha nos próximos logins (${plist}).`;
  }
  if (platform === 'win32') {
    run(windowsRunCommand(execPath));
    return 'Início automático ativado. A ponte vai abrir sozinha no próximo login; para agora, abra o executável normalmente.';
  }
  throw new Error(`sistema não suportado: ${platform}`);
}

export function uninstallAutostart(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') {
    Bun.spawnSync(['launchctl', 'bootout', `gui/${uid()}/${AGENT_LABEL}`]);
    rmSync(plistPath(), { force: true });
    return 'Início automático desativado e ponte parada.';
  }
  if (platform === 'win32') {
    run(windowsRemoveCommand());
    return 'Início automático desativado.';
  }
  throw new Error(`sistema não suportado: ${platform}`);
}
