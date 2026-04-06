import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [dts({ include: ['src'], outDir: 'dist', rollupTypes: false })],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // All deps are external — this is a Vite plugin, loaded by Vite itself
      external: (id) => !id.startsWith('.') && !id.startsWith('/'),
    },
    target: 'node18',
  },
});
