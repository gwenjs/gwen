import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { resolve } from "path";
import dts from "vite-plugin-dts";
import { gwenLibDevGuard } from "../../scripts/lib-dev-guard.ts";

const vitePackageJson = fileURLToPath(new URL("./package.json", import.meta.url));

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
        internal: resolve(__dirname, "src/internal.ts"),
        "shared/layer-utils": resolve(__dirname, "src/shared/layer-utils.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      // All deps are external — this is a Vite plugin, loaded by Vite itself
      external: (id) => !id.startsWith(".") && !id.startsWith("/"),
    },
    target: "node18",
  },
});
