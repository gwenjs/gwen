import { defineConfig } from "vitest/config";
import { gwenSourceAliases } from "../../vitest.aliases.ts";

export default defineConfig({
  resolve: {
    alias: gwenSourceAliases(),
  },
  test: {
    globals: true,
    environmentMatchGlobs: [
      ["tests/layer-manager.test.ts", "happy-dom"],
      ["tests/conformance-suite.test.ts", "happy-dom"],
    ],
    environment: "node",
  },
});
