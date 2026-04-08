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
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        "testing/index": resolve(__dirname, "src/testing/index.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: ["@gwenjs/core"],
    },
  },
});
