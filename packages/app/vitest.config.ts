import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { gwenSourceAliases } from "../../vitest.aliases.ts";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "virtual:gwen/local-plugins",
        replacement: resolve(__dirname, "tests/__stubs__/virtual-local-plugins.ts"),
      },
      {
        find: "virtual:gwen/local-modules",
        replacement: resolve(__dirname, "tests/__stubs__/virtual-local-modules.ts"),
      },
      ...gwenSourceAliases(),
    ],
  },
  test: {
    environment: "node",
  },
});
