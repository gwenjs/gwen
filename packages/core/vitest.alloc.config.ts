import { defineConfig } from "vitest/config";

import { gwenSourceAliases } from "../../vitest.aliases";

// The golden imports `@gwenjs/core/system`, so the alloc run needs the same source aliases
// as vitest.wasm.config.ts (`@gwenjs/kit` dist may be unbuilt too).
export default defineConfig({
  define: { __GWEN_DEV__: "true" },
  resolve: { alias: gwenSourceAliases() },
  test: {
    globals: true,
    environment: "node",
    include: ["bench/alloc/**/*.gate.ts", "tests/alloc-gate/measure.test.ts"],
    pool: "forks",
    fileParallelism: false,
    execArgv: ["--expose-gc", "--max-semi-space-size=64"],
    // Twelve real-WASM paths, two entity counts. The default 5s timeout is too small.
    testTimeout: 300_000,
  },
});
