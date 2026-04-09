import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      include: ["src"],
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
        "plugin/index": resolve(__dirname, "src/plugin/index.ts"),
        "module/index": resolve(__dirname, "src/module/index.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ["@gwenjs/core"],
      output: {
        globals: { "@gwenjs/core": "GwenEngineCore" },
      },
    },
  },
});
