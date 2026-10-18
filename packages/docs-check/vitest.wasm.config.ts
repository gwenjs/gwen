import { defineConfig } from "vitest/config";
import { gwenSourceAliases } from "../../vitest.aliases.ts";

const alias = gwenSourceAliases();

export default defineConfig({
  resolve: { alias },
  define: { __GWEN_DEV__: "true" },
  test: {
    environment: "node",
    include: ["tests/**/*.wasm.test.ts"],
  },
});
