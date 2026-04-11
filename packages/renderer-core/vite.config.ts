import { defineConfig } from "vite";
import { resolve } from "path";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      include: ["src"],
      outDir: "dist",
      rollupTypes: false,
      entryRoot: "src",
      // Prevent @gwenjs/* path aliases from being resolved to relative paths in .d.ts files.
      // Without this, `declare module '@gwenjs/core'` becomes `declare module '../packages/core/src/index.ts'`
      // which doesn't match the module specifier consumers use.
      pathsToAliases: false,
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        "testing/index": resolve(__dirname, "src/testing/index.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [/^@gwenjs\//],
    },
  },
});
