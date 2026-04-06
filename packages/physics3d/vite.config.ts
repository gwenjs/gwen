import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [dts({ include: ['src'], outDir: 'dist', rollupTypes: false })],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'GwenPluginPhysics3D',
      formats: ['es'],
      fileName: () => 'index.js',
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
