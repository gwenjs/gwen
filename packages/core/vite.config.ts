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
        internal: resolve(__dirname, "src/internal.ts"),
        testing: resolve(__dirname, "src/testing.ts"),
        "system/index": resolve(__dirname, "src/system/index.ts"),
        "actor/index": resolve(__dirname, "src/actor/index.ts"),
        "scene/index": resolve(__dirname, "src/scene/index.ts"),
        "tween/index": resolve(__dirname, "src/tween/index.ts"),
        "system/module": resolve(__dirname, "src/system/module.ts"),
        "actor/module": resolve(__dirname, "src/actor/module.ts"),
        "scene/module": resolve(__dirname, "src/scene/module.ts"),
        "router/module": resolve(__dirname, "src/router/module.ts"),
        "tween/module": resolve(__dirname, "src/tween/module.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: (id) => id.startsWith("node:"),
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        // One shared chunk so every entry uses the same engineContext instance.
        manualChunks(id) {
          const norm = id.replaceAll("\\", "/");
          if (norm.endsWith("/engine/context.ts")) return "engine-context";
          return undefined;
        },
      },
    },
  },
});
