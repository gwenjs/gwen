import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";
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
        cli: resolve(__dirname, "src/cli.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    target: "node18",
    rollupOptions: {
      external: [/^node:/, /^@gwenjs\//, "typescript"],
      output: {
        banner(chunk) {
          return chunk.name === "cli" ? "#!/usr/bin/env node\n" : "";
        },
      },
    },
  },
});
