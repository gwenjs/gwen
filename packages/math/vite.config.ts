import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      include: ['src'],
      outDir: 'dist',
      // Keep declaration generation compatible with src-based package entrypoints.
      rollupTypes: false,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'GwenMath',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // No external dependencies — pure math library
    },
  },
});
