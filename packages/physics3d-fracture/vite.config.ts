import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { gwenLibDevGuard } from "../../scripts/lib-dev-guard.ts";

const vitePackageJson = fileURLToPath(new URL("../vite/package.json", import.meta.url));

export default defineConfig({
  build: {
    lib: {
      entry: "./src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: ["../wasm/gwen_physics3d_fracture.js"],
    },
  },
  plugins: [
    gwenLibDevGuard(vitePackageJson),
    dts({
      include: ["src"],
      exclude: ["src/**/*.fixture.ts"],
      rollupTypes: true,
      pathsToAliases: false,
    }),
  ],
});
