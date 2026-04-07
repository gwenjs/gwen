import { defineConfig } from "vite";
import { resolve } from "node:path";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts({ include: ["src"], outDir: "dist", rollupTypes: false, entryRoot: "src" })],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        resolve: resolve(__dirname, "src/resolve.ts"),
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      external: [/^node:/, "@gwenjs/kit", "c12", "defu", "hookable"],
    },
  },
});
