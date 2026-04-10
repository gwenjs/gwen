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
      pathsToAliases: false,
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ["@gwenjs/core", "@gwenjs/kit", "@gwenjs/math", "@gwenjs/renderer-core"],
    },
  },
});
