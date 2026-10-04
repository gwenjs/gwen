import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// `@gwenjs/kit` publishes `dist/`, which this worktree has not built.
// The real physics plugins import `@gwenjs/kit/plugin`, so point that
// subpath at the TypeScript source.
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
    include: ["tests/integration-wasm/**/*.test.ts"],
  },
});
