import { defineConfig } from "vitest/config";

import { gwenSourceAliases } from "../../vitest.aliases.ts";

// Plugins import `@gwenjs/core/internal` and `@gwenjs/kit/plugin`.
// Those exports point at `dist/`. This config runs the TypeScript source,
// so the plugin and the engine must share one `getWasmBridge` module.
export default defineConfig({
  resolve: {
    alias: gwenSourceAliases(),
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/integration-wasm/**/*.test.ts"],
  },
});
