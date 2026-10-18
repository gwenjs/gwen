import { defineConfig } from "vitest/config";
import { gwenSourceAliases } from "../../vitest.aliases.ts";

const alias = gwenSourceAliases();

export default defineConfig({
  resolve: { alias },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.wasm.test.ts"],
  },
});
