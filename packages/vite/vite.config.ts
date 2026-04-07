import { defineConfig } from "vite";
import { resolve } from "path";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts({ include: ["src"], outDir: "dist", rollupTypes: false, entryRoot: "src" })],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
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
