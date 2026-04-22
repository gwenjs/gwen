import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "virtual:gwen/local-plugins": resolve(__dirname, "tests/__stubs__/virtual-local-plugins.ts"),
      "virtual:gwen/local-modules": resolve(__dirname, "tests/__stubs__/virtual-local-modules.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
