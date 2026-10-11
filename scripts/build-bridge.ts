// Gera os executáveis da ponte: macOS Apple Silicon, macOS Intel e Windows.
import { mkdirSync } from 'node:fs';

const targets = [
  { target: 'bun-darwin-arm64', out: 'release/ponte-cmelite-macos-arm64' },
  { target: 'bun-darwin-x64', out: 'release/ponte-cmelite-macos-x64' },
  { target: 'bun-windows-x64', out: 'release/ponte-cmelite-windows-x64.exe' },
];

mkdirSync('release', { recursive: true });
for (const t of targets) {
  const r = Bun.spawnSync(['bun', 'build', 'bridge/main.ts', '--compile', `--target=${t.target}`, `--outfile=${t.out}`], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (r.exitCode !== 0) {
    console.error(`falhou: ${t.target}`);
    process.exit(1);
  }
  console.log(`ok: ${t.out}`);
}
