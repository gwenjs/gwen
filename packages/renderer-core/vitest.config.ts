import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environmentMatchGlobs: [
      ["tests/layer-manager.test.ts", "happy-dom"],
      ["tests/conformance-suite.test.ts", "happy-dom"],
    ],
    environment: "node",
  },
});
