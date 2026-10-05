import { defineConfig } from "vitest/config";

import { gwenSourceAliases } from "../../vitest.aliases.ts";

// Plugins import `@gwenjs/core/internal` and `@gwenjs/kit/plugin`.
// Those exports point at `dist/`. This config runs the TypeScript source,
// so the plugin and the engine must share one `getWasmBridge` module.
const alias = gwenSourceAliases();

const shared = {
  globals: true,
  environment: "node" as const,
  include: ["tests/integration-wasm/**/*.test.ts"],
};

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    projects: [
      {
        resolve: { alias },
        define: { __GWEN_DEV__: "true" },
        test: { name: "dev", ...shared },
      },
      {
        resolve: { alias },
        define: { __GWEN_DEV__: "false" },
        test: { name: "prod", ...shared },
      },
    ],
  },
});
