import { defineConfig } from "vitest/config";
import { gwenSourceAliases } from "../../vitest.aliases.ts";

const alias = gwenSourceAliases();

const shared = {
  environment: "node" as const,
  globals: false,
  include: ["src/**/*.test.ts", "tests/**/*.test.ts", "bench/**/*.test.ts"],
  coverage: {
    provider: "v8" as const,
    include: ["src/helpers/**", "src/helpers-*.ts"],
    exclude: ["src/helpers/tilemap.ts"],
    thresholds: {
      lines: 80,
      branches: 80,
      functions: 80,
      statements: 80,
    },
  },
};

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    projects: [
      {
        resolve: { alias },
        define: { __GWEN_DEV__: "true" },
        test: { name: "dev", ...shared },
      },
      {
        resolve: { alias },
        define: { __GWEN_DEV__: "false" },
        test: { name: "prod", ...shared },
      },
    ],
  },
  // @ts-expect-error -- `benchmark` is a valid top-level Vitest config key but
  // some vitest/config typings omit it from the InlineConfig overload.
  benchmark: {
    include: ["bench/**/*.bench.ts"],
  },
});
