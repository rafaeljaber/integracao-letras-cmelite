import { describe, expect, test } from 'bun:test';
import { AGENT_LABEL, RUN_KEY, RUN_VALUE, launchAgentPlist, windowsRemoveCommand, windowsRunCommand } from '../bridge/autostart';

describe('autostart', () => {
  test('plist do LaunchAgent', () => {
    const xml = launchAgentPlist('/Apps/Ponte & Cia/ponte-cmelite', '/Users/x/Library/Logs/ponte-cmelite.log');
    expect(xml).toContain(`<string>${AGENT_LABEL}</string>`);
    expect(xml).toContain('<string>/Apps/Ponte &amp; Cia/ponte-cmelite</string>');
    expect(xml).toContain('<key>RunAtLoad</key>\n  <true/>');
    expect(xml).toContain('<key>KeepAlive</key>\n  <true/>');
    expect(xml).toContain('<string>/Users/x/Library/Logs/ponte-cmelite.log</string>');
  });
  test('comandos do registro do Windows', () => {
    expect(windowsRunCommand('C:\\Ponte\\ponte-cmelite.exe')).toEqual(['reg', 'add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', '"C:\\Ponte\\ponte-cmelite.exe"', '/f']);
    expect(windowsRemoveCommand()).toEqual(['reg', 'delete', RUN_KEY, '/v', RUN_VALUE, '/f']);
  });
});
