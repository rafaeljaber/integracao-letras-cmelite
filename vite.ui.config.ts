import { defineConfig } from 'vite';
import { resolve } from 'path';

// Build do painel (thread de UI), exibido num iframe isolado. `base: './'` mantém os caminhos
// relativos para o app servir o build em /plugins/<id>/ui/.
export default defineConfig({
  root: resolve(__dirname, 'src/ui'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/ui'),
    emptyOutDir: true,
    target: 'es2020',
  },
});
