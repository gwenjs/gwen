import { defaultExclude, defineConfig } from "vitest/config";

import { gwenSourceAliases } from "../../vitest.aliases.ts";

// Plugins import `@gwenjs/core/internal` and `@gwenjs/kit/plugin`.
// Those exports point at `dist/`. This config runs the TypeScript source,
// so the plugin and the engine must share one `getWasmBridge` module.
const alias = gwenSourceAliases();

const shared = {
  globals: true,
  environment: "node" as const,
  include: ["tests/integration-wasm/**/*.test.ts"],
  // `exclude` replaces Vitest defaults. gc tests need `--expose-gc` (vitest 4
  // `InlineConfig.execArgv`, reporters.d.B0uk8id2.d.ts).
  exclude: [...defaultExclude, "tests/integration-wasm/gc/**"],
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
      {
        resolve: { alias },
        define: { __GWEN_DEV__: "true" },
        test: {
          name: "gc",
          globals: true,
          environment: "node",
          include: ["tests/integration-wasm/gc/**/*.test.ts"],
          pool: "forks",
          execArgv: ["--expose-gc"],
        },
      },
    ],
  },
});
