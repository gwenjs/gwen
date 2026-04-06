import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [dts({ include: ['src'], outDir: 'dist', rollupTypes: false })],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        core: resolve(__dirname, 'src/core.ts'),
        helpers: resolve(__dirname, 'src/helpers.ts'),
        'helpers-queries': resolve(__dirname, 'src/helpers-queries.ts'),
        'helpers-movement': resolve(__dirname, 'src/helpers-movement.ts'),
        'helpers-contact': resolve(__dirname, 'src/helpers-contact.ts'),
        'helpers-static-geometry': resolve(__dirname, 'src/helpers-static-geometry.ts'),
        'helpers-orchestration': resolve(__dirname, 'src/helpers-orchestration.ts'),
        tilemap: resolve(__dirname, 'src/tilemap.ts'),
        debug: resolve(__dirname, 'src/debug.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ['@gwenjs/core', '@gwenjs/kit'],
      output: {
        globals: {
          '@gwenjs/core': 'GwenEngineCore',
          '@gwenjs/kit': 'GwenKit',
        },
      },
    },
  },
});
