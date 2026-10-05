import { defineConfig } from "vitest/config";
import { gwenSourceAliases } from "../../vitest.aliases.ts";

export default defineConfig({
  resolve: {
    alias: gwenSourceAliases(),
  },
  test: {
    globals: true,
    environment: "node",
  },
});
