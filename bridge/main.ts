// Linha de comando da ponte CMElite.
import { WS_PORT } from '../src/protocol';
import { installAutostart, uninstallAutostart } from './autostart';
import { defaultConfigPath } from './config-store';
import { startBridge } from './server';
import { BRIDGE_VERSION } from './version';


const arg = process.argv[2];

try {
  if (arg === '--version') {
    console.log(BRIDGE_VERSION);
    process.exit(0);
  }
  if (arg === '--install') {
    console.log(installAutostart());
    process.exit(0);
  }
  if (arg === '--uninstall') {
    console.log(uninstallAutostart());
    process.exit(0);
  }
} catch (e) {
  console.error(`[ponte] ${(e as Error).message}`);
  process.exit(1);
}

try {
  startBridge({ wsPort: WS_PORT, configPath: defaultConfigPath() });
  console.log(`[ponte] v${BRIDGE_VERSION} aguardando o plugin do Spresenter em 127.0.0.1:${WS_PORT}`);
} catch (e) {
  console.error(`[ponte] não consegui abrir 127.0.0.1:${WS_PORT} (já existe uma ponte rodando?): ${(e as Error).message}`);
  process.exit(1);
}
