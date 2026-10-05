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
      pathsToAliases: false,
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        module: resolve(__dirname, "src/module.ts"),
        internal: resolve(__dirname, "src/internal.ts"),
        "helpers/index": resolve(__dirname, "src/helpers/index.ts"),
        "helpers/queries": resolve(__dirname, "src/helpers/queries.ts"),
        "helpers/movement": resolve(__dirname, "src/helpers/movement.ts"),
        "helpers/contact": resolve(__dirname, "src/helpers/contact.ts"),
        "helpers/static-geometry": resolve(__dirname, "src/helpers/static-geometry.ts"),
        "helpers/orchestration": resolve(__dirname, "src/helpers/orchestration.ts"),
        tilemap: resolve(__dirname, "src/tilemap.ts"),
        debug: resolve(__dirname, "src/debug.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: (id) => !id.startsWith(".") && !id.startsWith("/"),
    },
  },
});
