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
      entry: resolve(__dirname, "src/index.ts"),
      name: "GwenMath",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: ["@gwenjs/schema"],
    },
  },
});
