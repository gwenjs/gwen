import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Same alias as vitest.wasm.config.ts: `@gwenjs/kit` dist may be unbuilt.
const kitPlugin = fileURLToPath(new URL("../kit/src/plugin/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@gwenjs/kit/plugin": kitPlugin,
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["bench/alloc/**/*.gate.ts"],
    pool: "forks",
    fileParallelism: false,
    execArgv: ["--expose-gc", "--max-semi-space-size=64"],
    // Ten real-WASM paths, two entity counts. The default 5s timeout is too small.
    testTimeout: 300_000,
  },
});
