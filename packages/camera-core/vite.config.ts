import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { resolve } from "path";
import dts from "vite-plugin-dts";
import { gwenLibDevGuard } from "../../scripts/lib-dev-guard.ts";

const vitePackageJson = fileURLToPath(new URL("../vite/package.json", import.meta.url));

export default defineConfig({
  plugins: [
    gwenLibDevGuard(vitePackageJson),
    dts({
      include: ["src"],
      exclude: ["src/**/*.fixture.ts"],
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
        internal: resolve(__dirname, "src/internal.ts"),
        module: resolve(__dirname, "src/module.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [/^@gwenjs\//],
    },
  },
});
